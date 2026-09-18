/**
 * Owns the single WebSocket connection to buzz-relay. Per docs/ARCHITECTURE.md §7,
 * this stays a single well-tested class rather than being split prematurely.
 * Reconnection uses capped exponential backoff; active subscriptions are
 * re-issued from an in-memory registry on every (re)connect.
 */
import { Relay } from "nostr-tools/relay";
import type {
  Event as NostrToolsEvent,
  EventTemplate as NostrToolsEventTemplate,
  Filter as NostrToolsFilter,
  VerifiedEvent as NostrToolsVerifiedEvent,
} from "nostr-tools";
import { useConnectionStore } from "@/stores/connection";
import { AppError, logError } from "@/services/errors";
import type { NostrFilter, RawNostrEvent } from "@/protocol/types";
import type { SignedEvent } from "@/features/signing/types";
import { getActiveSigningService } from "@/features/signing/signingServiceRegistry";

const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;
const CONNECT_TIMEOUT_MS = 10_000;

export interface RelaySubscriptionHandle {
  close(): void;
}

interface RegisteredSubscription {
  id: string;
  filters: NostrFilter[];
  onEvent: (event: RawNostrEvent) => void;
  onEose?: () => void;
  live: RelaySubscriptionHandle | null;
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
    this.store.setStatus("disconnected");
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
    handlers: { onEvent: (event: RawNostrEvent) => void; onEose?: () => void },
  ): RelaySubscriptionHandle {
    const subscriptionId = `${id ?? "sub"}-${++this.subscriptionSerial}`;
    const registered: RegisteredSubscription = {
      id: subscriptionId,
      filters,
      onEvent: handlers.onEvent,
      onEose: handlers.onEose,
      live: null,
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
    return signed as unknown as NostrToolsVerifiedEvent;
  }

  private async attemptConnect(): Promise<void> {
    if (!this.url) return;
    const generation = ++this.connectGeneration;
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
    const live = this.relay.subscribe(sub.filters as NostrToolsFilter[], {
      onevent: (evt: NostrToolsEvent) => sub.onEvent(evt as unknown as RawNostrEvent),
      oneose: sub.onEose,
    });
    sub.live = { close: () => live.close() };
  }
}

/** Single application-wide instance — see docs/ARCHITECTURE.md §7. */
export const relayConnectionService = new RelayConnectionService();
