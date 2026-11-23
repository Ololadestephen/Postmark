// The on-chain task brief that lives in a ```postmark-task fenced block in the issue body.
// Pure parsing, shared by the app and the verifier bot (no browser APIs).
import { encodeAbiParameters, keccak256, stringToHex, type Hex } from "viem";

export type TaskType = "onchain-call" | "onchain-deploy" | "testing" | "url";

export interface Task {
  type: TaskType;
  /** required for onchain-call, forbidden otherwise (lowercase 0x + 40 hex) */
  contract?: `0x${string}`;
  /** optional, onchain-call only: Solidity signature like register(bytes) */
  function?: string;
  /** optional, onchain-deploy only: keccak256 of the runtime bytecode */
  codehash?: Hex;
}

export type TaskParse = { task: Task } | { error: string };

const INFO = "postmark-task";
const FENCE_RE = /^```postmark-task[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/gm;
const KEYS = ["type", "contract", "function", "codehash"] as const;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const TYPES: TaskType[] = ["onchain-call", "onchain-deploy", "testing", "url"];
/** name(types) — no whitespace, no parameter names; types may nest in tuples and arrays. */
const SIGNATURE_RE = /^[A-Za-z_$][A-Za-z0-9_$]*\([A-Za-z0-9_$[\],()]*\)$/;

/** Find the one postmark-task block in an issue body. null = code bounty; error = malformed. */
export function parseTaskBlock(body: string | null | undefined): TaskParse | null {
  if (!body) return null;
  const text = body.replace(/\r\n/g, "\n");
  const blocks = [...text.matchAll(FENCE_RE)];
  if (blocks.length === 0) return null;
  if (blocks.length > 1) return { error: "more than one postmark-task block" };
  return parseTaskInner(blocks[0]![1]!);
}

function parseTaskInner(inner: string): TaskParse {
  const fields = new Map<string, string>();
  for (const raw of inner.split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const sep = line.indexOf(":");
    if (sep <= 0) return { error: `bad line "${line}"` };
    const key = line.slice(0, sep).trim();
    const value = line.slice(sep + 1).trim();
    if (!(KEYS as readonly string[]).includes(key)) return { error: `unknown key "${key}"` };
    if (fields.has(key)) return { error: `duplicate key "${key}"` };
    if (!value) return { error: `empty value for "${key}"` };
    fields.set(key, value);
  }
  const type = fields.get("type");
  if (!type) return { error: "missing type" };
  if (!(TYPES as string[]).includes(type)) return { error: `unknown type "${type}"` };
  const task: Task = { type: type as TaskType };

  const contract = fields.get("contract");
  if (task.type === "onchain-call") {
    if (!contract) return { error: "onchain-call needs a contract" };
    if (!ADDRESS_RE.test(contract)) return { error: "contract must be a 40-hex 0x address" };
    task.contract = contract.toLowerCase() as `0x${string}`;
  } else if (contract) return { error: `contract is only allowed for onchain-call` };

  const fn = fields.get("function");
  if (fn !== undefined) {
    if (task.type !== "onchain-call") return { error: "function is only allowed for onchain-call" };
    if (!SIGNATURE_RE.test(fn)) return { error: `bad function signature "${fn}"` };
    task.function = fn;
  }

  const codehash = fields.get("codehash");
  if (codehash !== undefined) {
    if (task.type !== "onchain-deploy") return { error: "codehash is only allowed for onchain-deploy" };
    if (!HASH_RE.test(codehash)) return { error: "codehash must be a 32-byte 0x hash" };
    task.codehash = codehash.toLowerCase() as Hex;
  }
  return { task };
}

/** The canonical inner text: fixed key order, no comments, one key per line. */
export function canonicalTaskText(task: Task): string {
  const lines = [`type: ${task.type}`];
  if (task.contract) lines.push(`contract: ${task.contract}`);
  if (task.function) lines.push(`function: ${task.function}`);
  if (task.codehash) lines.push(`codehash: ${task.codehash}`);
  return lines.join("\n") + "\n";
}

/** The block the Create form asks the funder to paste into the issue body. */
export function taskBlockText(task: Task): string {
  return "```" + INFO + "\n" + canonicalTaskText(task) + "```";
}

/** keccak256(abi.encode("postmark-brief-v1", canonicalText)) — the brief a claim line carries. */
export function briefHashOf(task: Task): Hex {
  return keccak256(encodeAbiParameters(
    [{ type: "string" }, { type: "string" }],
    ["postmark-brief-v1", canonicalTaskText(task)]));
}

/** First 4 bytes of keccak256(signature) — the calldata selector. */
export function functionSelector(signature: string): Hex {
  return keccak256(stringToHex(signature)).slice(0, 10) as Hex;
}

/** Build a Task from Create-form fields, validating like the parser does. */
export function taskFromFields(type: TaskType, fields: { contract?: string; function?: string; codehash?: string }): TaskParse {
  const inner = [
    `type: ${type}`,
    ...(fields.contract !== undefined && fields.contract !== "" ? [`contract: ${fields.contract}`] : []),
    ...(fields.function !== undefined && fields.function !== "" ? [`function: ${fields.function}`] : []),
    ...(fields.codehash !== undefined && fields.codehash !== "" ? [`codehash: ${fields.codehash}`] : []),
  ].join("\n");
  return parseTaskInner(inner);
}

/** Field names where two tasks differ (used to say which part of the issue block to fix). */
export function taskDiff(a: Task, b: Task): string[] {
  const diff: string[] = [];
  if (a.type !== b.type) diff.push("type");
  if ((a.contract ?? "") !== (b.contract ?? "")) diff.push("contract");
  if ((a.function ?? "") !== (b.function ?? "")) diff.push("function");
  if ((a.codehash ?? "") !== (b.codehash ?? "")) diff.push("codehash");
  return diff;
}

/** Whether the issue body carries a task block identical to the form's task. */
export function taskIssueMatch(task: Task, issueBody: string | null | undefined):
  { ok: true } | { ok: false; reason: string } {
  const parsed = parseTaskBlock(issueBody);
  if (!parsed) return { ok: false, reason: "the issue has no task block — paste the one below into its body" };
  if ("error" in parsed) return { ok: false, reason: `the issue's task block is invalid: ${parsed.error}` };
  const diff = taskDiff(task, parsed.task);
  if (diff.length) return { ok: false, reason: `issue block differs on: ${diff.join(", ")}` };
  return { ok: true };
}
