/**
 * Owns the single WebSocket connection to buzz-relay. Per docs/ARCHITECTURE.md §7,
 * this stays a single well-tested class rather than being split prematurely.
 * Reconnection uses capped exponential backoff; active subscriptions are
 * re-issued from an in-memory registry on every (re)connect.
 */
import { Relay } from "nostr-tools/relay";
import { matchFilters as nostrToolsMatchFilters } from "nostr-tools/filter";
import { verifyEvent as nostrToolsVerifyEvent } from "nostr-tools/pure";
import type {
  Event as NostrToolsEvent,
  EventTemplate as NostrToolsEventTemplate,
  Filter as NostrToolsFilter,
  VerifiedEvent as NostrToolsVerifiedEvent,
} from "nostr-tools";
import { useConnectionStore, type AuthDenial } from "@/stores/connection";
import { AppError, logError } from "@/services/errors";
import type { NostrFilter, RawNostrEvent } from "@/protocol/types";
import type { SignedEvent } from "@/features/signing/types";
import { getActiveSigningService } from "@/features/signing/signingServiceRegistry";
import {
  currentCommunityGeneration,
  isCurrentCommunitySession,
} from "@/features/communities/communitySession";

const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;
const CONNECT_TIMEOUT_MS = 10_000;
/** How long to wait for the relay's OK on our NIP-42 AUTH before proceeding without a verdict. */
const AUTH_VERDICT_TIMEOUT_MS = 2_500;

/**
 * Reduces a rejection from nostr-tools' `relay.auth()` to "the relay refused this
 * identity" (its reason string) or `null` when it is not a refusal. No challenge
 * means the relay does not use NIP-42; a timeout means there is no verdict. Neither
 * blocks the connection — that is the behaviour before this check existed.
 */
export function authDenialFrom(error: unknown): string | null {
  const reason = error instanceof Error ? error.message : String(error);
  if (/no challenge was received|auth timed out/i.test(reason)) return null;
  return reason;
}

/** Coarse category of a relay AUTH refusal, for the UI to branch on. */
export function authDenialKind(reason: string): AuthDenial {
  if (/not a relay member|relay_membership_required/i.test(reason)) return "not_member";
  if (/banned|blocked/i.test(reason)) return "banned";
  return "other";
}

/** User-safe text for a relay AUTH refusal; the raw reason stays in the developer log. */
export function authDenialMessage(reason: string): string {
  if (/not a relay member|relay_membership_required/i.test(reason)) {
    return "This identity isn't a member of this community yet. Ask an admin to add you or send you an invite.";
  }
  if (/banned|blocked/i.test(reason)) {
    return "This identity has been blocked from this community.";
  }
  return "The Buzz server didn't accept this identity.";
}

export interface RelaySubscriptionHandle {
  close(): void;
}

/**
 * The relay treats `#h` (channel) as a VIRTUAL tag: for kinds whose channel it
 * derives server-side — reactions (kind:7) and deletions (kind:5) reference a
 * target event and carry no `h` tag of their own — it matches `#h` against the
 * event's stored `channel_id` (buzz-core `filter_match_one`, "fallback ONLY when
 * the event has no h-tags at all"). nostr-tools, however, re-runs the REQ
 * filters on every incoming EVENT against the event's LITERAL tags
 * (`matchFilters`, relay.ts) and silently drops what doesn't match — so every
 * kind:7 the relay correctly delivered under a `#h` filter was thrown away
 * before reaching the app (docs/PHASE_3_IMPLEMENTATION_AUDIT.md §18.7 / §19).
 *
 * This is the same rule as the relay's, applied on the client: an event that
 * carries no `h` tag is matched against the filter WITHOUT its `#h` clause —
 * the relay already scoped it to the subscription's authorized channel — while
 * every other field (kinds, authors, ids, since/until, `#e`, `#p`, …) is still
 * checked here. Events that do carry `h` tags get no such leniency.
 */
