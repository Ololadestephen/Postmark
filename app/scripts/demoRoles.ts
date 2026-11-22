// Role selection for scripts/demo.mjs (`--roles funder,claimant,…`).

export const ROLES = ["funder", "claimant", "verifier0", "verifier1", "verifier2", "disputer"] as const;
export type Role = (typeof ROLES)[number];

const isRole = (r: string): r is Role => (ROLES as readonly string[]).includes(r);

/**
 * Roles named by `--roles a,b` or `--roles=a,b`, in canonical order; every role when the
 * flag is absent. Throws on a missing value or an unknown role name.
 */
export function parseRoles(args: readonly string[]): Role[] {
  let raw: string | undefined;
  let present = false;
  args.forEach((a, i) => {
    if (a === "--roles") { present = true; raw = args[i + 1]; }
    else if (a.startsWith("--roles=")) { present = true; raw = a.slice("--roles=".length); }
  });
  if (!present) return [...ROLES];
  const names = (raw ?? "").startsWith("--") ? [] :
    (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const valid = `valid roles: ${ROLES.join(", ")}`;
  if (names.length === 0) throw new Error(`--roles needs a comma-separated list (${valid})`);
  const unknown = names.filter((n) => !isRole(n));
  if (unknown.length) throw new Error(`unknown role${unknown.length > 1 ? "s" : ""} ${unknown.join(", ")} (${valid})`);
  return ROLES.filter((r) => names.includes(r));
}
