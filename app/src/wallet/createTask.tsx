// The task-type picker on the Create form: code (GitHub PR) or an on-chain task
// whose brief the funder pastes into the issue body.
import { useState } from "react";
import type { Task } from "../github/task";
import { taskIssueMatch } from "../github/task";
import type { GhIssue, GhPull } from "../github/client";
import type { GithubRef } from "../github/parse";
import { humanTasksEnabled } from "../flags";
import { VERIFIERS } from "../data/verifiers";

export type PickerType = "code" | "onchain-call" | "onchain-deploy" | "testing" | "url";

/** Whether the form may fund: for on-chain tasks the issue body must carry the
 * matching task block, and an onchain-call contract must have code on diana. */
export function taskGate(args: {
  taskType: PickerType;
  gref: GithubRef | null;
  formTask: Task | null;
  formError: string | null;
  issue: { isPending: boolean; error: unknown; data?: GhIssue | GhPull | undefined };
  code: { isPending: boolean; error: unknown; data?: string | undefined };
}): { ok: boolean; message: string | null } {
  const { taskType, gref, formTask, formError, issue, code } = args;
  if (taskType === "code") return { ok: true, message: null };
  if (!gref || gref.kind !== 0) return { ok: false, message: "Task bounties point at an issue, not a pull request." };
  if (!formTask) return { ok: false, message: formError ?? "Fill in the task fields." };
  if (issue.isPending) return { ok: false, message: null };
  if (issue.error || !issue.data) return { ok: false, message: "Can't read the issue body from GitHub — try again." };
  const match = taskIssueMatch(formTask, (issue.data as GhIssue).body ?? null);
  if (!match.ok) return { ok: false, message: match.reason };
  if (formTask.type === "onchain-call") {
    if (code.isPending) return { ok: false, message: "Checking the contract on diana…" };
    if (code.error) return { ok: false, message: "Can't check the contract on diana — try again." };
    if (!code.data || code.data === "0x") return { ok: false, message: "That contract has no code on diana." };
  }
  return { ok: true, message: null };
}

const CURATED_BOTS = new Set(
  VERIFIERS.filter((v) => v.kind === "bot").map((v) => v.address.toLowerCase()));

/** testing/url bounties are judged by people: at most one of the three verifier
 * slots may name a curated bot (self-listed and custom addresses count as human). */
export function humanTaskVerifierError(taskType: PickerType, verifiers: string[]): string | null {
  if (taskType !== "testing" && taskType !== "url") return null;
  const bots = verifiers.filter((v) => CURATED_BOTS.has(v.toLowerCase())).length;
  return bots >= 2
    ? "Testing and URL bounties are judged by people: pick at least two human verifiers. The Postmark bots can't judge them and would abstain."
    : null;
}

const BASE_TYPES: { id: PickerType; label: string }[] = [
  { id: "code", label: "Code" },
  { id: "onchain-call", label: "On-chain call" },
  { id: "onchain-deploy", label: "On-chain deploy" },
];
const HUMAN_TYPES: { id: PickerType; label: string }[] = [
  { id: "testing", label: "Testing" },
  { id: "url", label: "URL deliverable" },
];

const chip = (on: boolean) =>
  `rounded-full border px-3 py-1.5 text-sm ${on ? "border-deep bg-leaf/30 text-ink" : "border-ink/15 bg-white text-charcoal hover:bg-ink/5"}`;

export function TaskPicker({ taskType, onType, fields, onFields, block, fieldError, matchMessage }: {
  taskType: PickerType;
  onType: (t: PickerType) => void;
  fields: { contract: string; function: string; codehash: string };
  onFields: (f: { contract: string; function: string; codehash: string }) => void;
  /** canonical postmark-task block for the current fields, when they parse */
  block: string | null;
  /** why the fields don't parse, if they don't */
  fieldError: string | null;
  /** how the issue body compares to the form task */
  matchMessage: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const input = "mt-1 w-full rounded-lg border border-ink/15 bg-white px-3 py-2 font-mono text-sm text-ink placeholder:text-gray focus:outline-none focus:ring-2 focus:ring-deep";
  const label = "font-mono text-[10px] uppercase tracking-[0.18em] text-gray";

  const copy = () => {
    if (!block) return;
    void navigator.clipboard?.writeText(block);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="mt-4 border-t border-ink/10 pt-4">
      <span className={label}>Task type</span>
      <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Task type">
        {(humanTasksEnabled() ? [...BASE_TYPES, ...HUMAN_TYPES] : BASE_TYPES).map((t) => (
          <button key={t.id} type="button" aria-pressed={taskType === t.id} onClick={() => onType(t.id)}
            className={chip(taskType === t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {taskType === "code" && (
        <p className="mt-2 text-xs text-gray">The claimant opens a pull request that closes the issue. The bots verify the merge.</p>
      )}

      {taskType === "onchain-call" && (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-gray">The claimant proves the work by sending a transaction to a contract on diana.</p>
          <label className="block text-sm">
            <span className={label}>Contract address</span>
            <input value={fields.contract} onChange={(e) => onFields({ ...fields, contract: e.target.value })}
              placeholder="0x…" className={input} />
          </label>
          <label className="block text-sm">
            <span className={label}>Function (optional)</span>
            <input value={fields.function} onChange={(e) => onFields({ ...fields, function: e.target.value })}
              placeholder="register(bytes)" className={input} />
          </label>
        </div>
      )}

      {taskType === "onchain-deploy" && (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-gray">The claimant proves the work by deploying a contract on diana.</p>
          <label className="block text-sm">
            <span className={label}>Runtime codehash (optional)</span>
            <input value={fields.codehash} onChange={(e) => onFields({ ...fields, codehash: e.target.value })}
              placeholder="0x… keccak256 of the deployed code" className={input} />
          </label>
        </div>
      )}

      {taskType === "testing" && (
        <p className="mt-2 text-xs text-gray">The claimant posts their test report on the issue. Human verifiers read it and decide.</p>
      )}
      {taskType === "url" && (
        <p className="mt-2 text-xs text-gray">The claimant posts a link to the deliverable on the issue. Human verifiers check it and decide.</p>
      )}

      {taskType !== "code" && (
        <div className="mt-3">
          {fieldError && <p role="alert" className="text-sm text-orange">{fieldError}</p>}
          {block && (
            <>
              <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-ink/10 bg-paper p-3 font-mono text-xs text-ink">{block}</pre>
              <div className="mt-2 flex items-center gap-3">
                <button type="button" onClick={copy}
                  className="rounded-lg bg-deep px-4 py-1.5 text-xs font-medium text-paper hover:brightness-110">
                  {copied ? "Copied" : "Copy"}
                </button>
                <span className="text-xs text-gray">paste this into the issue body</span>
              </div>
            </>
          )}
          {matchMessage && <p role="status" className="mt-2 text-sm text-orange">{matchMessage}</p>}
        </div>
      )}
    </div>
  );
}
