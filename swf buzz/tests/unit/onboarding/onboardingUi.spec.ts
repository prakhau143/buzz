import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import IdentityImportForm from "@/features/onboarding/ui/IdentityImportForm.vue";
import IdentitySetup from "@/features/onboarding/ui/IdentitySetup.vue";
import BackupPanel from "@/features/onboarding/ui/BackupPanel.vue";
import JoinInvitePanel from "@/features/onboarding/ui/JoinInvitePanel.vue";
import { clearCommunitiesForTests, communities } from "@/features/communities/relayCommunities";
import { clearActiveSigningService } from "@/features/signing/signingServiceRegistry";
import { decodeNip98, json, tagValue } from "../helpers/fakeSigner";
import { sha256Hex } from "@/services/nip98";

/** Flush promises, allow real timers/IO in the async claim chain to run, flush again. */
const settle = async () => {
  await flushPromises();
  await new Promise((resolve) => setTimeout(resolve, 25));
  await flushPromises();
};

const invokeMock = vi.fn();
const isTauriMock = vi.fn(() => true);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  isTauri: () => isTauriMock(),
}));
vi.mock("@/services/RelayConnectionService", () => ({
  relayConnectionService: { connect: vi.fn(), disconnect: vi.fn(), subscribe: vi.fn() },
}));

const PK = "ab".repeat(32);
const INFO = { pubkey: PK, npub: "npub1x", storage: "system-keyring", recovery: "none" };
const NONE = { pubkey: null, npub: null, storage: "none", recovery: "none" };

/**
 * Routes Tauri commands; anything unexpected fails the test loudly.
 * `preview_identity_input` (the import form's "Check key" step) is answered by
 * default — tests that care about it override it.
 */
function tauri(handlers: Record<string, (args?: unknown) => unknown>) {
  invokeMock.mockImplementation(async (command: string, args?: unknown) => {
    const handler = handlers[command] ?? DEFAULT_HANDLERS[command];
    if (!handler) throw new Error(`unexpected Tauri command: ${command}`);
    return handler(args);
  });
}
const DEFAULT_HANDLERS: Record<string, (args?: unknown) => unknown> = {
  preview_identity_input: () => ({ pubkey: PK, npub: "npub1x", looksLikeBareHex: false }),
};
const commandsCalled = () => invokeMock.mock.calls.map((c) => c[0] as string);

/**
 * The import form is two-step since the operator-key incident: "Check key"
 * (resolve which identity the input is, storing nothing) → confirm → submit.
 */
async function checkThenSubmit(wrapper: ReturnType<typeof mount>) {
  await wrapper.find("[data-testid=import-check]").trigger("click");
  await settle();
  await wrapper.find("form").trigger("submit");
  await settle();
}

beforeEach(() => {
  setActivePinia(createPinia());
  invokeMock.mockReset();
  isTauriMock.mockReturnValue(true);
  localStorage.clear();
  clearCommunitiesForTests();
  clearActiveSigningService();
  vi.unstubAllGlobals();
});

