import { useEffect, useState } from "react";
import { hexToBytes } from "viem";
import { mldsa87 } from "@qorechain/pqc";
import { signerStatus, SignerError } from "../../chain/localSigner";
import { useToast } from "../../components/Toasts";
import { pickSigner } from "../pqSigner";
import { useQorex } from "../qorex";
import { pqcKeyStatus } from "../../chain/pqc";
import { evmToQor } from "../../chain/bech32";
import { sameAddress } from "../../chain/address";
import { errorMessage, qorexFailureToast } from "../../chain/errors";
import type { Bounty } from "../../chain/client";
import type { BuiltVerdict } from "../../chain/verdict";

/** Sign the built verdict as one of the bounty's verifiers and verify the result locally. */
export function useVerdictSigning(
  bounty: Bounty, built: BuiltVerdict | null,
  onSigned: (index: number, signature: `0x${string}`) => void,
) {
  const qorex = useQorex();
  const toast = useToast();
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signedIndex, setSignedIndex] = useState<number | null>(null);

  // a new verdict invalidates any earlier signature confirmation
  useEffect(() => { setSignedIndex(null); }, [built]);

  const sign = async () => {
    if (!built) return;
    setSigning(true); setError(null);
    try {
      const signer = pickSigner(qorex);
      let index: number;
      if (signer.id === "local") {
        const st = await signerStatus();
        index = bounty.verifiers.findIndex((v) => sameAddress(v, st.address));
        if (index < 0) throw new SignerError(422,
          `The local signer holds ${st.address}, which is not a verifier on this bounty.`);
        if (!st.live) throw new SignerError(422, "The signer's key is not live on diana.");
      } else {
        index = bounty.verifiers.findIndex((v) => evmToQor(v) === qorex.qorAddress);
        if (index < 0) throw new Error("Your QoreX account is not one of this bounty's verifiers. Select the matching account in QoreX.");
      }
      const signature = await signer.signVerdict({ verdict: built.verdict, message: built.message });
      const key = await pqcKeyStatus(bounty.verifiers[index]!);
      if (!key.live) throw new Error(`Verifier #${index}'s ML-DSA-87 key is not live on diana.`);
      const ok = await mldsa87.verify(hexToBytes(key.pubkey), hexToBytes(built.message), hexToBytes(signature));
      if (!ok) {
        throw new Error("The returned signature failed local ML-DSA-87 verification — refusing to record it.");
      }
      setSignedIndex(index);
      onSigned(index, signature);
    } catch (e) {
      setError(errorMessage(e));
      toast(qorexFailureToast(e, { title: "Signing didn't work" }));
    } finally { setSigning(false); }
  };

  return { sign, signing, error, signedIndex };
}
