/**
 * The development authentication path is gone and must not return.
 *
 * It signed in with a throwaway in-memory key. Such a key is in no community's
 * `relay_members`, so it resolved to no role at all — now that
 * owner/admin/member actually work, that session was misleading rather than
 * convenient. The real Nostr identity + NIP-42 path is the only human sign-in.
 *
 * Source-level invariants, following the convention in
 * `tests/unit/security/identitySecurity.spec.ts`: what is pinned here is
 * "this capability must not come back", which a source assertion states more
 * directly than a mount.
 *
 * NOTE what is deliberately NOT asserted gone: `DevSigningService`
 * (`features/signing/signingService.dev.ts`). Despite the name it is shared
 * infrastructure — `useAuth` derives the Okta path's deterministic keypair from
 * it via `forLocalIdentity()`, and every real-relay E2E constructs one to sign
 * as a test identity. Removing it would break NIP-42 verification, not dev auth.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const SRC = join(process.cwd(), "src");
const read = (...p: string[]) => readFileSync(join(SRC, ...p), "utf8");

/**
 * Comments are stripped before asserting, so the explanatory notes left where
 * the feature used to live ("the Continue in Development Mode shortcut was
 * removed because…") do not themselves trip an assertion. Only real code counts.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("development authentication is removed", () => {
  it("useAuth returns no development-mode entry point", () => {
    // Asserted on the return statement rather than by calling `useAuth()`,
    // which requires an active Pinia and a router.
    expect(code(read("features", "auth", "useAuth.ts"))).not.toContain("loginWithDevelopmentMode");
  });

  it("the DevAuthService module no longer exists", () => {
    expect(existsSync(join(SRC, "features", "auth", "authService.dev.ts"))).toBe(false);
  });

  it("nothing in src references the development auth service", () => {
    const useAuthSrc = code(read("features", "auth", "useAuth.ts"));
    expect(useAuthSrc).not.toContain("DevAuthService");
    expect(useAuthSrc).not.toContain("devAuthService");
  });

  it('AuthMode no longer admits "development"', () => {
    const session = read("stores", "session.ts");
    expect(session).toContain('export type AuthMode = "local" | "production";');
  });

  it("the login screen has no development sign-in control", () => {
    // The rendered-output assertion lives in loginView.spec.ts, which mounts
    // the view; this pins the binding and markup so it cannot be re-added.
    const login = code(read("views", "LoginView.vue"));
    expect(login).not.toContain("loginWithDevelopmentMode");
    expect(login).not.toContain("dev-section");
    expect(login).not.toContain("Development only");
  });

  it("logout no longer routes a local identity through a development service", () => {
    const useAuthSrc = code(read("features", "auth", "useAuth.ts"));
    // The old line was:
    //   const service = authMode === "production" ? oktaAuthService : devAuthService;
    // which sent every LOCAL sign-out through the dev auth service's no-op.
    expect(useAuthSrc).not.toMatch(/\?\s*oktaAuthService\s*:\s*devAuthService/);
  });
});

describe("real authentication is untouched", () => {
  it("keeps the local Nostr identity entry point", () => {
    const useAuthSrc = code(read("features", "auth", "useAuth.ts"));
    expect(useAuthSrc).toContain("continueWithLocalIdentity");
    expect(useAuthSrc).toContain("async function logout");
  });

  it("keeps the Tauri signing service and local identity management", () => {
    const useAuthSrc = read("features", "auth", "useAuth.ts");
    expect(useAuthSrc).toContain("TauriSigningService");
    expect(useAuthSrc).toContain("getLocalIdentity");
    expect(useAuthSrc).toContain("createLocalIdentity");
  });

  it("keeps DevSigningService, which the Okta path and every real-relay E2E use", () => {
    expect(existsSync(join(SRC, "features", "signing", "signingService.dev.ts"))).toBe(true);
    const useAuthSrc = read("features", "auth", "useAuth.ts");
    expect(useAuthSrc).toContain("DevSigningService.forLocalIdentity");
  });

  it("keeps NIP-42 role resolution: authenticated pubkey → roster → role", () => {
    const identitySession = read("features", "auth", "identitySession.ts");
    expect(identitySession).toContain("authenticatedPubkey");
    expect(identitySession).toContain("fetchMembershipList");
    expect(identitySession).toContain("resolveMyRole");
    expect(identitySession).toContain("setCommunityRole");
  });

  it("keeps the connection deep link as a community pointer, not an auth mechanism", () => {
    const invites = read("features", "communities", "RelayInviteService.ts");
    expect(invites).toContain("buildConnectLink");
    // A connect link must never carry a credential or grant a role.
    expect(invites).not.toMatch(/buildConnectLink[\s\S]{0,400}(nsec|privateKey|role)/);
  });
});
