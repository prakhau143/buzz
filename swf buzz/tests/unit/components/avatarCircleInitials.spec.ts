/** Avatar initials ignore a name's parenthetical qualifier (e.g. an agent's role). */
import { beforeEach, describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import AvatarCircle from "@/components/AvatarCircle.vue";

beforeEach(() => setActivePinia(createPinia()));

const initials = (name: string) => mount(AvatarCircle, { props: { name } }).find(".avatar-circle span").text();

describe("AvatarCircle initials", () => {
  it("skips a parenthetical instead of using '(' as an initial", () => {
    expect(initials("Scout (Support Agent)")).toBe("S");
    expect(initials("Sonia Malik (EU)")).toBe("SM");
  });

  it("is unchanged for ordinary names", () => {
    expect(initials("Sonia Malik")).toBe("SM");
    expect(initials("devankit")).toBe("D");
    expect(initials("   ")).toBe("?");
  });
});
