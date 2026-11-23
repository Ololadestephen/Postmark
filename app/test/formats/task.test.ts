import { describe, it, expect } from "vitest";
import {
  briefHashOf, canonicalTaskText, functionSelector, parseTaskBlock,
  taskBlockText, taskDiff, taskFromFields, taskIssueMatch, type Task,
} from "../../src/github/task";

const CONTRACT = `0x${"ab".repeat(20)}` as `0x${string}`;
const CODEHASH = `0x${"cd".repeat(32)}` as `0x${string}`;

const wrap = (inner: string) => `\`\`\`postmark-task\n${inner}\n\`\`\``;
const CALL: Task = { type: "onchain-call", contract: CONTRACT, function: "register(bytes)" };
const DEPLOY: Task = { type: "onchain-deploy", codehash: CODEHASH };

describe("parseTaskBlock", () => {
  it("parses a call task with contract and function", () => {
    const p = parseTaskBlock(`do a thing\n${wrap(`type: onchain-call\ncontract: ${CONTRACT}\nfunction: register(bytes)`)}`);
    expect(p).toEqual({ task: CALL });
  });
  it("parses a deploy task with a codehash", () => {
    expect(parseTaskBlock(wrap(`type: onchain-deploy\ncodehash: ${CODEHASH}`))).toEqual({ task: DEPLOY });
  });
  it("recognises the human-judged types", () => {
    expect(parseTaskBlock(wrap("type: testing"))).toEqual({ task: { type: "testing" } });
    expect(parseTaskBlock(wrap("type: url"))).toEqual({ task: { type: "url" } });
  });
  it("returns null with no block", () => {
    expect(parseTaskBlock("just an issue")).toBeNull();
    expect(parseTaskBlock(null)).toBeNull();
    expect(parseTaskBlock("```json\n{}\n```")).toBeNull();
    expect(parseTaskBlock("```postmark-task2\ntype: url\n```")).toBeNull();
  });
  it("ignores comments and blank lines and normalises case of hex", () => {
    const p = parseTaskBlock(wrap(
      `# the brief\ntype: onchain-deploy   # what to do\n\ncodehash: ${CODEHASH.toUpperCase().replace("0X", "0x")}`));
    expect(p).toEqual({ task: DEPLOY });
  });
  it("normalises the contract address to lowercase", () => {
    const p = parseTaskBlock(wrap(`type: onchain-call\ncontract: ${CONTRACT.toUpperCase().replace("0X", "0x")}`));
    expect(p && "task" in p && p.task.contract).toBe(CONTRACT);
  });
  it("handles CRLF bodies", () => {
    const p = parseTaskBlock("text\r\n```postmark-task\r\ntype: url\r\n```\r\n");
    expect(p).toEqual({ task: { type: "url" } });
  });
  it("rejects two blocks", () => {
    expect(parseTaskBlock(`${wrap("type: url")}\n${wrap("type: testing")}`)).toEqual(
      { error: "more than one postmark-task block" });
  });
  it.each([
    ["unknown key", `type: url\nspeed: fast`, /unknown key/],
    ["duplicate key", `type: url\ntype: testing`, /duplicate key/],
    ["bad address", `type: onchain-call\ncontract: 0x1234`, /40-hex/],
    ["missing contract on a call", `type: onchain-call`, /needs a contract/],
    ["bad codehash", `type: onchain-deploy\ncodehash: 0x12`, /32-byte/],
    ["bad signature", `type: onchain-call\ncontract: ${CONTRACT}\nfunction: register (bytes)`, /bad function signature/],
    ["contract on a deploy", `type: onchain-deploy\ncontract: ${CONTRACT}`, /only allowed for onchain-call/],
    ["function on a deploy", `type: onchain-deploy\nfunction: f()`, /only allowed for onchain-call/],
    ["codehash on a call", `type: onchain-call\ncontract: ${CONTRACT}\ncodehash: ${CODEHASH}`, /only allowed for onchain-deploy/],
    ["unknown type", `type: nft`, /unknown type/],
  ])("rejects %s", (_name, inner, re) => {
    expect(parseTaskBlock(wrap(inner))).toEqual({ error: expect.stringMatching(re) });
  });
});

describe("canonical text, brief hash and round-trip", () => {
  it("taskBlockText round-trips through the parser", () => {
    for (const task of [CALL, DEPLOY, { type: "testing" } as Task, { type: "onchain-deploy" } as Task]) {
      expect(parseTaskBlock(taskBlockText(task))).toEqual({ task });
    }
  });
  it("canonical text has the fixed key order", () => {
    expect(canonicalTaskText(CALL)).toBe(`type: onchain-call\ncontract: ${CONTRACT}\nfunction: register(bytes)\n`);
  });
  it("briefHashOf is stable under comments and formatting", () => {
    const decorated = parseTaskBlock(wrap(`# note\n\n  type: onchain-deploy # x\n  codehash: ${CODEHASH}   `));
    expect(decorated && "task" in decorated && briefHashOf(decorated.task)).toBe(briefHashOf(DEPLOY));
  });
  it("briefHashOf changes on any field change", () => {
    const a = briefHashOf(DEPLOY);
    expect(briefHashOf({ type: "onchain-deploy" })).not.toBe(a);
    expect(briefHashOf({ ...CALL, contract: `0x${"ef".repeat(20)}` })).not.toBe(briefHashOf(CALL));
    expect(briefHashOf({ type: "onchain-call", contract: CONTRACT })).not.toBe(briefHashOf(CALL));
    expect(briefHashOf({ ...CALL, function: "register()" })).not.toBe(briefHashOf(CALL));
  });
});

describe("taskFromFields, taskDiff, taskIssueMatch", () => {
  it("builds a task from form fields and reports field errors", () => {
    expect(taskFromFields("onchain-call", { contract: CONTRACT, function: "register(bytes)", codehash: "" }))
      .toEqual({ task: CALL });
    expect(taskFromFields("onchain-call", { contract: "0xbad", function: "", codehash: "" }))
      .toEqual({ error: expect.stringMatching(/40-hex/) });
  });
  it("taskDiff lists the differing fields", () => {
    expect(taskDiff(CALL, CALL)).toEqual([]);
    expect(taskDiff(CALL, { ...CALL, contract: `0x${"ef".repeat(20)}` })).toEqual(["contract"]);
    expect(taskDiff(CALL, DEPLOY)).toEqual(["type", "contract", "function", "codehash"]);
  });
  it("taskIssueMatch explains what is wrong", () => {
    expect(taskIssueMatch(DEPLOY, `body\n${taskBlockText(DEPLOY)}`)).toEqual({ ok: true });
    expect(taskIssueMatch(DEPLOY, "no block")).toEqual({ ok: false, reason: expect.stringMatching(/no task block/) });
    expect(taskIssueMatch(DEPLOY, taskBlockText({ type: "onchain-deploy" })))
      .toEqual({ ok: false, reason: expect.stringMatching(/codehash/) });
    expect(taskIssueMatch(DEPLOY, wrap("type: onchain-deploy\ncodehash: nope")))
      .toEqual({ ok: false, reason: expect.stringMatching(/invalid/) });
  });
});

describe("functionSelector", () => {
  it("is the first 4 bytes of keccak256(signature)", () => {
    expect(functionSelector("register(bytes)")).toMatch(/^0x[0-9a-f]{8}$/);
    // transfer(address,uint256) is the well-known ERC20 selector
    expect(functionSelector("transfer(address,uint256)")).toBe("0xa9059cbb");
  });
});
