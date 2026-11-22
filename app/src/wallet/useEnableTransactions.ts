import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "../components/Toasts";
import { errorMessage, isUserRejection, qorexFailureToast, CANCELLED_MESSAGE } from "../chain/errors";
import { getQorexSnapshot, useQorex } from "./qorex";
import { canEnableTransactions, enableTransactions } from "./enableTransactions";

/** Click handler for the checklist's "Enable" button; falls back to the manual steps when QoreX can't do it. */
export function useEnableTransactions() {
  const qorex = useQorex();
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const run = useCallback(async (neededWei: bigint) => {
    if (busy) return;
    let q = qorex;
    if (qorex.native && canEnableTransactions(qorex.native) && !qorex.qorAddress) {
      try { await qorex.connectAccount(); q = getQorexSnapshot(); }
      catch (e) {
        toast(isUserRejection(e)
          ? { kind: "info", title: "Cancelled", text: CANCELLED_MESSAGE }
          : qorexFailureToast(e, { title: "Couldn't reach QoreX" }));
        return;
      }
    }
    if (!canEnableTransactions(q.native) || !q.native || !q.qorAddress) {
      toast({ kind: "warning", title: "Enable it in QoreX", text: "QoreX isn't ready to do this here. Follow the steps on the Get started page." });
      return;
    }
    setBusy(true);
    try {
      const res = await enableTransactions(q.native, q.qorAddress, neededWei);
      if (res.code === 0) {
        toast({ kind: "success", title: "Transactions enabled", text: `Window opened (tx ${res.txHash.slice(0, 10)}…).` });
      } else {
        toast({ kind: "error", title: "Couldn't enable transactions", text: `The chain rejected it (code ${res.code}). Follow the steps on the Get started page.` });
      }
      void qc.invalidateQueries({ queryKey: ["evmWindow"] });
    } catch (e) {
      toast(isUserRejection(e)
        ? { kind: "info", title: "Cancelled", text: CANCELLED_MESSAGE }
        : qorexFailureToast(e, { title: "Couldn't enable transactions", text: `${errorMessage(e)} Follow the steps on the Get started page.` }));
    } finally { setBusy(false); }
  }, [busy, qorex.native, qorex.qorAddress, toast, qc]);

  return { run, busy };
}
