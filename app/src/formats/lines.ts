// The exact comment lines a claimant and a disputer post on the GitHub item.

export function claimLine(bountyId: bigint, claimant: `0x${string}`, escrow: `0x${string}`, brief?: `0x${string}`) {
  const base = `postmark-claim v1 chain=9800 escrow=${escrow.toLowerCase()} bounty=${bountyId} claimant=${claimant.toLowerCase()}`;
  return brief ? `${base} brief=${brief.toLowerCase()}` : base;
}

export function proofLine(txHash: `0x${string}`) {
  return `postmark-proof v1 tx=${txHash.toLowerCase()}`;
}

export function submissionLine(url: string) {
  return `postmark-submission v1 url=${url.trim()}`;
}

export function disputeLine(bountyId: bigint, escrow: `0x${string}`) {
  return `postmark-dispute v1 chain=9800 escrow=${escrow.toLowerCase()} bounty=${bountyId}`;
}
