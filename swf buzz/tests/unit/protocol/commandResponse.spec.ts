import { describe, expect, it } from "vitest";
import { parseCommandResponse } from "@/protocol/commandResponse";

interface DmOpen {
  channel_id?: string;
  created?: boolean;
}

describe("parseCommandResponse", () => {
  it("strips the response: prefix the relay actually sends", () => {
    // Verbatim shape from buzz-relay command_executor.rs handle_dm_open.
    const okReason = 'response:{"channel_id":"2f1c8a30-0d5e-4f21-9a77-1b6c5d3e9a44","created":true}';
    expect(parseCommandResponse<DmOpen>(okReason)).toEqual({
      channel_id: "2f1c8a30-0d5e-4f21-9a77-1b6c5d3e9a44",
      created: true,
    });
  });

  it("accepts raw JSON without the prefix, for relays that omit it", () => {
    expect(parseCommandResponse<DmOpen>('{"channel_id":"abc123"}')).toEqual({
      channel_id: "abc123",
    });
  });

  it("returns null for the plain-text duplicate acknowledgement", () => {
    expect(parseCommandResponse<DmOpen>("duplicate: already processed")).toBeNull();
  });

  it("returns null when the payload after the prefix is not JSON", () => {
    expect(parseCommandResponse<DmOpen>("response:not-json")).toBeNull();
  });

  it("returns null for an empty reason", () => {
    expect(parseCommandResponse<DmOpen>("")).toBeNull();
  });

  it("returns null for valid JSON that is not an object", () => {
    // `JSON.parse` would return these happily; none can carry named fields.
    expect(parseCommandResponse<DmOpen>("response:null")).toBeNull();
    expect(parseCommandResponse<DmOpen>("response:42")).toBeNull();
    expect(parseCommandResponse<DmOpen>('response:"ok"')).toBeNull();
  });

  it("strips only the leading prefix, leaving the JSON body untouched", () => {
    const parsed = parseCommandResponse<{ note: string }>(
      'response:{"note":"response: inside a value"}',
    );
    expect(parsed).toEqual({ note: "response: inside a value" });
  });
});