describe("IdentityImportForm — the typed secret never lingers", () => {
  it("submits an nsec/hex key without a password, then clears the field", async () => {
    tauri({});
    const wrapper = mount(IdentityImportForm);
    await wrapper.find("[data-testid=import-secret]").setValue("nsec1abcdef");
    expect(wrapper.find("[data-testid=import-password]").exists()).toBe(false);

    await checkThenSubmit(wrapper);

    expect(wrapper.emitted("submit")).toEqual([["nsec1abcdef", undefined, false]]);
    expect((wrapper.find("[data-testid=import-secret]").element as HTMLInputElement).value).toBe("");
  });

  it("an ncryptsec backup asks for its password, requires it, and clears both fields", async () => {
    tauri({});
    const wrapper = mount(IdentityImportForm);
    await wrapper.find("[data-testid=import-secret]").setValue("ncryptsec1abcdef");
    expect(wrapper.find("[data-testid=import-password]").exists()).toBe(true);
    expect(wrapper.find("[data-testid=import-check]").attributes("disabled")).toBeDefined();

    await wrapper.find("[data-testid=import-password]").setValue("correct horse battery");
    expect(wrapper.find("[data-testid=import-check]").attributes("disabled")).toBeUndefined();
    await checkThenSubmit(wrapper);

    expect(wrapper.emitted("submit")).toEqual([["ncryptsec1abcdef", "correct horse battery", false]]);
    expect((wrapper.find("[data-testid=import-secret]").element as HTMLInputElement).value).toBe("");
    expect(wrapper.find("[data-testid=import-password]").exists()).toBe(false);
  });

  it("uses password inputs so the secret is never shown on screen", () => {
    const wrapper = mount(IdentityImportForm);
    expect(wrapper.find("[data-testid=import-secret]").attributes("type")).toBe("password");
  });

  it("requires an explicit confirmation when it would overwrite an unreadable identity", async () => {
    tauri({});
    const wrapper = mount(IdentityImportForm, { props: { needsConfirm: true } });
    await wrapper.find("[data-testid=import-secret]").setValue("nsec1abcdef");
    await wrapper.find("[data-testid=import-check]").trigger("click");
    await settle();
    expect(wrapper.find("[data-testid=import-submit]").attributes("disabled")).toBeDefined();
    await wrapper.find("[data-testid=import-confirm]").setValue(true);
    expect(wrapper.find("[data-testid=import-submit]").attributes("disabled")).toBeUndefined();
  });

  it("does not submit an empty form", async () => {
    const wrapper = mount(IdentityImportForm);
    await wrapper.find("form").trigger("submit");
    expect(wrapper.emitted("submit")).toBeUndefined();
  });

  /**
   * The operator-key incident (PHASE_3_FINAL_IMPLEMENTATION_REPORT.md §1a): a
   * 64-char hex PUBLIC key is accepted as a private key and silently yields a
   * different identity. The form must not import until the resulting identity
   * has been shown, and must say so loudly for bare-hex input.
   */
  /**
   * THE bug this contract exists for (docs/DEV_RESET_2026_09_22.md): an
   * operator's PUBLIC key pasted here was parsed as a private scalar and
   * silently produced an unrelated identity. Raw hex is now refused outright on
   * the normal path — nothing is decoded, nothing is previewed, nothing is
   * imported — because a public key is the same length as a private one.
   */
  it("REJECTS raw 64-char hex on the normal path: no preview, no import, and Rust is never asked", async () => {
    const OPERATOR_PUBKEY = "38eb252a95f6fa3c92055a639f76b9cfa64774bd4fa03a1608237176463f2ca8";
    const preview = vi.fn();
    tauri({ preview_identity_input: preview });
    const wrapper = mount(IdentityImportForm);

    await wrapper.find("[data-testid=import-secret]").setValue(OPERATOR_PUBKEY);

    expect(wrapper.find("[data-testid=import-npub-error]").text()).toContain("ambiguous");
    expect(wrapper.find("[data-testid=import-check]").attributes("disabled")).toBeDefined();
    expect(wrapper.find("[data-testid=import-submit]").attributes("disabled")).toBeDefined();
    await wrapper.find("form").trigger("submit");
    expect(wrapper.emitted("submit")).toBeUndefined();
    expect(preview).not.toHaveBeenCalled(); // nothing was even decoded
    expect(wrapper.find("[data-testid=import-preview]").exists()).toBe(false);
  });

  it("an npub is refused as a public identity — never derived from", async () => {
    const preview = vi.fn();
    tauri({ preview_identity_input: preview });
    const wrapper = mount(IdentityImportForm);
    await wrapper.find("[data-testid=import-secret]").setValue("npub1" + "q".repeat(58));
    expect(wrapper.find("[data-testid=import-npub-error]").text()).toContain("cannot be used to sign in");
    expect(wrapper.find("[data-testid=import-check]").attributes("disabled")).toBeDefined();
    expect(preview).not.toHaveBeenCalled();
  });

  it("the developer opt-in re-enables raw hex, and forwards that choice to Rust", async () => {
    const HEX = "a".repeat(64);
    const preview = vi.fn(() => ({ pubkey: "cd".repeat(32), npub: "npub1dev", looksLikeBareHex: true }));
    tauri({ preview_identity_input: preview });
    const wrapper = mount(IdentityImportForm);

    await wrapper.find("[data-testid=import-secret]").setValue(HEX);
    expect(wrapper.find("[data-testid=import-check]").attributes("disabled")).toBeDefined();

    await wrapper.find("[data-testid=import-allow-hex]").setValue(true);
    expect(wrapper.find("[data-testid=import-npub-error]").exists()).toBe(false);
    await wrapper.find("[data-testid=import-check]").trigger("click");
    await settle();
    expect((preview.mock.calls[0] as unknown[])[0]).toEqual({
      input: HEX,
      password: null,
      allowRawHex: true,
    });
    // The identity it would sign as is shown before anything is committed.
    expect(wrapper.find("[data-testid=import-preview-npub]").text()).toBe("npub1dev");
    expect(wrapper.find("[data-testid=import-hex-warning]").text()).toContain("private");

    await wrapper.find("form").trigger("submit");
    expect(wrapper.emitted("submit")).toEqual([[HEX, undefined, true]]);
  });

  it("editing the key after a check invalidates it — an import can never use a stale preview", async () => {
    tauri({});
    const wrapper = mount(IdentityImportForm);
    await wrapper.find("[data-testid=import-secret]").setValue("nsec1aaa");
    await wrapper.find("[data-testid=import-check]").trigger("click");
    await settle();
    expect(wrapper.find("[data-testid=import-preview]").exists()).toBe(true);

    await wrapper.find("[data-testid=import-secret]").setValue("nsec1bbb");
    expect(wrapper.find("[data-testid=import-preview]").exists()).toBe(false);
    expect(wrapper.find("[data-testid=import-submit]").attributes("disabled")).toBeDefined();
    await wrapper.find("form").trigger("submit");
    expect(wrapper.emitted("submit")).toBeUndefined();
  });

  it("a key that cannot be read shows Rust's reason and imports nothing", async () => {
    tauri({ preview_identity_input: () => { throw "wrong backup password, or the backup is damaged"; } });
    const wrapper = mount(IdentityImportForm);
    await wrapper.find("[data-testid=import-secret]").setValue("ncryptsec1abc");
    await wrapper.find("[data-testid=import-password]").setValue("wrong wrong wrong");
    await wrapper.find("[data-testid=import-check]").trigger("click");
    await settle();
    expect(wrapper.find("[data-testid=import-check-error]").text()).toContain("wrong backup password");
    expect(wrapper.find("[data-testid=import-preview]").exists()).toBe(false);
    expect(wrapper.emitted("submit")).toBeUndefined();
  });
});

