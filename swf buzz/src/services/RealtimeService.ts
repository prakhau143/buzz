/**
 * Owns the single WebSocket connection to `swf-buzz-backend`'s `/ws`
 * realtime fan-out (DECISIONS.md D10, Phase 6 — see
 * `swf buzz/docs/MESSAGING_DESIGN.md`). Deliberately separate from
 * `RelayConnectionService.ts` (the old Nostr relay socket) — this is a
 * different server, a different wire protocol, and a different identity
 * model, not a replacement for it.
 *
 * Auth: the bearer session token travels as a `?token=` query param, not an
 * `Authorization` header — the browser `WebSocket` constructor cannot set
 * arbitrary headers on the handshake. Same tradeoff the backend's own
 * `routes/realtime.rs` documents: the token is validated exactly the same
 * way as every other endpoint, this is just where it has to travel.
 *
 * Wire shape (see `backend/src/routes/realtime.rs::forward_event`):
 *   {"type": "message.created", "channel_id": "...", "message": {...}}
 *   {"type": "dm_message.created", "conversation_id": "...", "message": {...}}
 *
 * Connect-time membership snapshot: the server only forwards events for
 * channels/DM conversations the caller belonged to *at connect time* —
 * joining something new requires a reconnect to start receiving its
 * events. This service does not hide that limitation; callers that need a
 * newly-joined channel's live updates must call `reconnect()`.
 */
import { backendWsUrl } from "@/app/config";
import { getStoredSessionToken } from "./ApiClient";

export interface NewMessageEventPayload {
  type: "message.created";
  channel_id: string;
  message: unknown;
}

export interface NewDmMessageEventPayload {
  type: "dm_message.created";
  conversation_id: string;
  message: unknown;
}

export type RealtimeEventPayload = NewMessageEventPayload | NewDmMessageEventPayload;

export type RealtimeStatus = "disconnected" | "connecting" | "connected" | "reconnecting";

const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;

type Listener = (event: RealtimeEventPayload) => void;

export class RealtimeService {
  private socket: WebSocket | null = null;
  private readonly listeners = new Set<Listener>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private manuallyClosed = true;
  private connectGeneration = 0;
  private _status: RealtimeStatus = "disconnected";
  private readonly statusListeners = new Set<(status: RealtimeStatus) => void>();

  get status(): RealtimeStatus {
    return this._status;
  }

  /** (Re)opens the socket using the currently-stored session token. No-op if already connected/connecting. */
  async connect(): Promise<void> {
    this.manuallyClosed = false;
    await this.attemptConnect();
  }

  /** Forces a fresh connection — e.g. after joining a new channel, to pick up its events (see module doc comment). */
  async reconnect(): Promise<void> {
    this.teardownSocket();
    await this.connect();
  }

  disconnect(): void {
    this.manuallyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.teardownSocket();
    this.setStatus("disconnected");
  }

  onEvent(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onStatusChange(listener: (status: RealtimeStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  private setStatus(status: RealtimeStatus): void {
    this._status = status;
    for (const listener of this.statusListeners) listener(status);
  }

  private teardownSocket(): void {
    if (this.socket) {
      this.socket.onopen = null;
      this.socket.onmessage = null;
      this.socket.onclose = null;
      this.socket.onerror = null;
      this.socket.close();
    }
    this.socket = null;
  }

  private async attemptConnect(): Promise<void> {
    const token = await getStoredSessionToken();
    if (!token) {
      // No session yet (e.g. dev mode / browser build without Tauri
      // keychain access) — nothing to connect with. Not an error; callers
      // simply won't receive realtime events until a session exists.
      this.setStatus("disconnected");
      return;
    }

    const generation = ++this.connectGeneration;
    this.setStatus(this.reconnectAttempt > 0 ? "reconnecting" : "connecting");

    const url = `${backendWsUrl()}/ws?token=${encodeURIComponent(token)}`;
    const socket = new WebSocket(url);

    socket.onopen = () => {
      if (generation !== this.connectGeneration || this.manuallyClosed) {
        socket.close();
        return;
      }
      this.reconnectAttempt = 0;
      this.setStatus("connected");
    };

    socket.onmessage = (event: MessageEvent<string>) => {
      let payload: RealtimeEventPayload;
      try {
        payload = JSON.parse(event.data) as RealtimeEventPayload;
      } catch {
        return; // malformed frame — ignore rather than crash the socket handler
      }
      for (const listener of this.listeners) listener(payload);
    };

    socket.onclose = () => {
      if (generation !== this.connectGeneration || this.manuallyClosed) return;
      this.socket = null;
      this.setStatus("disconnected");
      this.scheduleReconnect();
    };

    socket.onerror = () => {
      // `onclose` always follows `onerror` for a WebSocket — reconnect logic lives there only.
    };

    this.socket = socket;
  }

  private scheduleReconnect(): void {
    if (this.manuallyClosed || this.reconnectTimer) return;
    const delay = Math.min(BASE_BACKOFF_MS * 2 ** this.reconnectAttempt, MAX_BACKOFF_MS);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.attemptConnect();
    }, delay);
  }
}

/** Single application-wide instance — mirrors `relayConnectionService`'s singleton pattern. */
export const realtimeService = new RealtimeService();
