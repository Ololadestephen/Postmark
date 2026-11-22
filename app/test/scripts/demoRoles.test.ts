import { describe, it, expect } from "vitest";
import { ROLES, parseRoles } from "../../scripts/demoRoles.ts";

describe("demo --roles", () => {
  it("defaults to all six roles", () => {
    expect(parseRoles([])).toEqual([...ROLES]);
    expect(parseRoles(["--github", "stub", "--smoke"])).toHaveLength(6);
  });

  it("selects only the named roles, in canonical order", () => {
    expect(parseRoles(["--roles", "verifier1,funder,claimant,verifier0"]))
      .toEqual(["funder", "claimant", "verifier0", "verifier1"]);
    expect(parseRoles(["--smoke", "--roles=claimant, verifier2", "--headless"]))
      .toEqual(["claimant", "verifier2"]);
  });

  it("ignores duplicates", () => {
    expect(parseRoles(["--roles", "funder,funder"])).toEqual(["funder"]);
  });

  it("rejects unknown roles and lists the valid ones", () => {
    expect(() => parseRoles(["--roles", "funder,auditor"]))
      .toThrow("unknown role auditor (valid roles: funder, claimant, verifier0, verifier1, verifier2, disputer)");
    expect(() => parseRoles(["--roles", "x,y"])).toThrow(/unknown roles x, y/);
  });

  it("rejects an empty or missing list", () => {
    expect(() => parseRoles(["--roles"])).toThrow(/needs a comma-separated list/);
    expect(() => parseRoles(["--roles", "--smoke"])).toThrow(/needs a comma-separated list/);
    expect(() => parseRoles(["--roles="])).toThrow(/valid roles: funder/);
  });
});
