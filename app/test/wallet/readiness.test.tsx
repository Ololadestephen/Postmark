import { describe, it, expect } from "vitest";
import { readinessRows, type ReadinessInput } from "../../src/wallet/Readiness";
import { evmToQor } from "../../src/chain/bech32";
import { ESCROW_ADDRESS } from "../../src/chain/config";
import { CLAIMANT, FUNDER } from "../fixtures";

const OPEN_WINDOW = { found: true, live: true, remainingTxs: "5", remainingValue: "100000000", allowedTargets: [ESCROW_ADDRESS] };
const ready: ReadinessInput = {
  connected: true, chainId: 9800, qorexInstalled: true, qorAddress: evmToQor(CLAIMANT), account: CLAIMANT,
  pqcLive: true, window: OPEN_WINDOW as never, neededWei: 10n ** 17n, balanceWei: 10n ** 18n,
};
const byId = (i: ReadinessInput) => Object.fromEntries(readinessRows(i).map((r) => [r.id, r]));

describe("readiness rows", () => {
  it("offers the accounts fix on a QoreX/wallet mismatch", () => {
    const row = byId({ ...ready, account: FUNDER }).qorex!;
    expect(row.status).toBe("todo");
    expect(row.help).toBe("accounts");
  });
  it("adds a QoreX-on-testnet row only once QoreX is linked and its network is known", () => {
    expect(byId(ready).qorexNet).toBeUndefined();
    expect(byId({ ...ready, qorexNetwork: "unknown" }).qorexNet).toBeUndefined();
    expect(byId({ ...ready, qorAddress: null, qorexNetwork: "mainnet" }).qorexNet).toBeUndefined();
    expect(byId({ ...ready, qorexNetwork: "testnet" }).qorexNet).toMatchObject({ label: "QoreX on testnet", status: "ok" });
    const bad = byId({ ...ready, qorexNetwork: "mainnet" }).qorexNet!;
    expect(bad.status).toBe("todo");
    expect(bad.hint).toMatch(/tap the version number at the bottom 7 times/);
  });
  it("is all green when everything is in place", () => {
    expect(readinessRows(ready).map((r) => r.status)).toEqual(["ok", "ok", "ok", "ok", "ok", "ok"]);
  });
  it("asks to connect first and keeps dependent rows waiting", () => {
    const r = byId({ ...ready, connected: false, chainId: undefined, pqcLive: undefined });
    expect(r.wallet).toMatchObject({ status: "todo", action: { kind: "connect" } });
    expect([r.chain!.status, r.pqc!.status, r.window!.status]).toEqual(["wait", "wait", "wait"]);
  });
  it("offers a switch on the wrong network", () => {
    expect(byId({ ...ready, chainId: 1 }).chain).toMatchObject({ status: "todo", action: { kind: "switch" } });
  });
  it("explains a QoreX account mismatch in plain words", () => {
    const r = byId({ ...ready, account: FUNDER });
    expect(r.qorex).toMatchObject({ status: "todo" });
    expect(r.qorex!.hint).toMatch(/different accounts/);
  });
  it("links to QoreX when it is not installed", () => {
    expect(byId({ ...ready, qorexInstalled: false, qorAddress: null }).qorex)
      .toMatchObject({ status: "todo", action: { kind: "link", label: "Get QoreX" } });
  });
  it("tells the user to make one send when the key is not registered", () => {
    const r = byId({ ...ready, pqcLive: false });
    expect(r.pqc).toMatchObject({ status: "todo" });
    expect(r.pqc!.hint).toMatch(/one send/);
  });
  it("shows how to open a window when there is none or it is too small", () => {
    expect(byId({ ...ready, window: { found: false } as never }).window)
      .toMatchObject({ status: "todo", help: "window" });
    const small = { ...OPEN_WINDOW, remainingValue: "1" };
    expect(byId({ ...ready, window: small as never }).window!.status).toBe("todo");
  });
  it("links the faucet when the balance is short", () => {
    const r = byId({ ...ready, balanceWei: 10n ** 15n });
    expect(r.balance).toMatchObject({ status: "todo", action: { kind: "link", label: "Open faucet" } });
  });
});
