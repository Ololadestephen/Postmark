import { lazy, Suspense } from "react";
import WalletRoot from "../wallet/WalletRoot";
import { useWalletWanted } from "../components/walletIntent";
import { AnonDashboard } from "./AnonDashboard";
const MeInner = lazy(() => import("../wallet/MeInner"));

export default function Me() {
  const wanted = useWalletWanted();
  if (!wanted) return <AnonDashboard />;
  return (
    <Suspense fallback={<div className="py-16 text-center text-gray">Loading…</div>}>
      <WalletRoot><MeInner /></WalletRoot>
    </Suspense>
  );
}
