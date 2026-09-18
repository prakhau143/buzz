You are working inside the SWF Buzz project.

Do NOT modify production authentication or remove the existing Okta/NIP-46 implementation yet.

Our immediate goal is to make the SWF Buzz client runnable in local development and connect it to the correct existing Buzz backend infrastructure.

We have two repositories available:

../buzz
Existing/current Buzz repository. This is reference-only.

./swf buzz
Our new SWF Buzz client.

First perform a READ-ONLY infrastructure reconnaissance of ../buzz.

Find and document:

1. Buzz Relay

- Where is buzz-relay configured?
- What environment variables configure its URL?
- Find all relay URLs used in development/staging.
- Find Docker Compose, Kubernetes, Helm or deployment configuration.
- Identify WebSocket URL format.
- Identify authentication requirements.
- Identify BUZZ_CORS_ORIGINS requirements.
- Determine whether the desktop client connects directly to relay or through another service.

2. Buzz ACP

- Find all buzz-acp configuration.
- Find ACP endpoints/service URLs.
- Find environment variables.
- Find Docker/Kubernetes/Helm configuration.
- Determine whether ACP is directly reachable by the desktop client or only through the relay/backend.
- Find how existing Buzz Desktop communicates with agents.
- Identify a suitable existing test agent if the repository contains one.

3. NIP-46

- Search the repository for NIP-46, bunker, bunker URL, remote signer, nostrconnect, signing service, pairing.
- Determine whether a real bunker service already exists.
- Find configuration variables or deployment information.
- Do NOT invent a bunker URL if none exists.
- Clearly mark it as an infrastructure blocker if unavailable.

4. Authentication

- Inspect the existing SWF Buzz authentication implementation.
- Keep Okta implementation intact.
- Determine how we can introduce a Development Authentication mode without deleting or commenting out Okta.
- Recommend a clean AuthProvider abstraction:
  DevAuthProvider
  OktaAuthProvider

5. Development signer
   Determine how the current SWF Buzz signing architecture works.
   For local development only, design the safest possible development signer that allows us to test relay functionality without pretending that it is production NIP-46.
   Do not expose or commit real private keys.

6. Environment configuration
   Propose the exact .env.example structure for:

- development auth
- relay URL
- ACP configuration if actually required by the client
- Okta configuration
- NIP-46 configuration

7. IMPORTANT
   Do not make assumptions.
   Do not invent URLs.
   Do not invent credentials.
   Do not copy secrets.
   Do not modify ../buzz.

After reconnaissance, create:

docs/INFRASTRUCTURE_INTEGRATION.md

containing:

A. Current Buzz infrastructure
B. SWF Buzz required infrastructure
C. Relay connection flow
D. ACP/agent flow
E. Authentication flow
F. NIP-46 flow
G. Local development architecture
H. Production architecture
I. Environment variables
J. What is already available
K. What we need from the team
L. Exact commands/configuration required for local development
M. Open blockers

Only after completing the document, give me a concise summary of:

- what URLs/configuration we already found
- what can be tested locally now
- what must be requested from Binod/Devankit/team
- whether direct ACP access is actually required
- whether a NIP-46 bunker already exists

Do not implement anything until this reconnaissance is complete.
