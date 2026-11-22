import { useAccount } from "wagmi";
import { isZeroAddress, sameAddress } from "../chain/address";
import type { Bounty } from "../chain/client";

export type BountyRoleName = "funder" | "claimant" | "verifier" | "visitor";
export interface BountyRole { role: BountyRoleName; verifierIndex: number }

/** Presentation only: who the connected account is on this bounty (all data is public). */
export function bountyRole(
  bounty: Pick<Bounty, "funder" | "payee" | "verifiers">, address: string | undefined | null,
): BountyRole {
  if (!address) return { role: "visitor", verifierIndex: -1 };
  if (sameAddress(address, bounty.funder)) return { role: "funder", verifierIndex: -1 };
  const verifierIndex = bounty.verifiers.findIndex((v) => sameAddress(v, address));
  if (verifierIndex >= 0) return { role: "verifier", verifierIndex };
  if (!isZeroAddress(bounty.payee) && sameAddress(address, bounty.payee)) return { role: "claimant", verifierIndex: -1 };
  return { role: "visitor", verifierIndex: -1 };
}

export function useBountyRole(bounty: Pick<Bounty, "funder" | "payee" | "verifiers">): BountyRole {
  const { address } = useAccount();
  return bountyRole(bounty, address);
}
