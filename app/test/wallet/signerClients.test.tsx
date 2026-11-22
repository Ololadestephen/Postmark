import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const qx = vi.hoisted(() => ({
  installed: false, native: null as unknown, accounts: [] as { address: string }[], caps: new Set<string>(),
  eip1193: null as unknown,
}));
vi.mock("@qorechain/qorex-types", () => ({
  isQorexInstalled: () => qx.installed,
  discoverQorexEip1193: async () => qx.eip1193,
  getQorexNative: () => qx.native,
  hasCapability: (_n: unknown, cap: string) => qx.caps.has(cap),
}));

import {
  signerStatus, signClaim, signVerdict, signerPort, setSignerPort, signerUrl,
  pairingCode, setPairingCode, SignerError,
} from "../../src/chain/localSigner";
import { localSigner, pickSigner, qorexSigner, decodePqSignature } from "../../src/wallet/pqSigner";
import { accountMismatchMessage } from "../../src/wallet/signerPreference";
import { evmToQor } from "../../src/chain/bech32";
import { bytesToHex } from "viem";
import { CLAIMANT, FUNDER } from "../fixtures";

const PREFIX = "qorechain-msg-v1|qorechain-diana|";
import { useQorex, resetQorexProbe, type QorexState } from "../../src/wallet/qorex";

const SIG = `0x${"ab".repeat(8)}` as const;
const jsonResponse = (status: number, body: unknown) =>
  ({ ok: status < 400, status, json: async () => body }) as Response;

beforeEach(() => { sessionStorage.clear(); });
afterEach(() => vi.unstubAllGlobals());

describe("signer endpoint settings", () => {
  it("defaults to port 47321 and ignores invalid ports", () => {
    expect(signerPort()).toBe(47321);
    setSignerPort(47322);
    expect(signerPort()).toBe(47322);
    expect(signerUrl()).toBe("http://127.0.0.1:47322");
    setSignerPort(99999);
    expect(signerPort()).toBe(47321);
    setSignerPort(null);
    expect(signerPort()).toBe(47321);
  });

  it("stores and clears the pairing code", () => {
    expect(pairingCode()).toBeNull();
    setPairingCode("deadbeef");
    expect(pairingCode()).toBe("deadbeef");
    setPairingCode(null);
    expect(pairingCode()).toBeNull();
  });
});

describe("signer requests", () => {
  it("sends the pairing code and returns the status payload", async () => {
    setPairingCode("deadbeef");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { address: "0x1", live: true }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await signerStatus()).toMatchObject({ live: true });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://127.0.0.1:47321/status");
    expect(init.headers["x-postmark-pair"]).toBe("deadbeef");
  });

  it("explains an unreachable signer and a rejected pairing code", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(signerStatus()).rejects.toThrow(/not reachable/);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(401, {})));
    await expect(signerStatus()).rejects.toMatchObject({ status: 401, message: expect.stringMatching(/Pairing code rejected/) });
  });

  it("surfaces the signer's refusal message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(422, { error: "declined at the terminal" })));
    const err = await signClaim({ bountyId: 1n, identityHash: `0x${"11".repeat(32)}`, claimRound: 1n }).catch((e) => e);
    expect(err).toBeInstanceOf(SignerError);
    expect(err).toMatchObject({ status: 422, message: "declined at the terminal" });
  });

  it("posts claims and verdicts with bigints as decimal strings", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { signature: SIG, signer: "0x1", pubkeySha256: "x" }));
    vi.stubGlobal("fetch", fetchMock);
    await signClaim({ bountyId: 7n, identityHash: `0x${"11".repeat(32)}`, claimRound: 2n });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toMatchObject({ kind: "claim", bountyId: "7", claimRound: "2" });
    await signVerdict({ bountyId: 7n, phase: 1, outcome: 0, payee: "0x1" as never, mergedAt: 9n,
      evidenceHash: `0x${"22".repeat(32)}`, nonce: 3n, claimRound: 2n });
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body).verdict).toMatchObject({ bountyId: "7", mergedAt: "9", nonce: "3" });
  });
});

