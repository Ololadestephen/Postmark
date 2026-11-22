import { describe, it, expect } from "vitest";
import { FEE_CAP_WEI, txOptions, windowMaxValueUqor } from "../src/window";

describe("transaction fees", () => {
  it("sends every transaction with the fee cap the window is sized for", () => {
    const o = txOptions(500_000n);
    expect(o.gas).toBe(500_000n);
    expect(o.maxFeePerGas).toBe(FEE_CAP_WEI);
    expect(o.maxPriorityFeePerGas).toBe(FEE_CAP_WEI - 100_000_000_000n);
  });
  it("sizes the window cap to cover gas x the fee cap for every transaction", () => {
    const gases = [197_097n * 10n, 400_000n];
    const need = gases.reduce((s, g) => s + g * txOptions(g).maxFeePerGas, 0n) / 1_000_000_000_000n;
    expect(BigInt(windowMaxValueUqor(gases))).toBeGreaterThanOrEqual(need);
  });
});
