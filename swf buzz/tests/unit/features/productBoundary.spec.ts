/**
 * SWF Buzz product boundary — source guards.
 *
 * SWF is a human communication client. It does NOT create, provision or ship an
 * agent, and it does NOT implement huddles (creation, audio, rooms, join). These
 * guards scan the shipped source (`src/`) so a regression is a failing test, not
 * a code-review catch. They check SWF-owned behaviour only: ordinary messages
 * from an external participant (who may be an agent) remain ordinary protocol
 * messages and are not affected.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "../../../src");

function sourceFiles(dir = SRC): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|vue)$/.test(name) ? [path] : [];
  });
}

/** Source with comments stripped: prose explaining the boundary is allowed to name it. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

const files = sourceFiles();
const hits = (pattern: RegExp) => files.filter((f) => pattern.test(code(f))).map((f) => f.slice(SRC.length));

describe("no huddles", () => {
  it("no huddle event kinds 48100–48106 are defined or used", () => {
    expect(hits(/\b4810[0-6]\b/)).toEqual([]);
  });

  it("no huddle creation / start / join commands", () => {
    expect(hits(/start_huddle|join_huddle|end_huddle|leave_huddle|startHuddle|joinHuddle/)).toEqual([]);
  });

  it("no huddle button, label or teaser anywhere in the UI", () => {
    expect(hits(/huddle/i)).toEqual([]);
  });

  it("no audio / WebRTC capture", () => {
    expect(hits(/getUserMedia|RTCPeerConnection|AudioContext/)).toEqual([]);
  });
});

describe("no built-in or managed agents", () => {
  it("ships no built-in agent identity (e.g. OLD BUZZ's Poseidon)", () => {
    expect(hits(/poseidon|SWF Agent/i)).toEqual([]);
  });

  it("offers no agent creation or managed-agent UI, and search has no 'Create a new agent'", () => {
    expect(hits(/create[- _]?(a[- _]?new[- _]?)?agent|open-create-agent|AgentActivityBar|useAgentObserverFeed/i)).toEqual([]);
  });

  it("has no agent / projects / workflows / GitHub navigation or routes", () => {
    const router = code(join(SRC, "app/router/index.ts"));
    expect(router).not.toMatch(/path:\s*["'`]\/(agents?|projects?|workflows?|github|terminal|canvas)\b/i);
  });
});