describe("IdentitySetup — new identity, import, and the three recovery states", () => {
  it("NEW IDENTITY: 'Create new identity' generates NOTHING here — it hands over to the backup checkpoint (CreateIdentityFlow)", async () => {
    tauri({});
    const wrapper = mount(IdentitySetup, { props: { recovery: "none" } });

    await wrapper.find("[data-testid=create-identity]").trigger("click");
    await settle();

    expect(commandsCalled()).toEqual([]); // no Rust call: the key is generated only after the passphrase step
    expect(wrapper.emitted("create")).toHaveLength(1);
    expect(wrapper.emitted("ready")).toBeUndefined();
  });

  it("FIRST LAUNCH offers exactly two things: 'Import existing identity' and 'Create new identity' — no public-key box", () => {
    const wrapper = mount(IdentitySetup, { props: { recovery: "none" } });
    expect(wrapper.find("[data-testid=show-import]").text()).toBe("Import existing identity");
    expect(wrapper.find("[data-testid=create-identity]").text()).toBe("Create new identity");
    expect(wrapper.findAll("input")).toHaveLength(0); // nothing to type until Import is chosen
  });

  it("IMPORT: an nsec goes to Rust's import command and reports 'imported'", async () => {
    tauri({ import_identity: () => INFO });
    const wrapper = mount(IdentitySetup, { props: { recovery: "none" } });
    await wrapper.find("[data-testid=show-import]").trigger("click");

    await wrapper.find("[data-testid=import-secret]").setValue("nsec1abcdef");
    await checkThenSubmit(wrapper);

    expect(invokeMock).toHaveBeenCalledWith("import_identity", { input: "nsec1abcdef", password: null, allowRawHex: false });
    expect(wrapper.emitted("ready")?.[0]).toEqual([INFO, "imported"]);
  });

  it("IMPORT: an ncryptsec backup is decrypted in Rust with its password", async () => {
    tauri({ import_identity: () => INFO });
    const wrapper = mount(IdentitySetup, { props: { recovery: "none" } });
    await wrapper.find("[data-testid=show-import]").trigger("click");

    await wrapper.find("[data-testid=import-secret]").setValue("ncryptsec1abc");
    await wrapper.find("[data-testid=import-password]").setValue("correct horse battery");
    await checkThenSubmit(wrapper);

    expect(invokeMock).toHaveBeenCalledWith("import_identity", {
      input: "ncryptsec1abc",
      password: "correct horse battery",
      allowRawHex: false,
    });
  });

  it("IMPORT failure (wrong password) shows Rust's message and reports nothing as ready", async () => {
    tauri({
      import_identity: () => {
        throw "wrong backup password, or the backup is damaged";
      },
    });
    const wrapper = mount(IdentitySetup, { props: { recovery: "none" } });
    await wrapper.find("[data-testid=show-import]").trigger("click");
    await wrapper.find("[data-testid=import-secret]").setValue("ncryptsec1abc");
    await wrapper.find("[data-testid=import-password]").setValue("wrong wrong wrong");
    await checkThenSubmit(wrapper);

    expect(wrapper.find("[data-testid=setup-error]").text()).toContain("wrong backup password");
    expect(wrapper.emitted("ready")).toBeUndefined();
  });

  it("RECOVERY keyring-locked: explains it, and offers neither create nor import", () => {
    const wrapper = mount(IdentitySetup, { props: { recovery: "keyring-locked" } });
    expect(wrapper.find("[data-testid=recovery-locked]").text()).toContain("locked");
    expect(wrapper.find("[data-testid=create-identity]").exists()).toBe(false);
    expect(wrapper.find("[data-testid=import-secret]").exists()).toBe(false);
    expect(wrapper.text()).toContain("will not be created");
  });

  it("RECOVERY lost: warns, and offers both import (recover) and create (start over)", () => {
    const wrapper = mount(IdentitySetup, { props: { recovery: "lost" } });
    expect(wrapper.find("[data-testid=recovery-lost]").text()).toContain("could not be found");
    expect(wrapper.find("[data-testid=create-identity]").exists()).toBe(true);
    expect(wrapper.find("[data-testid=show-import]").exists()).toBe(true);
  });

  it("RECOVERY corrupt: warns, hides create entirely, and only imports — after a confirmation", async () => {
    tauri({ import_identity: () => INFO });
    const wrapper = mount(IdentitySetup, { props: { recovery: "corrupt" } });

    expect(wrapper.find("[data-testid=recovery-corrupt]").text()).toContain("left untouched");
    expect(wrapper.find("[data-testid=create-identity]").exists()).toBe(false);
    await wrapper.find("[data-testid=import-secret]").setValue("nsec1abcdef");
    await wrapper.find("[data-testid=import-check]").trigger("click");
    await settle();
    expect(wrapper.find("[data-testid=import-submit]").attributes("disabled")).toBeDefined();
    await wrapper.find("[data-testid=import-confirm]").setValue(true);
    await wrapper.find("form").trigger("submit");
    await settle();

    expect(commandsCalled()).toEqual(["preview_identity_input", "import_identity"]);
    expect(wrapper.emitted("ready")?.[0][1]).toBe("imported");
  });

  it("Rust refusing to create (e.g. locked/corrupt underneath) is shown by the create flow, not swallowed", async () => {
    tauri({
      create_identity_with_backup: () => {
        throw "secure storage is locked — unlock it and restart the app; not creating a new identity";
      },
    });
    const { default: CreateIdentityFlow } = await import("@/features/onboarding/ui/CreateIdentityFlow.vue");
    const wrapper = mount(CreateIdentityFlow);
    await wrapper.find("[data-testid=create-backup-password]").setValue("correct horse battery");
    await wrapper.find("[data-testid=create-backup-confirm]").setValue("correct horse battery");
    await wrapper.find("[data-testid=create-identity-submit]").trigger("click");
    await settle();
    expect(wrapper.find("[data-testid=create-error]").text()).toContain("locked");
    expect(wrapper.emitted("confirmed")).toBeUndefined();
  });
});

