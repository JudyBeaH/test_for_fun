import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");

function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  return match?.[1] ?? "";
}

describe("P3C touch viewport affordances", () => {
  it("keeps camp drag and click targets at touch-friendly sizes", () => {
    expect(ruleBody("button")).toContain("min-height: 44px");
    expect(ruleBody(".animalSlot, .offer, .miniCard")).toContain("min-height: 92px");
    expect(ruleBody(".emptySlotButton")).toContain("min-height: 78px");
    expect(css).not.toContain("button { min-height: 38px");
  });

  it("defines visible click source and legal target states", () => {
    expect(ruleBody(".clickSource")).toContain("outline:");
    expect(ruleBody(".legalClickTarget")).toContain("box-shadow:");
  });
});
