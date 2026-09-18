import type { AuthResult, AuthService } from "./types";

/**
 * DEVELOPMENT-ONLY auth. Skips Okta entirely and pairs with the in-memory
 * DevSigningService so the rest of the app is exercisable locally. Must
 * never be presented as, or mistaken for, a production sign-in — see
 * docs/SECURITY.md.
 */
export class DevAuthService implements AuthService {
  readonly mode = "development" as const;

  constructor(private readonly getDevPubkey: () => Promise<string>) {}

  async login(): Promise<AuthResult> {
    const pubkey = await this.getDevPubkey();
    return {
      authMode: "development",
      employeeEmail: "dev@local.test",
      applicationUserId: null, // no Okta identity in Development Mode
      pubkey,
    };
  }

  async logout(): Promise<void> {
    // Nothing to tear down for the in-memory dev signer.
  }
}