describe("CreateIdentityFlow — the private key exists only on the reveal screen", () => {
  const REVEAL = { pubkey: "ab".repeat(32), npub: "npub1x", nsec: "nsec1testonlyfixture", ncryptsec: "ncryptsec1x" };

  async function toReveal() {
    tauri({ create_identity_with_backup: () => REVEAL });
    const { default: CreateIdentityFlow } = await import("@/features/onboarding/ui/CreateIdentityFlow.vue");
    const wrapper = mount(CreateIdentityFlow);
    await wrapper.find("[data-testid=create-backup-password]").setValue("correct horse battery");
    await wrapper.find("[data-testid=create-backup-confirm]").setValue("correct horse battery");
    await wrapper.find("[data-testid=create-identity-submit]").trigger("click");
    await settle();
    return wrapper;
  }

  it("the passphrase is validated (length, match) before Rust is asked, and cleared right after", async () => {
    tauri({ create_identity_with_backup: () => REVEAL });
    const { default: CreateIdentityFlow } = await import("@/features/onboarding/ui/CreateIdentityFlow.vue");
    const wrapper = mount(CreateIdentityFlow);
    await wrapper.find("[data-testid=create-backup-password]").setValue("short");
    expect(wrapper.find("[data-testid=create-password-problem]").text()).toContain("at least 12");
    expect(wrapper.find("[data-testid=create-identity-submit]").attributes("disabled")).toBeDefined();
    await wrapper.find("[data-testid=create-backup-password]").setValue("correct horse battery");
    await wrapper.find("[data-testid=create-backup-confirm]").setValue("different different");
    expect(wrapper.find("[data-testid=create-password-problem]").text()).toContain("don't match");
    expect(commandsCalled()).toEqual([]);
  });

  it("confirmed: emits the PUBLIC key only, and the nsec is cleared from the component before emitting", async () => {
    const wrapper = await toReveal();
    await wrapper.find("[data-testid=toggle-nsec]").trigger("click");
    expect(wrapper.find("[data-testid=reveal-nsec]").text()).toBe("nsec1testonlyfixture");
    await wrapper.find("[data-testid=reveal-next]").trigger("click");
    await wrapper.find("[data-testid=ack-stored]").setValue(true);
    await wrapper.find("[data-testid=ack-loss]").setValue(true);
    await wrapper.find("[data-testid=continue-to-communities]").trigger("click");
    expect(wrapper.emitted("confirmed")?.[0]).toEqual(["ab".repeat(32)]);
    expect(JSON.stringify(wrapper.emitted())).not.toContain("nsec1");
    // going back to the reveal after confirming shows nothing secret any more
    expect(wrapper.html()).not.toContain("nsec1testonlyfixture");
  });

  it("'Download backup' saves the ncryptsec via Rust (never the nsec)", async () => {
    const saved = vi.fn(() => "C:\\Users\\x\\Downloads\\swf-buzz-identity-abababab.ncryptsec");
    tauri({ create_identity_with_backup: () => REVEAL, save_ncryptsec_backup: saved });
    const { default: CreateIdentityFlow } = await import("@/features/onboarding/ui/CreateIdentityFlow.vue");
    const wrapper = mount(CreateIdentityFlow);
    await wrapper.find("[data-testid=create-backup-password]").setValue("correct horse battery");
    await wrapper.find("[data-testid=create-backup-confirm]").setValue("correct horse battery");
    await wrapper.find("[data-testid=create-identity-submit]").trigger("click");
    await settle();
    await wrapper.find("[data-testid=download-backup]").trigger("click");
    await settle();
    expect((saved.mock.calls[0] as unknown[])[0]).toEqual({ ncryptsec: "ncryptsec1x" });
    expect(wrapper.find("[data-testid=backup-path]").text()).toContain("swf-buzz-identity-abababab.ncryptsec");
  });
});