describe("PQ signers", () => {
  it("the local signer returns the signature from the local process", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { signature: SIG })));
    expect(await localSigner.sign({ bountyId: 1n, identityHash: `0x${"11".repeat(32)}`, claimRound: 1n, message: "0x00" })).toBe(SIG);
    expect(await localSigner.signVerdict({ message: "0x00", verdict: {
      bountyId: 1n, phase: 0, outcome: 0, payee: "0x1" as never, mergedAt: 0n,
      evidenceHash: `0x${"22".repeat(32)}`, nonce: 0n, claimRound: 1n } as never })).toBe(SIG);
    expect(localSigner.label).toContain("127.0.0.1");
  });

  it("the QoreX signer strips the reserved prefix, enables the chain and decodes hex or base64", async () => {
    const payload = new Uint8Array([1, 2, 3, 4]);
    const message = bytesToHex(new Uint8Array([...new TextEncoder().encode(PREFIX), ...payload]));
    const hexSig = "ab".repeat(4627);
    const b64Sig = btoa(String.fromCharCode(...new Uint8Array(4627).fill(7)));
    const signArbitrary = vi.fn()
      .mockResolvedValueOnce({ pq: { signature: hexSig } })
      .mockResolvedValueOnce({ pq: { signature: `0x${hexSig}` } })
      .mockResolvedValueOnce({ pq: { signature: b64Sig } })
      .mockResolvedValueOnce({});
    const enable = vi.fn().mockResolvedValue(undefined);
    const signer = qorexSigner({ signArbitrary, enable } as never, "qor1x");
    const req = { bountyId: 1n, identityHash: `0x${"11".repeat(32)}` as const, claimRound: 1n, message };
    expect(await signer.sign(req)).toBe(`0x${hexSig}`);
    expect(await signer.sign(req)).toBe(`0x${hexSig}`);
    expect(await signer.sign(req)).toBe(`0x${"07".repeat(4627)}`);
    await expect(signer.sign(req)).rejects.toThrow(/no PQ signature/);
    expect(enable).toHaveBeenCalledWith("qorechain-diana");
    const [chain, who, data] = signArbitrary.mock.calls[0]!;
    expect([chain, who]).toEqual(["qorechain-diana", "qor1x"]);
    expect(Array.from(data as Uint8Array)).toEqual([1, 2, 3, 4]);
  });

  it("stops before any QoreX prompt when QoreX is on mainnet", async () => {
    (window as unknown as { qorex?: unknown }).qorex = { evm: { request: vi.fn().mockResolvedValue("0x2649") } };
    const signArbitrary = vi.fn();
    const enable = vi.fn();
    const signer = qorexSigner({ signArbitrary, enable } as never, "qor1x");
    const message = bytesToHex(new TextEncoder().encode("qorechain-msg-v1|qorechain-diana|x"));
    const req = { bountyId: 1n, identityHash: `0x${"11".repeat(32)}` as const, claimRound: 1n, message };
    await expect(signer.sign(req)).rejects.toThrow(/QoreX is on mainnet/);
    expect(enable).not.toHaveBeenCalled();
    expect(signArbitrary).not.toHaveBeenCalled();
    delete (window as unknown as { qorex?: unknown }).qorex;
  });

  it("refuses a message without the exact prefix before calling QoreX", async () => {
    const signArbitrary = vi.fn();
    const enable = vi.fn();
    const signer = qorexSigner({ signArbitrary, enable } as never, "qor1x");
    const req = { bountyId: 1n, identityHash: `0x${"11".repeat(32)}` as const, claimRound: 1n };
    await expect(signer.sign({ ...req, message: "0x1234" })).rejects.toThrow(/Refusing to sign/);
    const wrong = bytesToHex(new TextEncoder().encode("qorechain-msg-v1|other-chain|x"));
    await expect(signer.sign({ ...req, message: wrong })).rejects.toThrow(/Refusing to sign/);
    expect(signArbitrary).not.toHaveBeenCalled();
    expect(enable).not.toHaveBeenCalled();
  });

  it("decodePqSignature rejects wrong lengths and junk", () => {
    expect(() => decodePqSignature("abcd")).toThrow(/unexpected format/);
    expect(() => decodePqSignature("ab".repeat(4626))).toThrow(/unexpected format/);
    expect(() => decodePqSignature("not a signature!")).toThrow(/unexpected format/);
    expect(decodePqSignature(`0x${"cd".repeat(4627)}`)).toBe(`0x${"cd".repeat(4627)}`);
  });

  it("blocks when the QoreX account and the wallet are different accounts", () => {
    const qor1 = evmToQor(CLAIMANT);
    expect(accountMismatchMessage(qor1, CLAIMANT)).toBeNull();
    expect(accountMismatchMessage(qor1, CLAIMANT.toLowerCase())).toBeNull();
    expect(accountMismatchMessage(qor1, FUNDER)).toMatch(/different accounts.*Switch MetaMask to 0x/);
    expect(accountMismatchMessage(null, FUNDER)).toBeNull();
  });

  it("pickSigner uses QoreX only when it can sign arbitrary messages for an account", () => {
    const base = { installed: true, eip1193: null, native: { signArbitrary: vi.fn() }, accounts: [],
      evmCanSend: false } as unknown as QorexState;
    expect(pickSigner({ ...base, canSignArbitrary: false, qorAddress: "qor1x" }).id).toBe("local");
    expect(pickSigner({ ...base, canSignArbitrary: true, qorAddress: null }).id).toBe("local");
    expect(pickSigner({ ...base, canSignArbitrary: true, qorAddress: "qor1x" }).id).toBe("qorex");
  });
});