export function matchesAllowingVirtualChannelTag(
  filters: NostrFilter[],
  event: RawNostrEvent,
): boolean {
  if (nostrToolsMatchFilters(filters as NostrToolsFilter[], event as unknown as NostrToolsEvent)) {
    return true;
  }
  const hasLiteralChannelTag = event.tags.some((tag) => tag[0] === "h");
  if (hasLiteralChannelTag) return false;
  const withoutChannelClause = filters
    .filter((filter) => "#h" in filter)
    .map(({ "#h": _channel, ...rest }) => rest);
  return (
    withoutChannelClause.length > 0 &&
    nostrToolsMatchFilters(
      withoutChannelClause as NostrToolsFilter[],
      event as unknown as NostrToolsEvent,
    )
  );
}

/**
 * nostr-tools reports its own socket teardown and our own `close()` through the
 * same `onclose` as a relay `CLOSED` message; those are not refusals.
 */
function isConnectionLoss(reason: string): boolean {
  return /^relay connection|closed by caller|closed automatically/i.test(reason);
}

interface RegisteredSubscription {
  id: string;
  filters: NostrFilter[];
  onEvent: (event: RawNostrEvent) => void;
  onEose?: () => void;
  /** The relay ended the subscription without EOSE (`CLOSED`, e.g. "auth-required:", "restricted:"). */
  onClosed?: (reason: string) => void;
  live: RelaySubscriptionHandle | null;
  /** The community session it was opened under (`communitySession.ts`). */
  session: number;
}

export class RelayConnectionService {
  private relay: Relay | null = null;
  private url: string | null = null;
  private readonly subscriptions = new Map<string, RegisteredSubscription>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private manuallyClosed = false;
  private connectGeneration = 0;
  private subscriptionSerial = 0;

  private get store() {
    return useConnectionStore();
  }

  async connect(url: string): Promise<void> {
    this.manuallyClosed = false;
    this.url = url;
    await this.attemptConnect();
  }

  disconnect(): void {
    this.manuallyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    for (const sub of this.subscriptions.values()) {
      sub.live?.close();
    }
    // Callers own resubscribing after a manual disconnect (e.g. on next
    // login) — an explicit disconnect() should not resurrect whatever was
    // subscribed before it, only an automatic reconnect should.
    this.subscriptions.clear();
    this.relay?.close();
    this.relay = null;
    // Invalidate any in-flight attemptConnect() so a socket that opens after
    // this call (e.g. a slow handshake started by the previous identity) is
    // discarded by its generation check instead of becoming "the" connection.
    this.connectGeneration++;
    this.url = null;
    this.store.setStatus("disconnected");
    this.store.setAuthenticatedPubkey(null);
  }

  /**
   * True when a socket is open AND its NIP-42 AUTH was signed by `pubkey`. The
   * strict form of "am I connected as this identity" that identity switching
   * relies on. A socket the relay never challenged has no authenticated pubkey
   * and answers `false` here even while `connected`.
   */
  isAuthenticatedAs(pubkey: string): boolean {
    return !!this.relay?.connected && this.store.authenticatedPubkey === pubkey;
  }

  /**
   * Registers a subscription (re-issued automatically across reconnects).
   * Call the returned handle's close() to stop it. `id` is optional and only
   * useful as a debugging label — every call gets its own independent
   * subscription (a fixed/shared id would make a second caller silently
   * orphan the first caller's live subscription in the registry).
   */
  subscribe(
    id: string | null,
    filters: NostrFilter[],
    handlers: {
      onEvent: (event: RawNostrEvent) => void;
      onEose?: () => void;
      onClosed?: (reason: string) => void;
    },
  ): RelaySubscriptionHandle {
    const subscriptionId = `${id ?? "sub"}-${++this.subscriptionSerial}`;
    const registered: RegisteredSubscription = {
      id: subscriptionId,
      filters,
      onEvent: handlers.onEvent,
      onEose: handlers.onEose,
      onClosed: handlers.onClosed,
      live: null,
      session: currentCommunityGeneration(),
    };
    this.subscriptions.set(subscriptionId, registered);
    if (this.relay?.connected) {
      this.issueSubscription(registered);
    }
    return {
      close: () => {
        registered.live?.close();
        this.subscriptions.delete(subscriptionId);
      },
    };
  }

