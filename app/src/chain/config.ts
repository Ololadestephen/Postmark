import { defineChain } from "viem";
import prodDeployment from "../../../deployments/diana.json";
import e2eDeployment from "../../../deployments/diana-e2e.json";

// VITE_DEPLOYMENT=e2e targets the dedicated e2e escrow; default is production.
const deployment = import.meta.env.VITE_DEPLOYMENT === "e2e"
  ? e2eDeployment : prodDeployment;
export const DEPLOYMENT_NAME =
  import.meta.env.VITE_DEPLOYMENT === "e2e" ? "e2e" : "diana";

export const diana = defineChain({
  id: 9800,
  name: "QoreChain diana",
  nativeCurrency: { name: "test QOR", symbol: "QOR", decimals: 18 },
  rpcUrls: {
    default: {
      http: ["https://evm-testnet.qore.host"],
      webSocket: ["wss://evm-ws-testnet.qore.host"],
    },
  },
  testnet: true,
});

export const EVM_RPC = diana.rpcUrls.default.http[0];
export const EVM_WS = diana.rpcUrls.default.webSocket![0];
// api-testnet has no CORS headers: the browser reaches it through the
// vite dev/preview proxy below; Node-side code gets the absolute URL.
export const REST =
  typeof window === "undefined" ? "https://api-testnet.qore.host" : "/qore-rest";
export const NATIVE_CHAIN_ID = "qorechain-diana";
/** Public GitHub issue where verifiers list themselves with a signed comment. */
export const VERIFIER_REGISTRY = { ownerRepo: "Ololadestephen/Postmark", issue: 6 } as const;
export const MESSAGE_PREFIX = `qorechain-msg-v1|${NATIVE_CHAIN_ID}|`;
export const EXPLORER = "https://dashboard.qorechain.io/explorer";
export const PQC_VERIFY_PRECOMPILE = "0x0000000000000000000000000000000000000a01" as const;
export const PQC_KEY_STATUS_PRECOMPILE = "0x0000000000000000000000000000000000000a02" as const;
export const ESCROW_ADDRESS = deployment.address as `0x${string}`;
export const DEPLOY_BLOCK = BigInt(deployment.deploy.block);

export const explorerTx = (hash: string) => `${EXPLORER}/tx/${hash}`;
export const explorerAddress = (addr: string) => `${EXPLORER}/address/${addr}`;
export const explorerBlock = (height: number | bigint) => `${EXPLORER}/block/${height}`;