describe("useQorex", () => {
  beforeEach(() => {
    Object.assign(qx, { installed: false, native: null, accounts: [], caps: new Set(), eip1193: null });
    localStorage.clear();
    resetQorexProbe();
  });

  it("stays idle when QoreX is not installed", async () => {
    const { result } = renderHook(() => useQorex());
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.installed).toBe(false);
    expect(result.current.canSignArbitrary).toBe(false);
  });

  it("reads capabilities on load but never touches the account until the user links QoreX", async () => {
    const listAccounts = vi.fn(); const enable = vi.fn();
    qx.installed = true;
    qx.caps = new Set(["listAccounts", "signArbitrary"]);
    qx.native = { listAccounts, enable };
    const { result } = renderHook(() => useQorex());
    await waitFor(() => expect(result.current.installed).toBe(true));
    expect(result.current).toMatchObject({ qorAddress: null, canSignArbitrary: true, evmCanSend: false });
    expect(listAccounts).not.toHaveBeenCalled();
    expect(enable).not.toHaveBeenCalled();
  });

  it("reads the remembered account silently (read-only, no enable)", async () => {
    localStorage.setItem("pm-qorex-linked", "1");
    const enable = vi.fn();
    qx.installed = true;
    qx.caps = new Set(["listAccounts", "signArbitrary"]);
    qx.native = { enable, listAccounts: async () => ({ accounts: [{ address: "qor1a" }, { address: "qor1b" }], activeIndex: 1 }) };
    const { result } = renderHook(() => useQorex());
    await waitFor(() => expect(result.current.qorAddress).toBe("qor1b"));
    expect(enable).not.toHaveBeenCalled();
  });

  it("forgets the link when the silent read fails", async () => {
    localStorage.setItem("pm-qorex-linked", "1");
    qx.installed = true;
    qx.caps = new Set(["listAccounts", "evmTransactions"]);
    qx.native = { listAccounts: async () => { throw new Error("not connected"); } };
    const { result } = renderHook(() => useQorex());
    await waitFor(() => expect(result.current.installed).toBe(true));
    await waitFor(() => expect(localStorage.getItem("pm-qorex-linked")).toBeNull());
    expect(result.current).toMatchObject({ qorAddress: null, evmCanSend: true });
  });

  it("connectAccount is the interactive path: enable, then list, then remember", async () => {
    const enable = vi.fn().mockResolvedValue(undefined);
    qx.installed = true;
    qx.caps = new Set(["listAccounts"]);
    qx.native = { enable, listAccounts: async () => ({ accounts: [{ address: "qor1z" }], activeIndex: 0 }) };
    const { result } = renderHook(() => useQorex());
    await waitFor(() => expect(result.current.installed).toBe(true));
    await act(async () => { await result.current.connectAccount(); });
    expect(enable).toHaveBeenCalledWith("qorechain-diana");
    expect(result.current.qorAddress).toBe("qor1z");
    expect(localStorage.getItem("pm-qorex-linked")).toBe("1");
  });

  it("a rejected connectAccount leaves nothing remembered", async () => {
    localStorage.setItem("pm-qorex-linked", "1");
    qx.installed = true;
    qx.caps = new Set(["listAccounts"]);
    qx.native = { enable: async () => { throw Object.assign(new Error("User rejected"), { code: 4001 }); }, listAccounts: async () => { throw new Error("x"); } };
    const { result } = renderHook(() => useQorex());
    await waitFor(() => expect(result.current.installed).toBe(true));
    await act(async () => { await expect(result.current.connectAccount()).rejects.toThrow(/rejected/); });
    expect(localStorage.getItem("pm-qorex-linked")).toBeNull();
  });
});