describe("BackupPanel — NIP-49 backup", () => {
  it("validates the passphrase (length, match) before anything is encrypted", async () => {
    const wrapper = mount(BackupPanel);
    await wrapper.find("[data-testid=backup-passphrase]").setValue("short");
    expect(wrapper.find("[data-testid=backup-problem]").text()).toContain("at least 12");
    expect(wrapper.find("[data-testid=backup-create]").attributes("disabled")).toBeDefined();

    await wrapper.find("[data-testid=backup-passphrase]").setValue("a long enough passphrase");
    await wrapper.find("[data-testid=backup-confirmation]").setValue("something different here");
    expect(wrapper.find("[data-testid=backup-problem]").text()).toContain("don't match");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("creates the encrypted backup in Rust, saves it to a file, shows the path, and clears the passphrase", async () => {
    tauri({
      create_ncryptsec_backup: () => "ncryptsec1blob",
      save_ncryptsec_backup: () => "C:\\Users\\me\\Downloads\\swf-buzz-identity-abababab.ncryptsec",
    });
    const wrapper = mount(BackupPanel);
    await wrapper.find("[data-testid=backup-passphrase]").setValue("a long enough passphrase");
    await wrapper.find("[data-testid=backup-confirmation]").setValue("a long enough passphrase");

    await wrapper.find("[data-testid=backup-create]").trigger("click");
    await settle();

    expect(invokeMock).toHaveBeenNthCalledWith(1, "create_ncryptsec_backup", { password: "a long enough passphrase" });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "save_ncryptsec_backup", { ncryptsec: "ncryptsec1blob" });
    expect(wrapper.find("[data-testid=backup-path]").text()).toContain("swf-buzz-identity-abababab.ncryptsec");
    expect(wrapper.find("[data-testid=backup-passphrase]").exists()).toBe(false); // form replaced; passphrase dropped
    expect(wrapper.find("[data-testid=backup-done]").text()).toBe("Done");
  });

  it("a failure (e.g. Rust rejects the passphrase) is shown and nothing is saved", async () => {
    tauri({
      create_ncryptsec_backup: () => {
        throw "the backup passphrase must be at least 12 characters";
      },
    });
    const wrapper = mount(BackupPanel);
    await wrapper.find("[data-testid=backup-passphrase]").setValue("a long enough passphrase");
    await wrapper.find("[data-testid=backup-confirmation]").setValue("a long enough passphrase");
    await wrapper.find("[data-testid=backup-create]").trigger("click");
    await settle();
    expect(wrapper.find("[data-testid=backup-error]").text()).toContain("at least 12");
    expect(commandsCalled()).toEqual(["create_ncryptsec_backup"]);
  });

  it("can be skipped, and says so", async () => {
    const wrapper = mount(BackupPanel);
    expect(wrapper.find("[data-testid=backup-done]").text()).toBe("Skip for now");
    await wrapper.find("[data-testid=backup-done]").trigger("click");
    expect(wrapper.emitted("done")).toHaveLength(1);
  });

  it("warns that the identity is unrecoverable without the passphrase", () => {
    expect(mount(BackupPanel).text()).toContain("cannot be recovered");
  });
});

describe("JoinInvitePanel — the whole claim path with only IPC and fetch mocked", () => {
  const RELAY = "ws://localhost:3000";
  const CODE = "v2." + "B".repeat(43);

  function setup(fetchImpl: () => Response | Promise<Response>) {
    const signed: Array<{ kind: number; tags: string[][] }> = [];
    tauri({
      get_identity: () => INFO,
      sign_event: (args) => {
        const a = args as { kind: number; content: string; tags: string[][] };
        signed.push(a);
        return { ...a, id: "e".repeat(64), pubkey: PK, sig: "s".repeat(128), created_at: 1, created_at_: 0 };
      },
    });
    const fetchMock = vi.fn(async () => fetchImpl());
    vi.stubGlobal("fetch", fetchMock);
    return { signed, fetchMock };
  }

  it("claims with a NIP-98 event signed by Rust (payload-bound), reports the join, and remembers the community", async () => {
    const { signed, fetchMock } = setup(() =>
      json({ status: "joined", community_id: "c-1", host: "localhost:3000", role: "member" }),
    );
    const wrapper = mount(JoinInvitePanel, { props: { defaultRelay: RELAY } });
    await wrapper.find("[data-testid=invite-input]").setValue(`swfbuzz://join?relay=${RELAY}&code=${CODE}`);
    expect(wrapper.find("[data-testid=invite-target]").text()).toContain("localhost:3000");

    await wrapper.find("form").trigger("submit");
    await vi.waitFor(() => expect(wrapper.emitted("joined")).toBeTruthy());

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:3000/api/invites/claim");
    const event = decodeNip98((init.headers as Record<string, string>).Authorization);
    expect(event.kind).toBe(27235);
    expect(tagValue(event, "u")).toBe(url);
    expect(tagValue(event, "payload")).toBe(await sha256Hex(init.body as string));
    expect(signed.map((s) => s.kind)).toEqual([27235]); // signed by the Rust command, once
    expect(commandsCalled()).toEqual(["get_identity", "sign_event"]);

    const joined = wrapper.emitted("joined")?.[0][0] as { status: string; role: string; relay: string };
    expect(joined).toMatchObject({ status: "joined", role: "member", relay: RELAY });
    expect(communities.value.map((c) => c.relayUrl)).toEqual([RELAY]);
  });

  it("already_member is reported as a success (idempotent claim)", async () => {
    setup(() => json({ status: "already_member", community_id: "c-1", host: "localhost:3000", role: "member" }));
    const wrapper = mount(JoinInvitePanel, { props: { defaultRelay: RELAY } });
    await wrapper.find("[data-testid=invite-input]").setValue(CODE);
    await wrapper.find("form").trigger("submit");
    await vi.waitFor(() => expect(wrapper.emitted("joined")).toBeTruthy());
    expect(wrapper.emitted("joined")?.[0][0]).toMatchObject({ status: "already_member" });
    expect(wrapper.find("[data-testid=invite-error]").exists()).toBe(false);
  });

  it.each([
    ["invite_invalid", "isn't valid"],
    ["invite_expired", "expired"],
    ["invite_exhausted", "use limit"],
  ])("relay says %s → a clear message, no join", async (relayError, phrase) => {
    setup(() => json({ error: relayError }, 403));
    const wrapper = mount(JoinInvitePanel, { props: { defaultRelay: RELAY } });
    await wrapper.find("[data-testid=invite-input]").setValue(CODE);
    await wrapper.find("form").trigger("submit");
    await settle();

    expect(wrapper.find("[data-testid=invite-error]").text()).toContain(phrase);
    expect(wrapper.emitted("joined")).toBeUndefined();
    expect(communities.value).toHaveLength(0);
  });

  it("rejects text that is not an invite instead of guessing", async () => {
    setup(() => json({}));
    const wrapper = mount(JoinInvitePanel, { props: { defaultRelay: RELAY } });
    await wrapper.find("[data-testid=invite-input]").setValue("hello there");
    expect(wrapper.find("[data-testid=invite-unrecognised]").exists()).toBe(true);
    expect(wrapper.find("[data-testid=invite-join]").attributes("disabled")).toBeDefined();
  });

  it("SECURITY: with no identity on the device, nothing can be claimed and nothing is sent", async () => {
    tauri({ get_identity: () => NONE });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const wrapper = mount(JoinInvitePanel, { props: { defaultRelay: RELAY } });
    await wrapper.find("[data-testid=invite-input]").setValue(CODE);
    await wrapper.find("form").trigger("submit");
    await settle();

    expect(wrapper.find("[data-testid=invite-error]").text()).toContain("identity");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(commandsCalled()).not.toContain("sign_event");
  });

  it("SECURITY: entering someone's public key (or a community address) is not an invite and authenticates nothing", async () => {
    setup(() => json({ error: "invite_invalid" }, 403));
    const wrapper = mount(JoinInvitePanel, { props: { defaultRelay: RELAY } });
    for (const text of [PK, "npub1" + "q".repeat(58), "ws://localhost:3000", "localhost:3000"]) {
      await wrapper.find("[data-testid=invite-input]").setValue(text);
      // a 64-hex string happens to satisfy the invite-code charset, so it may be *parsed* —
      // what matters is that it can only ever be sent as an invite code, never as an identity.
      await wrapper.find("form").trigger("submit");
      await settle();
    }
    const claimBodies = vi.mocked(fetch).mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string));
    for (const body of claimBodies) expect(Object.keys(body)).toEqual(["code"]);
    expect(wrapper.emitted("joined")).toBeUndefined();
  });
});
