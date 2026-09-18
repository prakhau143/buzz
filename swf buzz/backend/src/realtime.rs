//! Realtime fan-out (Phase 6 channel messages, extended in Phase 8 for
//! DMs, DECISIONS.md D10). A single process-wide `tokio::sync::broadcast`
//! channel carrying both event kinds; every WebSocket connection
//! subscribes once and filters events down to the channels/conversations
//! it belongs to, a snapshot captured once at connect time -- see
//! docs/MESSAGING_DESIGN.md and docs/DM_DESIGN.md for what that
//! limitation does and doesn't cover (a channel/DM joined after
//! connecting isn't picked up until the socket reconnects).

use crate::models::{DmMessage, Message};
use tokio::sync::broadcast;
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct NewMessageEvent {
    pub channel_id: Uuid,
    pub message: Message,
}

#[derive(Debug, Clone)]
pub struct NewDmMessageEvent {
    pub conversation_id: Uuid,
    pub message: DmMessage,
}

#[derive(Debug, Clone)]
pub enum RealtimeEvent {
    NewMessage(NewMessageEvent),
    NewDmMessage(NewDmMessageEvent),
}

#[derive(Clone)]
pub struct Broadcaster {
    sender: broadcast::Sender<RealtimeEvent>,
}

impl Broadcaster {
    pub fn new() -> Self {
        let (sender, _) = broadcast::channel(1024);
        Self { sender }
    }

    /// No connected receivers is a normal, expected state (nobody has this
    /// channel/conversation open right now) -- not an error, never logged
    /// as one.
    pub fn publish(&self, event: RealtimeEvent) {
        let _ = self.sender.send(event);
    }

    pub fn subscribe(&self) -> broadcast::Receiver<RealtimeEvent> {
        self.sender.subscribe()
    }
}

impl Default for Broadcaster {
    fn default() -> Self {
        Self::new()
    }
}
