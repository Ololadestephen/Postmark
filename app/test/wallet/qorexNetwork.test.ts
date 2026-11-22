import { afterEach, describe, expect, it, vi } from "vitest";
import { assertQorexTestnet, qorexNetwork } from "../../src/wallet/qorex";
import { isQorexWrongNetwork, qorexFailureToast, QOREX_MAINNET_TEXT, QOREX_MAINNET_TITLE } from "../../src/chain/errors";

const setEvm = (request: unknown) => { (window as unknown as { qorex?: unknown }).qorex = request === undefined ? {} : { evm: { request } }; };
afterEach(() => { delete (window as unknown as { qorex?: unknown }).qorex; });

describe("qorexNetwork", () => {
  it("reads mainnet, testnet, and falls back to unknown", async () => {
    setEvm(vi.fn().mockResolvedValue("0x2649")); expect(await qorexNetwork()).toBe("mainnet");
    setEvm(vi.fn().mockResolvedValue("0x2648")); expect(await qorexNetwork()).toBe("testnet");
    setEvm(vi.fn().mockResolvedValue("0x1")); expect(await qorexNetwork()).toBe("unknown");
    setEvm(vi.fn().mockRejectedValue(new Error("locked"))); expect(await qorexNetwork()).toBe("unknown");
    setEvm(undefined); expect(await qorexNetwork()).toBe("unknown");
  });
  it("only asks for eth_chainId", async () => {
    const request = vi.fn().mockResolvedValue("0x2648");
    setEvm(request); await qorexNetwork();
    expect(request).toHaveBeenCalledWith({ method: "eth_chainId" });
  });
  it("assertQorexTestnet throws on mainnet only", async () => {
    setEvm(vi.fn().mockResolvedValue("0x2649"));
    await expect(assertQorexTestnet()).rejects.toThrow(/QoreX is on mainnet/);
    setEvm(vi.fn().mockResolvedValue("0x2648")); await expect(assertQorexTestnet()).resolves.toBeUndefined();
    setEvm(undefined); await expect(assertQorexTestnet()).resolves.toBeUndefined();
  });
});

describe("wrong-network error mapping", () => {
  it("recognises QoreX's refusal and our own guard", () => {
    expect(isQorexWrongNetwork(new Error("QoreX: message chain qorechain-diana does not match the active network qorechain-vladi"))).toBe(true);
    expect(isQorexWrongNetwork(new Error("active network qorechain-vladi"))).toBe(true);
    expect(isQorexWrongNetwork(new Error("QoreX is on mainnet. Switch QoreX to testnet"))).toBe(true);
    expect(isQorexWrongNetwork(new Error("User rejected the request."))).toBe(false);
  });
  it("shows a warning with the 7-tap steps, and an error otherwise", () => {
    expect(qorexFailureToast(new Error("does not match the active network"), { title: "Signing failed" }))
      .toEqual({ kind: "warning", title: QOREX_MAINNET_TITLE, text: QOREX_MAINNET_TEXT });
    expect(QOREX_MAINNET_TEXT).toMatch(/7 times.*Switch to testnet \(diana\)/);
    expect(qorexFailureToast(new Error("boom"), { title: "Signing failed" }))
      .toEqual({ kind: "error", title: "Signing failed", text: "boom" });
  });
});
