import { describe, expect, it } from "vitest";
import {
  buildAddRelayMemberEvent,
  buildChangeRelayMemberRoleEvent,
  buildRemoveRelayMemberEvent,
  parseRelayMembershipListEvent,
  relayMembershipListFilter,
} from "@/protocol/relayMembers";
import { KIND_NIP43_MEMBERSHIP_LIST, KIND_RELAY_ADMIN_ADD_MEMBER } from "@/protocol/kinds";
import type { RawNostrEvent } from "@/protocol/types";

const ALICE = "a".repeat(64);
const BOB = "b".repeat(64);

function snapshotEvent(tags: string[][]): RawNostrEvent {
  return {
    id: "id",
    pubkey: "relay",
    created_at: 100,
    kind: KIND_NIP43_MEMBERSHIP_LIST,
    tags,
    content: "",
    sig: "sig",
  };
}

describe("buildAddRelayMemberEvent", () => {
  it("builds a kind:9030 event with p and role tags", () => {
    const event = buildAddRelayMemberEvent({ pubkey: ALICE, role: "admin" });
    expect(event.kind).toBe(KIND_RELAY_ADMIN_ADD_MEMBER);
    expect(event.tags).toEqual([
      ["p", ALICE],
      ["role", "admin"],
    ]);
  });
});

describe("buildRemoveRelayMemberEvent", () => {
  it("builds a kind:9031 event with only a p tag", () => {
    const event = buildRemoveRelayMemberEvent({ pubkey: ALICE });
    expect(event.tags).toEqual([["p", ALICE]]);
  });
});

describe("buildChangeRelayMemberRoleEvent", () => {
  it("builds a kind:9032 event with p and role tags", () => {
    const event = buildChangeRelayMemberRoleEvent({ pubkey: ALICE, role: "member" });
    expect(event.tags).toEqual([
      ["p", ALICE],
      ["role", "member"],
    ]);
  });
});

describe("relayMembershipListFilter", () => {
  it("filters for kind:13534 only, no author restriction", () => {
    expect(relayMembershipListFilter()).toEqual({ kinds: [KIND_NIP43_MEMBERSHIP_LIST], limit: 1 });
  });
});

describe("parseRelayMembershipListEvent", () => {
  it("parses member tags with roles", () => {
    const members = parseRelayMembershipListEvent(
      snapshotEvent([
        ["-"],
        ["member", ALICE, "owner"],
        ["member", BOB, "member"],
      ]),
    );
    expect(members).toEqual([
      { pubkey: ALICE, role: "owner" },
      { pubkey: BOB, role: "member" },
    ]);
  });

  it("defaults an unrecognized role to member", () => {
    const members = parseRelayMembershipListEvent(snapshotEvent([["member", ALICE, "superadmin"]]));
    expect(members).toEqual([{ pubkey: ALICE, role: "member" }]);
  });

  it("deduplicates repeated pubkeys, keeping the first occurrence", () => {
    const members = parseRelayMembershipListEvent(
      snapshotEvent([
        ["member", ALICE, "owner"],
        ["member", ALICE, "member"],
      ]),
    );
    expect(members).toEqual([{ pubkey: ALICE, role: "owner" }]);
  });

  it("ignores non-hex or malformed pubkeys", () => {
    const members = parseRelayMembershipListEvent(
      snapshotEvent([["member", "not-a-pubkey", "owner"]]),
    );
    expect(members).toEqual([]);
  });

  it("normalizes pubkey case", () => {
    const members = parseRelayMembershipListEvent(
      snapshotEvent([["member", ALICE.toUpperCase(), "owner"]]),
    );
    expect(members).toEqual([{ pubkey: ALICE, role: "owner" }]);
  });

  it("tolerates the legacy p-tag shape", () => {
    const members = parseRelayMembershipListEvent(snapshotEvent([["p", ALICE, "", "admin"]]));
    expect(members).toEqual([{ pubkey: ALICE, role: "admin" }]);
  });
});
