import {
  relayConnectionService,
  type RelaySubscriptionHandle,
} from "@/services/RelayConnectionService";
import { signAndPublish } from "@/services/publish";
import {
  buildTypingFilter,
  buildTypingIndicatorEvent,
  parseTypingIndicatorEvent,
  type ParsedTypingEvent,
} from "@/protocol/typing";

class TypingService {
  async notify(
    channelId: string,
    thread?: { rootEventId: string; parentEventId: string },
  ): Promise<void> {
    await signAndPublish(buildTypingIndicatorEvent({ channelId, thread }));
  }

  subscribe(
    channelId: string,
    onTyping: (event: ParsedTypingEvent) => void,
  ): RelaySubscriptionHandle {
    return relayConnectionService.subscribe("typing-live", [buildTypingFilter(channelId)], {
      onEvent: (event) => {
        const parsed = parseTypingIndicatorEvent(event);
        if (parsed) onTyping(parsed);
      },
    });
  }
}

export const typingService = new TypingService();
