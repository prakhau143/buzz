import { beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import IdentityModal from "@/features/identity/ui/IdentityModal.vue";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  isTauri: () => true,
}));

const SRC = join(process.cwd(), "src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}
const files = () => walk(SRC).filter((f) => /\.(ts|vue)$/.test(f));
const rel = (file: string) => relative(SRC, file).replace(/\\/g, "/");

/** Source without comments, so prose like "never holds a private key" can't trip a check. */
function code(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/<!--[\s\S]*?-->/g, "");
}

// Files that still hold a key in JS: the dev-only shared-key signer and the legacy
// NIP-46 client (both slated for removal, docs/…MIGRATION_PLAN §26).
const LEGACY_KEY_HOLDERS = new Set([
  "features/signing/signingService.dev.ts",
  "features/signing/signingService.nip46.ts",
]);

describe("SECURITY — the private key never lives in the frontend", () => {
  it("no non-legacy file can generate, derive or sign with a secret key in JS", () => {
    const forbidden = /\b(generateSecretKey|finalizeEvent|nsecEncode|getConversationKey|nip49|privateKeyToBytes)\b/;
    const offenders = files()
      .filter((f) => !LEGACY_KEY_HOLDERS.has(rel(f)))
      .filter((f) => forbidden.test(code(f)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("the identity/onboarding code never touches browser storage (a secret could persist there)", () => {
    const storage = /\b(localStorage|sessionStorage|indexedDB|document\.cookie)\b/;
    const identityFiles = files().filter((f) =>
      /^(features\/identity\/|features\/onboarding\/ui\/|features\/signing\/signingService\.tauri\.ts)/.test(rel(f)),
    );
    expect(identityFiles.length).toBeGreaterThan(4);
    expect(identityFiles.filter((f) => storage.test(code(f))).map(rel)).toEqual([]);
  });

  it("Pinia stores have no field for a secret", () => {
    const secretField = /\b(nsec|secretKey|secret_key|privateKey|private_key|ncryptsec|passphrase)\b/i;
    const stores = files().filter((f) => rel(f).startsWith("stores/"));
    expect(stores.length).toBeGreaterThan(3);
    expect(stores.filter((f) => secretField.test(code(f))).map(rel)).toEqual([]);
  });

  it("nothing logs identity secrets: no console/logError call mentions a key or backup variable", () => {
    const risky = /(console\.\w+|logError)\([^)]*\b(secret|nsec|passphrase|password|ncryptsec)\b/i;
    const offenders = files()
      .filter((f) => /^(features\/identity|features\/onboarding|features\/signing\/signingService\.tauri)/.test(rel(f)))
      .filter((f) => risky.test(code(f)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("the only frontend calls into Rust that carry user secrets are the import and backup commands", () => {
    // `import_identity` (a typed nsec/hex/backup + password) and `create_ncryptsec_backup`
    // (a chosen passphrase) are the only invoke() sites that pass secret-shaped arguments.
    const carriers = files()
      .filter((f) => /invoke(<[^>]*>)?\(\s*"[a-z_]+"\s*,\s*\{[^}]*\b(password|passphrase|input|nsec)\b/.test(code(f)))
      .map(rel);
    expect(carriers).toEqual(["features/identity/identityApi.ts"]);
  });

  it("no frontend file references the keyring entry, a secret-export command, or the debug key override", () => {
    const pattern = /identity_nsec|get_nsec|export_identity|SWF_BUZZ_PRIVATE_KEY/;
    expect(files().filter((f) => pattern.test(readFileSync(f, "utf8"))).map(rel)).toEqual([]);
  });
});

describe("SECURITY — a public key is an identifier, never a credential", () => {
  it("no sign-in action in useAuth accepts a public key", () => {
    const source = code(join(SRC, "features/auth/useAuth.ts"));
    // every function that signs a user in or switches identity/community, and its parameters
    const actions = [...source.matchAll(/(?:async\s+)?function\s+(loginWithLocalIdentity|importAndLogin|switchCommunity|ensureLocalSigner|attemptSilentResume)\s*\(([^)]*)\)/g)];
    expect(actions.length).toBe(5);
    for (const [, name, params] of actions) {
      expect(params, `${name} must not take a public key`).not.toMatch(/pubkey|npub|publicKey|owner/i);
    }
  });

  it("the session identity comes from Rust's get_identity — not from anything a user or a link can supply", () => {
    const source = code(join(SRC, "features/auth/useAuth.ts"));
    const pubkeyOrigins = [...source.matchAll(/pubkey:\s*([^,}\n]+)/g)].map((m) => m[1].trim());
    // Every place a *local* session's pubkey is set, it is `info.pubkey` (from get_identity/create)
    // or the value just read from it — never a parameter of the sign-in functions.
    for (const origin of pubkeyOrigins.filter((o) => /info|pubkey\b/.test(o))) {
      expect(origin).toMatch(/^(info\.pubkey|pubkey|result\.pubkey( as string)?|info\.pubkey,?)$/);
    }
    expect(source).toContain("getLocalIdentity()");
  });

  it("the login screen has no field that takes a public key, email or password to sign in", () => {
    const login = readFileSync(join(SRC, "views/LoginView.vue"), "utf8");
    expect(login).not.toMatch(/type="(email|text)"/);
    expect(login).not.toMatch(/v-model="[^"]*(pubkey|npub|email|username)/i);
  });

  it("the community owner is *named* by public key but can only enter by signing with the matching private key", () => {
    const operator = code(join(SRC, "features/communities/OperatorService.ts"));
    // the owner key is only ever a request-body value…
    expect(operator).toContain("initial_owner_pubkey: owner");
    // …and requests are signed by the active signer (the operator's own key), never by that owner key
    expect(operator).toContain("buildNip98Auth(url, method, body)");
    expect(operator).not.toMatch(/signEvent|Keys\.parse|generateSecretKey/);
  });
});

describe("SECURITY — Operator authority is the relay's decision, and Operator ≠ Owner", () => {
  const operatorStateWrites = /(isOperator(\.value)?\s*=[^=]|isOperator\s*:\s*)/;

  // The relay's operator answer reaches the app through exactly two entry
  // points of OperatorService: `isOperator(` (boolean) and `probeOperator(`
  // (the same signed request, with the HTTP status and the signer's pubkey as
  // evidence — Part A of the identity hardening pass). Nothing else may decide.
  const relayOperatorAnswer = /operatorService\.(isOperator|probeOperator)\(/;

  it("every file that records operator status obtains it from operatorService.isOperator()/probeOperator() — no other source", () => {
    const writers = files().filter((f) => operatorStateWrites.test(code(f)));
    expect(writers.length).toBeGreaterThan(2);
    for (const file of writers) {
      const source = code(file);
      // the store definition itself only declares the cache field; every other writer must ask the relay
      if (rel(file) === "stores/access.ts") continue;
      expect(source, `${rel(file)} sets operator status`).toMatch(relayOperatorAnswer);
    }
  });

  it("the PLATFORM role (session.platformRole) is likewise written only from the relay's operator answer", () => {
    // P0 identity lifecycle: `setPlatformRole(` is the one writer of the
    // platform plane. Every caller must sit next to an operatorService probe
    // — never a role label, a hostname, a previous session, or a pubkey list.
    const writers = files().filter((f) => /setPlatformRole\(/.test(code(f)));
    expect(writers.map(rel).sort()).toEqual([
      "features/auth/identitySession.ts",
      "features/auth/useAuth.ts",
      "layouts/AppSidebar.vue",
      "stores/session.ts",
    ]);
    for (const file of writers) {
      if (rel(file) === "stores/session.ts") continue; // the store only declares the action
      expect(code(file), `${rel(file)} writes platformRole`).toMatch(relayOperatorAnswer);
    }
  });

  it("the operator probe URL is built in exactly one place, and the sign-in path refuses a probe signed by another identity", () => {
    const probeUrl = /\/operator\/communities\/availability/;
    expect(files().filter((f) => probeUrl.test(code(f))).map(rel)).toEqual(["features/communities/OperatorService.ts"]);
    // resolveAccess compares the SIGNED event's pubkey with the identity being
    // signed in and returns a `mismatch` decision instead of routing on it.
    const useAuth = code(join(SRC, "features", "auth", "useAuth.ts"));
    expect(useAuth).toContain("probe.signerPubkey !== pubkey");
    expect(useAuth).toContain('kind: "mismatch"');
    // The diagnostics store carries public information only.
    const diag = code(join(SRC, "stores", "diagnostics.ts"));
    expect(diag).not.toMatch(/nsec|secretKey|privateKey|ncryptsec/i);
  });

  it("platform role and community role are separate fields, and sign-out clears both", () => {
    const session = code(join(SRC, "stores", "session.ts"));
    expect(session).toMatch(/platformRole:\s*PlatformRole\s*\|\s*null/);
    expect(session).toMatch(/communityRole:\s*RelayMemberRole\s*\|\s*null/);
    // clearSession resets both planes
    const clear = session.slice(session.indexOf("clearSession()"));
    expect(clear).toContain("this.communityRole = null");
    expect(clear).toContain("this.platformRole = null");
    // nowhere derives one plane from the other
    const derive = /(platformRole\s*=[^=][^\n]*communityRole|communityRole\s*=[^=][^\n]*platformRole)/;
    expect(files().filter((f) => derive.test(code(f))).map(rel)).toEqual([]);
  });

  it("operator status is never read from or written to browser storage", () => {
    const storage = /\b(localStorage|sessionStorage|indexedDB|document\.cookie)\b/;
    const offenders = files()
      .filter((f) => storage.test(code(f)) && /isOperator|operatorService/.test(code(f)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("no frontend-only operator flag: nothing derives 'operator' from a role label, a hostname or a pubkey comparison", () => {
    const forbidden = /(role\s*===?\s*["']operator["']|host(name)?\s*===?[^\n]*operator|pubkey\s*===?[^\n]*operator)/i;
    expect(files().filter((f) => forbidden.test(code(f))).map(rel)).toEqual([]);
  });

  it("community provisioning is ALWAYS create_only: initial_owner_pubkey appears only in OperatorService, next to create_only: true", () => {
    const withOwnerField = files().filter((f) => code(f).includes("initial_owner_pubkey"));
    expect(withOwnerField.map(rel)).toEqual(["features/communities/OperatorService.ts"]);
    const source = code(withOwnerField[0]);
    expect(source).toMatch(/initial_owner_pubkey:\s*owner,\s*create_only:\s*true/);
    expect(source).not.toMatch(/create_only:\s*false/);
    expect(source.match(/\/operator\/communities`,\s*body/g)?.length ?? 0).toBe(1); // one provisioning call site
  });

  it("the legacy non-create-only provisioning mode has no call site in the app", () => {
    // any POST to /operator/communities must be the create_only one above; archive/transfer/etc. are not used at all
    const usesOther = files().filter((f) => /\/operator\/communities\/(archive|unarchive|transfer)/.test(code(f)));
    expect(usesOther.map(rel)).toEqual([]);
  });

  it("'Super Admin' is not a term anywhere in the source or the tests' UI expectations", () => {
    expect(files().filter((f) => /super[ _-]?admin/i.test(readFileSync(f, "utf8"))).map(rel)).toEqual([]);
  });
});

describe("SECURITY — public keys may be shown; only public data is displayed", () => {
  const PK = "ab".repeat(32);
  const NPUB = "npub1" + "q".repeat(58);

  beforeEach(() => {
    setActivePinia(createPinia());
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "get_identity") return { pubkey: PK, npub: NPUB, storage: "system-keyring", recovery: "none" };
      throw new Error(`unexpected Tauri command: ${command}`);
    });
  });

  it("'My identity' shows the npub and hex public key, and nothing that looks like a private key", async () => {
    const wrapper = mount(IdentityModal);
    await flushPromises();
    expect(wrapper.find("[data-testid=my-npub]").text()).toBe(NPUB);
    expect(wrapper.find("[data-testid=my-pubkey]").text()).toBe(PK);
    expect(wrapper.text()).not.toMatch(/nsec1|ncryptsec1/);
    expect(wrapper.text()).toContain("private key never leaves this device");
    expect(invokeMock.mock.calls.map((c) => c[0])).toEqual(["get_identity"]); // no secret-returning call
  });

  it("the backup button reveals the backup form, not a key", async () => {
    const wrapper = mount(IdentityModal);
    await flushPromises();
    await wrapper.find("[data-testid=open-backup]").trigger("click");
    expect(wrapper.find("[data-testid=backup-passphrase]").exists()).toBe(true);
    expect(wrapper.text()).not.toMatch(/nsec1[0-9a-z]{20,}/);
  });
});
