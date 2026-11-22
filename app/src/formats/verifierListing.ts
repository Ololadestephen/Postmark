// Self-service verifier sign-up: a signed one-line comment on the public registry issue.
// Pure format/parse/verify; the app decides whom to trust, this only proves control of a post-quantum key.
import { bytesToHex, hexToBytes, type Hex } from "viem";
import { MESSAGE_PREFIX, ESCROW_ADDRESS } from "../chain/config";
import type { GhComment } from "../github/comments";

export const MAX_LISTING_COMMENTS = 50;
const SIG_HEX_CHARS = 4627 * 2;

/** GitHub username rules: 1-39 chars, alphanumerics and single hyphens, no leading/trailing hyphen. */
export const isGithubLogin = (s: string) => /^(?!-)(?!.*--)[A-Za-z0-9-]{1,39}(?<!-)$/.test(s);

const LINE = new RegExp(`postmark-verifier\\s+v1\\s+(0x[0-9a-fA-F]{40})\\s+([A-Za-z0-9-]{1,39})\\s+(0x[0-9a-fA-F]{${SIG_HEX_CHARS}})(?![0-9a-fA-F])`);

/** The exact bytes a verifier signs. */
export function listingMessage(address: string, githubLogin: string, escrow: string = ESCROW_ADDRESS): Hex {
  const text = `${MESSAGE_PREFIX}postmark-verifier-v1|${escrow.toLowerCase()}|${address.toLowerCase()}|${githubLogin.toLowerCase()}`;
  return bytesToHex(new TextEncoder().encode(text));
}

/** The comment to post, with the line in a fenced block. */
export function formatListingComment(address: string, githubLogin: string, signature: Hex): string {
  return `\`\`\`\npostmark-verifier v1 ${address} ${githubLogin} ${signature}\n\`\`\`\n`;
}

export interface ListingLine { address: `0x${string}`; login: string; signature: Hex }

/** The first valid line in a comment body, or null. */
export function parseListingLine(body: string): ListingLine | null {
  for (const raw of body.split("\n")) {
    const m = raw.match(LINE);
    if (m && isGithubLogin(m[2]!)) return { address: m[1] as `0x${string}`, login: m[2]!, signature: m[3] as Hex };
  }
  return null;
}

export interface Listing { address: `0x${string}`; login: string; commentId: number; commentUrl?: string }
export type ListingProblem = "login-mismatch" | "key-not-live" | "bad-signature" | "malformed" | "curated";

export interface ListingDeps {
  /** live registered ML-DSA-87 key (0x hex) for an address, or null when not live */
  liveKey: (address: `0x${string}`) => Promise<Hex | null>;
  verify: (pubkey: Uint8Array, message: Uint8Array, signature: Uint8Array) => boolean | Promise<boolean>;
  curated: Set<string>;
  escrow?: string;
}

/** Checks one comment; returns the listing or the reason it was dropped. */
export async function checkListing(c: GhComment, deps: ListingDeps): Promise<Listing | ListingProblem> {
  const line = parseListingLine(c.body ?? "");
  if (!line) return "malformed";
  if (line.login.toLowerCase() !== c.user.login.toLowerCase()) return "login-mismatch";
  if (deps.curated.has(line.address.toLowerCase())) return "curated";
  const key = await deps.liveKey(line.address).catch(() => null);
  if (!key) return "key-not-live";
  const ok = await Promise.resolve(deps.verify(hexToBytes(key), hexToBytes(listingMessage(line.address, line.login, deps.escrow)), hexToBytes(line.signature))).catch(() => false);
  return ok ? { address: line.address, login: line.login, commentId: c.id } : "bad-signature";
}

/** Verified listings from the registry comments: newest 50 considered, one per address (latest wins). */
export async function collectListings(comments: GhComment[], deps: ListingDeps): Promise<Listing[]> {
  const recent = comments.slice(-MAX_LISTING_COMMENTS);
  const byAddress = new Map<string, Listing>();
  for (const c of recent) { // chronological: later comments overwrite earlier ones
    const r = await checkListing(c, deps);
    if (typeof r !== "string") byAddress.set(r.address.toLowerCase(), r);
  }
  return [...byAddress.values()];
}
