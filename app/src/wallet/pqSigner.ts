// PQ signing abstraction: QoreX signArbitrary by default, the local signer as an Advanced option.
// ML-DSA-87 secrets never touch the app.
import type { QorexNativeProvider } from "@qorechain/qorex-types";
import { NATIVE_CHAIN_ID } from "../chain/config";
import { signClaim as localSignClaim, signVerdict as localSignVerdict,
  signerUrl, SignerError } from "../chain/localSigner";
import { bytesToHex, hexToBytes, type Hex } from "viem";
import { prefersLocalSigner } from "./signerPreference";
import type { VerdictFields } from "../formats/messages";
import type { QorexState } from "./qorex";

export interface ClaimSignRequest {
  bountyId: bigint;
  identityHash: Hex;
  claimRound: bigint;
  /** the exact message bytes the signature must cover (verified locally too) */
  message: `0x${string}`;
}

export interface VerdictSignRequest {
  verdict: VerdictFields;
  /** the exact message bytes the signature must cover (verified locally too) */
  message: `0x${string}`;
}

export interface PqSigner {
  id: "local" | "qorex";
  label: string;
  sign(req: ClaimSignRequest): Promise<`0x${string}`>;
  signVerdict(req: VerdictSignRequest): Promise<`0x${string}`>;
}

const MSG_PREFIX = `qorechain-msg-v1|${NATIVE_CHAIN_ID}|`;
const MSG_PREFIX_BYTES = new TextEncoder().encode(MSG_PREFIX);
const ML_DSA_87_SIGNATURE_BYTES = 4627;

/**
 * QoreSign message-signing-v1 prepends `qorechain-msg-v1|<chainId>|` itself and refuses data that already
 * carries a reserved `qorechain-` prefix, so the contract's message is signed by passing only its payload.
 */
export function stripMessagePrefix(message: `0x${string}`): Uint8Array {
  const bytes = hexToBytes(message);
  const ok = bytes.length >= MSG_PREFIX_BYTES.length
    && MSG_PREFIX_BYTES.every((b, i) => bytes[i] === b);
  if (!ok) throw new Error(`Refusing to sign: the message does not start with "${MSG_PREFIX}".`);
  return bytes.slice(MSG_PREFIX_BYTES.length);
}

/** Accepts the pq.signature as 0x/plain hex or base64 and returns 0x hex; anything else is rejected. */
export function decodePqSignature(sig: string): `0x${string}` {
  const text = sig.trim();
  const plainHex = text.startsWith("0x") ? text.slice(2) : text;
  let bytes: Uint8Array | null = null;
  if (/^[0-9a-fA-F]+$/.test(plainHex) && plainHex.length === ML_DSA_87_SIGNATURE_BYTES * 2) {
    bytes = hexToBytes(`0x${plainHex}`);
  } else if (/^[A-Za-z0-9+/]+={0,2}$/.test(text)) {
    try {
      const raw = atob(text.padEnd(Math.ceil(text.length / 4) * 4, "="));
      bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
    } catch { bytes = null; }
  }
  if (!bytes || bytes.length !== ML_DSA_87_SIGNATURE_BYTES) {
    throw new Error(`QoreX returned a signature in an unexpected format (expected ${ML_DSA_87_SIGNATURE_BYTES} bytes as hex or base64).`);
  }
  return bytesToHex(bytes);
}

async function qorexSign(native: QorexNativeProvider, qor1: string, message: `0x${string}`) {
  const data = stripMessagePrefix(message);
  await native.enable(NATIVE_CHAIN_ID);
  const res = await native.signArbitrary(NATIVE_CHAIN_ID, qor1, data) as unknown as
    { pq?: { signature?: string } };
  const sig = res?.pq?.signature;
  if (!sig) throw new Error("QoreX returned no PQ signature.");
  return decodePqSignature(sig);
}

/** Signs a verifier-listing message with QoreX (same prefix handling as claims). Interactive: call from a click. */
export const signVerifierListing = (native: QorexNativeProvider, qor1: string, message: `0x${string}`) =>
  qorexSign(native, qor1, message);

export const localSigner: PqSigner = {
  id: "local",
  get label() { return `Local signer (${signerUrl()})`; },
  async sign(req) {
    const out = await localSignClaim({
      bountyId: req.bountyId, identityHash: req.identityHash, claimRound: req.claimRound,
    });
    return out.signature;
  },
  async signVerdict(req) {
    const out = await localSignVerdict(req.verdict);
    return out.signature;
  },
};

export function qorexSigner(native: QorexNativeProvider, qor1: string): PqSigner {
  return {
    id: "qorex",
    label: `QoreX signArbitrary (${qor1})`,
    sign: (req) => qorexSign(native, qor1, req.message),
    signVerdict: (req) => qorexSign(native, qor1, req.message),
  };
}

/** QoreX when it can sign arbitrary messages for the active account, else the local signer. */
export function pickSigner(qorex: QorexState): PqSigner {
  return !prefersLocalSigner() && qorex.canSignArbitrary && qorex.native && qorex.qorAddress
    ? qorexSigner(qorex.native, qorex.qorAddress) : localSigner;
}

export { SignerError };