  /** Returns the relay's OK "reason" string — e.g. kind:41010 (DM open) encodes `{"channel_id":...}` in it. */
  async publish(event: SignedEvent): Promise<string> {
    if (!this.relay?.connected) {
      throw new AppError("network", "Not connected to the server yet.");
    }
    try {
      return await this.relay.publish(event as unknown as NostrToolsEvent);
    } catch (err) {
      throw new AppError("relay_rejected", "That action wasn't accepted by the server.", err);
    }
  }

  /**
   * NIP-42 relay auth (unrelated to the app's Okta/NIP-46 identity auth —
   * this just proves control of the active Nostr keypair to *this* relay
   * connection, per docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md's auth-gated
   * subscriptions). `onauth` must be wired up before `connect()` opens the
   * socket: the relay sends its AUTH challenge as the very first message, and
   * nostr-tools only auto-responds if `onauth` was already set when that
   * message arrives — setting it after `Relay.connect()` resolves is a race.
   */
  private async signAuthEvent(event: NostrToolsEventTemplate): Promise<NostrToolsVerifiedEvent> {
    const signed = await getActiveSigningService().signEvent({
      kind: event.kind,
      content: event.content,
      tags: event.tags,
      created_at: event.created_at,
    });
    // Record WHO signed this socket's AUTH, from the signed event itself — the
    // one place the answer is real. Identity switching verifies against this,
    // not against "status === connected" (which is identity-blind).
    this.store.setAuthenticatedPubkey(signed.pubkey);
    return signed as unknown as NostrToolsVerifiedEvent;
  }

