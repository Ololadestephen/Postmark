import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TaskPicker, taskGate, humanTaskVerifierError } from "../../src/wallet/createTask";
import { taskBlockText, type Task } from "../../src/github/task";
import { VERIFIERS } from "../../src/data/verifiers";
import type { GithubRef } from "../../src/github/parse";

const CONTRACT = `0x${"ab".repeat(20)}` as `0x${string}`;
const DEPLOY: Task = { type: "onchain-deploy" };
const CALL: Task = { type: "onchain-call", contract: CONTRACT };
const ISSUE: GithubRef = { ownerRepo: "acme/widgets", kind: 0, number: 7 };
const PR: GithubRef = { ownerRepo: "acme/widgets", kind: 1, number: 7 };
const NO_QUERY = { isPending: false, error: null, data: undefined };

const gate = (over: Partial<Parameters<typeof taskGate>[0]> = {}) => taskGate({
  taskType: "code", gref: ISSUE, formTask: null, formError: null,
  issue: { ...NO_QUERY, data: { body: "plain issue" } as never }, code: NO_QUERY,
  ...over,
});

describe("taskGate", () => {
  it("always allows a code bounty", () => {
    expect(gate().ok).toBe(true);
    expect(gate({ gref: null }).ok).toBe(true);
  });
  it("blocks an on-chain task on a pull request or a missing URL", () => {
    expect(gate({ taskType: "onchain-deploy", gref: PR, formTask: DEPLOY }))
      .toMatchObject({ ok: false, message: expect.stringMatching(/issue, not a pull request/) });
    expect(gate({ taskType: "onchain-deploy", gref: null }).ok).toBe(false);
  });
  it("blocks until the issue body carries the matching block", () => {
    expect(gate({ taskType: "onchain-deploy", formTask: DEPLOY }))
      .toMatchObject({ ok: false, message: expect.stringMatching(/no task block/) });
    expect(gate({
      taskType: "onchain-deploy", formTask: DEPLOY,
      issue: { ...NO_QUERY, data: { body: taskBlockText({ type: "onchain-deploy", codehash: `0x${"ee".repeat(32)}` }) } as never },
    })).toMatchObject({ ok: false, message: expect.stringMatching(/differs on: codehash/) });
    expect(gate({
      taskType: "onchain-deploy", formTask: DEPLOY,
      issue: { ...NO_QUERY, data: { body: taskBlockText(DEPLOY) } as never },
    }).ok).toBe(true);
  });
  it("blocks a call task while the issue is loading and while the contract check runs", () => {
    const call = { taskType: "onchain-call" as const, formTask: CALL,
      issue: { ...NO_QUERY, data: { body: taskBlockText(CALL) } as never } };
    expect(gate({ ...call, issue: { isPending: true, error: null } }).ok).toBe(false);
    expect(gate({ ...call, issue: { isPending: false, error: new Error("rate limited") } }))
      .toMatchObject({ ok: false, message: expect.stringMatching(/Can't read the issue/) });
    expect(gate({ ...call, code: { isPending: true, error: null } }).ok).toBe(false);
    expect(gate({ ...call, code: { isPending: false, error: null, data: "0x" } }))
      .toMatchObject({ ok: false, message: expect.stringMatching(/no code on diana/) });
    expect(gate({ ...call, code: { isPending: false, error: null, data: "0x6000" } }).ok).toBe(true);
  });
});

describe("human-judged tasks", () => {
  afterEach(() => vi.unstubAllEnvs());
  const BOTS = VERIFIERS.filter((v) => v.kind === "bot").map((v) => v.address);
  const CUSTOM = `0x${"ca".repeat(20)}`;
  const TESTING: Task = { type: "testing" };

  it("gates funding on the matching block like the on-chain types", () => {
    expect(gate({ taskType: "testing", formTask: TESTING }))
      .toMatchObject({ ok: false, message: expect.stringMatching(/no task block/) });
    expect(gate({
      taskType: "testing", formTask: TESTING,
      issue: { ...NO_QUERY, data: { body: taskBlockText(TESTING) } as never },
    }).ok).toBe(true);
    expect(gate({
      taskType: "testing", formTask: TESTING,
      issue: { ...NO_QUERY, data: { body: taskBlockText({ type: "url" }) } as never },
    }).ok).toBe(false);
  });

  it("needs at most one curated bot among the three verifiers", () => {
    const msg = "Testing and URL bounties are judged by people: pick at least two human verifiers. The Postmark bots can't judge them and would abstain.";
    expect(humanTaskVerifierError("testing", [BOTS[0]!, BOTS[1]!, CUSTOM])).toBe(msg);
    expect(humanTaskVerifierError("url", [BOTS[0]!, BOTS[1]!, CUSTOM])).toBe(msg);
    expect(humanTaskVerifierError("testing", [BOTS[0]!, CUSTOM, `0x${"cb".repeat(20)}`])).toBeNull();
    expect(humanTaskVerifierError("testing", [BOTS[0]!.toLowerCase(), BOTS[1]!.toLowerCase(), CUSTOM])).toBe(msg);
    expect(humanTaskVerifierError("onchain-call", [BOTS[0]!, BOTS[1]!, BOTS[0]!])).toBeNull();
    expect(humanTaskVerifierError("code", [BOTS[0]!, BOTS[1]!, CUSTOM])).toBeNull();
  });

  it("shows the Testing and URL chips only with VITE_HUMAN_TASKS=1", () => {
    const props = { onType: () => {}, fields: { contract: "", function: "", codehash: "" },
      onFields: () => {}, block: null, fieldError: null, matchMessage: null };
    vi.stubEnv("VITE_HUMAN_TASKS", "");
    const off = render(<TaskPicker taskType="code" {...props} />);
    expect(screen.queryByRole("button", { name: "Testing" })).toBeNull();
    expect(screen.queryByRole("button", { name: "URL deliverable" })).toBeNull();
    off.unmount();
    vi.stubEnv("VITE_HUMAN_TASKS", "1");
    render(<TaskPicker taskType="testing" {...props} block={taskBlockText(TESTING)} />);
    expect(screen.getByRole("button", { name: "Testing" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "URL deliverable" })).toBeInTheDocument();
    expect(screen.getByText(/type: testing/)).toBeInTheDocument();
    expect(screen.getByText("paste this into the issue body")).toBeInTheDocument();
  });
});

describe("TaskPicker", () => {
  const fields = { contract: CONTRACT, function: "", codehash: "" };
  it("renders the generated block with a copy button", () => {
    render(<TaskPicker taskType="onchain-call" onType={() => {}} fields={fields}
      onFields={() => {}} block={taskBlockText(CALL)} fieldError={null} matchMessage={null} />);
    expect(screen.getByText(/type: onchain-call/)).toBeInTheDocument();
    expect(screen.getByText("paste this into the issue body")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
  });
  it("shows the match message and field errors", () => {
    render(<TaskPicker taskType="onchain-deploy" onType={() => {}} fields={fields}
      onFields={() => {}} block={null} fieldError="bad codehash" matchMessage="issue block differs on: codehash" />);
    expect(screen.getByText("bad codehash")).toBeInTheDocument();
    expect(screen.getByText("issue block differs on: codehash")).toBeInTheDocument();
  });
});
