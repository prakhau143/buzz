import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  IDENTITY_REMOVAL_FAILED_MESSAGE,
  MIN_BACKUP_PASSPHRASE_LEN,
  createBackup,
  deleteIdentity,
  importIdentity,
  saveBackup,
  verifyBackup,
} from "@/features/identity/identityApi";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

const INFO = { pubkey: "ab".repeat(32), npub: "npub1x", storage: "system-keyring", recovery: "none" };

describe("identity API (import / NIP-49 backup) — thin wrappers over Rust", () => {
  beforeEach(() => invokeMock.mockReset());

  it("import forwards the input and password to Rust and returns public info only", async () => {
    invokeMock.mockResolvedValueOnce(INFO);
    const info = await importIdentity("ncryptsec1abc", "hunter2hunter2");
    expect(invokeMock).toHaveBeenCalledWith("import_identity", {
      input: "ncryptsec1abc",
      password: "hunter2hunter2",
      // Raw 64-char hex is refused unless a caller explicitly opts in — the
      // normal import path never does (docs/DEV_RESET_2026_09_22.md).
      allowRawHex: false,
    });
    expect(info).toEqual(INFO);
    expect(Object.keys(info).sort()).toEqual(["npub", "pubkey", "recovery", "storage"]);
  });

  it("delete asks Rust to remove the identity and returns the (now empty) public info — no frontend-side deletion", async () => {
    const NONE = { pubkey: null, npub: null, storage: "none", recovery: "none" };
    invokeMock.mockResolvedValueOnce(NONE);
    const info = await deleteIdentity();
    expect(invokeMock).toHaveBeenCalledWith("delete_identity");
    expect(invokeMock).toHaveBeenCalledTimes(1); // one Rust call; never secure_storage_delete or the like
    expect(info).toEqual(NONE);
  });

  it("delete surfaces Rust's reason, or the standard message when there is none", async () => {
    invokeMock.mockRejectedValueOnce("couldn't remove an archived copy of an identity: keyring delete denied");
    await expect(deleteIdentity()).rejects.toMatchObject({ code: "auth_failed", message: /keyring delete denied/ });
    invokeMock.mockRejectedValueOnce(new Error("boom"));
    await expect(deleteIdentity()).rejects.toThrow(IDENTITY_REMOVAL_FAILED_MESSAGE);
  });

  it("import sends password: null when there is none (an nsec or hex key)", async () => {
    invokeMock.mockResolvedValue(INFO);
    await importIdentity("nsec1abc");
    await importIdentity("nsec1abc", "");
    expect(invokeMock.mock.calls.map((c) => (c[1] as { password: unknown }).password)).toEqual([null, null]);
  });

  it("surfaces Rust's user-safe refusal text (e.g. wrong password, or an identity already exists)", async () => {
    invokeMock.mockRejectedValueOnce("wrong backup password, or the backup is damaged");
    await expect(importIdentity("ncryptsec1abc", "nope")).rejects.toMatchObject({
      code: "auth_failed",
      message: "wrong backup password, or the backup is damaged",
    });
    invokeMock.mockRejectedValueOnce("an identity already exists on this device — importing would replace it");
    await expect(importIdentity("nsec1abc")).rejects.toThrow(/already exists/);
  });

  it("falls back to a generic message for a non-string failure", async () => {
    invokeMock.mockRejectedValueOnce(new Error("kaboom"));
    await expect(importIdentity("x")).rejects.toMatchObject({ message: "Couldn't import that identity." });
  });

  it("backup: create → save → verify each call exactly the expected Rust command", async () => {
    invokeMock.mockResolvedValueOnce("ncryptsec1blob");
    expect(await createBackup("a long enough passphrase")).toBe("ncryptsec1blob");
    invokeMock.mockResolvedValueOnce("C:\\Users\\me\\Downloads\\swf-buzz-identity-abababab.ncryptsec");
    expect(await saveBackup("ncryptsec1blob")).toContain("Downloads");
    invokeMock.mockResolvedValueOnce({ pubkey: INFO.pubkey, npub: "npub1x", matchesCurrentIdentity: true });
    expect((await verifyBackup("ncryptsec1blob", "a long enough passphrase")).matchesCurrentIdentity).toBe(true);

    expect(invokeMock.mock.calls.map((c) => c[0])).toEqual([
      "create_ncryptsec_backup",
      "save_ncryptsec_backup",
      "verify_ncryptsec_backup",
    ]);
  });

  it("the passphrase minimum matches Rust's (12)", () => {
    expect(MIN_BACKUP_PASSPHRASE_LEN).toBe(12);
  });

  it("never asks Rust for the private key — there is no such command in this API", () => {
    // The whole module's surface: import / create / save / verify. None returns a secret.
    invokeMock.mockResolvedValue(INFO);
    const commands = ["import_identity", "create_ncryptsec_backup", "save_ncryptsec_backup", "verify_ncryptsec_backup"];
    expect(commands.some((c) => /nsec$|get_nsec|export/.test(c))).toBe(false);
  });
});
