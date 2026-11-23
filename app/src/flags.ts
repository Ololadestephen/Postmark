/**
 * Off unless built with VITE_HUMAN_TASKS=1: creation and the claimant
 * submission helper for human-judged "testing"/"url" task bounties. Bounty
 * pages and the verifier review tool render those tasks either way.
 */
export const humanTasksEnabled = () => import.meta.env.VITE_HUMAN_TASKS === "1";
