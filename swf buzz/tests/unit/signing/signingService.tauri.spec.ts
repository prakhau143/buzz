import { beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  TauriSigningService,
  createLocalIdentity,
  getLocalIdentity,
} from "@/features/signing/signingService.tauri";
import { AppError } from "@/services/errors";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

const PUBKEY = "ab".repeat(32);
const INFO = { pubkey: PUBKEY, storage: "system-keyring", recovery: "none" };

describe("TauriSigningService", () => {
  beforeEach(() => invokeMock.mockReset());

  it("takes the public key from Rust's get_identity", async () => {
    invokeMock.mockResolvedValueOnce(INFO);
    expect(await new TauriSigningService().getPublicKey()).toBe(PUBKEY);
    expect(invokeMock).toHaveBeenCalledWith("get_identity");
  });

  it("rejects getPublicKey with auth_required when no identity exists", async () => {
    invokeMock.mockResolvedValueOnce({ pubkey: null, storage: "none", recovery: "none" });
    await expect(new TauriSigningService().getPublicKey()).rejects.toMatchObject({
      code: "auth_required",
    });
  });

  it("signs through the sign_event command and returns Rust's event unchanged", async () => {
    const signed = { id: "i", pubkey: PUBKEY, sig: "s", kind: 9, content: "hi", tags: [["h", "c"]], created_at: 42 };
    invokeMock.mockResolvedValueOnce(signed);

    const result = await new TauriSigningService().signEvent({
      kind: 9,
      content: "hi",
      tags: [["h", "c"]],
      created_at: 42,
    });

    expect(result).toEqual(signed);
    expect(invokeMock).toHaveBeenCalledWith("sign_event", {
      kind: 9,
      content: "hi",
      createdAt: 42,
      tags: [["h", "c"]],
    });
  });

  it("sends createdAt: null when the caller gives no timestamp (Rust picks 'now')", async () => {
    invokeMock.mockResolvedValueOnce({});
    await new TauriSigningService().signEvent({ kind: 1, content: "", tags: [] });
    expect(invokeMock).toHaveBeenCalledWith("sign_event", { kind: 1, content: "", createdAt: null, tags: [] });
  });

  it("maps a Rust signing failure to a safe signing_failed AppError (no raw detail in the message)", async () => {
    invokeMock.mockRejectedValueOnce("sign failed: something internal");
    const error = await new TauriSigningService()
      .signEvent({ kind: 1, content: "", tags: [] })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("signing_failed");
    expect((error as AppError).message).not.toContain("internal");
    expect((error as AppError).cause).toBe("sign failed: something internal");
  });

  // Superseded: NIP-44 was a phase-1 deferral that threw. Phase 4C implements
  // it in Rust (NIP-RS read state seals kind:30078 to the user's own key), so
  // the assertion below is the inverse of the one that used to live here —
  // the capability arrived deliberately, it did not regress.
  it("delegates NIP-44 to Rust so the secret key never reaches the webview", async () => {
    const service = new TauriSigningService();
    invokeMock.mockResolvedValueOnce("ciphertext");
    await expect(service.nip44Encrypt(PUBKEY, "plain")).resolves.toBe("ciphertext");
    expect(invokeMock).toHaveBeenCalledWith("nip44_encrypt", {
      recipientPubkey: PUBKEY,
      plaintext: "plain",
    });

    invokeMock.mockResolvedValueOnce("plain");
    await expect(service.nip44Decrypt(PUBKEY, "ciphertext")).resolves.toBe("plain");
    expect(invokeMock).toHaveBeenCalledWith("nip44_decrypt", {
      senderPubkey: PUBKEY,
      ciphertext: "ciphertext",
    });
  });

  it("maps a NIP-44 failure to a safe AppError without echoing the payload", async () => {
    const service = new TauriSigningService();
    // A decrypt failure is routine (a foreign kind:30078 shares the kind
    // number), so the surfaced message must not carry attacker-supplied bytes.
    invokeMock.mockRejectedValueOnce("decrypt failed");
    const error = await service.nip44Decrypt(PUBKEY, "not-ours").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("signing_failed");
    expect((error as AppError).message).not.toContain("not-ours");
  });

  it("reports mode 'production' so the existing SigningService contract is unchanged", () => {
    expect(new TauriSigningService().mode).toBe("production");
  });
});

describe("local identity helpers", () => {
  beforeEach(() => invokeMock.mockReset());

  it("getLocalIdentity / createLocalIdentity call exactly get_identity / create_identity", async () => {
    invokeMock.mockResolvedValue(INFO);
    await getLocalIdentity();
    await createLocalIdentity();
    expect(invokeMock.mock.calls.map((c) => c[0])).toEqual(["get_identity", "create_identity"]);
  });

  it("passes Rust's user-safe refusal text through as the AppError message", async () => {
    invokeMock.mockRejectedValueOnce("secure storage is locked — unlock it and restart the app");
    await expect(createLocalIdentity()).rejects.toMatchObject({
      code: "auth_failed",
      message: "secure storage is locked — unlock it and restart the app",
    });
  });

  it("falls back to a generic message for a non-string failure", async () => {
    invokeMock.mockRejectedValueOnce(new Error("kaboom"));
    await expect(getLocalIdentity()).rejects.toMatchObject({ message: "Couldn't read your identity." });
  });

  it("only ever uses the three identity commands, and the info shape has no secret field", async () => {
    invokeMock.mockResolvedValue(INFO);
    const service = new TauriSigningService();
    await service.getPublicKey();
    await service.signEvent({ kind: 1, content: "", tags: [] });
    await createLocalIdentity();
    const commands = new Set(invokeMock.mock.calls.map((c) => c[0]));
    expect([...commands].every((c) => ["get_identity", "create_identity", "sign_event"].includes(c as string))).toBe(true);
    expect(Object.keys(INFO).sort()).toEqual(["pubkey", "recovery", "storage"]);
  });
});

// Regression guard for "the private key never enters the webview": no frontend
// source may reference the keyring entry name or a secret-exporting command.
describe("frontend never reaches for the private key", () => {
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : [path];
    });
  }

  it("has no reference to the identity keyring entry or a secret-export command", () => {
    const files = walk(join(process.cwd(), "src")).filter((f) => /\.(ts|vue)$/.test(f));
    expect(files.length).toBeGreaterThan(50);
    const offenders = files.filter((file) => {
      const text = readFileSync(file, "utf8");
      return /identity_nsec|get_nsec|export_identity|SWF_BUZZ_PRIVATE_KEY/.test(text);
    });
    expect(offenders).toEqual([]);
  });
});
