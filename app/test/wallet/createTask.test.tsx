import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TaskPicker, taskGate } from "../../src/wallet/createTask";
import { taskBlockText, type Task } from "../../src/github/task";
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
    expect(gate({ ...call, code: { isPending: true, error: null } }).ok).toBe(false);
    expect(gate({ ...call, code: { isPending: false, error: null, data: "0x" } }))
      .toMatchObject({ ok: false, message: expect.stringMatching(/no code on diana/) });
    expect(gate({ ...call, code: { isPending: false, error: null, data: "0x6000" } }).ok).toBe(true);
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