  private async attemptConnect(): Promise<void> {
    if (!this.url) return;
    const generation = ++this.connectGeneration;
    this.store.setAuthDenial(null); // a new attempt starts without the last one's verdict
    this.store.setStatus(this.store.reconnectAttempt > 0 ? "reconnecting" : "connecting");

    try {
      const relay = new Relay(this.url, { enableReconnect: false });
      let resolveInitialAuth: (() => void) | null = null;
      const initialAuthAttempted = new Promise<void>((resolve) => {
        resolveInitialAuth = resolve;
      });
      relay.onauth = async (event) => {
        try {
          return await this.signAuthEvent(event);
        } finally {
          resolveInitialAuth?.();
        }
      };
      await relay.connect({ timeout: CONNECT_TIMEOUT_MS });
      if (generation !== this.connectGeneration || this.manuallyClosed) {
        relay.close();
        return;
      }
      // This relay auth-gates nearly every subscription (see
      // docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md) and sends its NIP-42
      // challenge as the very first message after connecting. nostr-tools has
      // no built-in retry-after-auth for a rejected subscription, so give the
      // challenge a brief window to arrive and be signed before issuing the
      // initial subscription batch — otherwise it races ahead and every one
      // gets closed with "auth-required". If no challenge arrives (relay
      // doesn't require auth), this simply times out and proceeds normally.
      await Promise.race([
        initialAuthAttempted,
        new Promise<void>((resolve) => setTimeout(resolve, 750)),
      ]);

      // The relay's verdict on our AUTH. A closed relay answers a non-member with
      // `OK false "restricted: not a relay member"` (a banned key with "blocked: …").
      // nostr-tools reports that only through the auth promise, which nothing else
      // reads — so without this the app reached "connected" as a non-member, every
      // subscription silently returned nothing, and login ended "ready" with no role.
      // `relay.auth()` returns the already-started AUTH promise (it is cached).
      const outcome = await Promise.race([
        relay
          .auth((event) => this.signAuthEvent(event))
          .then(
            () => null,
            (error: unknown) => authDenialFrom(error),
          ),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), AUTH_VERDICT_TIMEOUT_MS)),
      ]);
      if (outcome !== null) {
        relay.close();
        if (generation === this.connectGeneration && !this.manuallyClosed) {
          logError("RelayConnectionService.auth", new AppError("auth_failed", outcome));
          this.store.setStatus("error", authDenialMessage(outcome));
          this.store.setAuthDenial(authDenialKind(outcome));
        }
        // Deliberately no reconnect: a refused identity is not a transient failure.
        // (`relay.onclose` is not set yet, so closing here cannot schedule one.)
        return;
      }

      this.relay = relay;
      relay.onclose = () => this.handleClose(generation);
      this.store.setStatus("connected");
      for (const sub of this.subscriptions.values()) {
        this.issueSubscription(sub);
      }
    } catch (err) {
      logError("RelayConnectionService.connect", err);
      if (generation !== this.connectGeneration || this.manuallyClosed) return;
      this.store.setStatus("error", this.connectFailureMessage());
      this.scheduleReconnect();
    }
  }

  /** A loopback URL almost always means "your local buzz-relay isn't running yet," not a generic network problem. */
  private connectFailureMessage(): string {
    const isLoopback = !!this.url && /^wss?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(this.url);
    return isLoopback
      ? "Can't reach the local Buzz relay. Make sure it's running (see docs/LOCAL_DEVELOPMENT.md)."
      : "Can't reach the Buzz server right now.";
  }

  private handleClose(generation: number): void {
    if (generation !== this.connectGeneration || this.manuallyClosed) return;
    this.relay = null;
    for (const sub of this.subscriptions.values()) {
      sub.live = null;
    }
    // The socket that was authenticated is gone; the reconnect signs a fresh AUTH.
    this.store.setStatus("disconnected", "Lost connection to the Buzz server. Reconnecting…");
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.manuallyClosed || this.reconnectTimer) return;
    const attempt = this.store.reconnectAttempt;
    const delay = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
    this.store.incrementReconnectAttempt();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.attemptConnect();
    }, delay);
  }

  private issueSubscription(sub: RegisteredSubscription): void {
    if (!this.relay) return;
    // A subscription from an ended community session never reaches the new
    // socket, and nothing that was already in flight for it is delivered: an
    // event from community A must not be written into community B's state.
    const current = () => isCurrentCommunitySession(sub.session);
    if (!current()) {
      this.subscriptions.delete(sub.id);
      return;
    }
    const live = this.relay.subscribe(sub.filters as NostrToolsFilter[], {
      onevent: (evt: NostrToolsEvent) => {
        if (current()) sub.onEvent(evt as unknown as RawNostrEvent);
      },
      oneose: () => {
        if (current()) sub.onEose?.();
      },
      // The relay refused or ended this REQ before EOSE. A dropped socket is
      // not a refusal — the subscription is re-issued on reconnect — so only a
      // relay-sent CLOSED reason is passed on.
      onclose: (reason: string) => {
        if (current() && !isConnectionLoss(reason)) sub.onClosed?.(reason);
      },
      // nostr-tools hands us what IT rejected — for a `#h`-scoped subscription
      // that includes every relay-delivered kind:7/kind:5 (virtual channel tag,
      // see matchesAllowingVirtualChannelTag). Re-check with the relay's own
      // rule and verify the signature ourselves before delivering.
      oninvalidevent: (rejected: unknown) => {
        const evt = rejected as NostrToolsEvent;
        const raw = evt as unknown as RawNostrEvent;
        if (
          current() &&
          matchesAllowingVirtualChannelTag(sub.filters, raw) &&
          nostrToolsVerifyEvent(evt)
        ) {
          sub.onEvent(raw);
        }
      },
    });
    sub.live = { close: () => live.close() };
  }
}

/** Single application-wide instance — see docs/ARCHITECTURE.md §7. */
export const relayConnectionService = new RelayConnectionService();
