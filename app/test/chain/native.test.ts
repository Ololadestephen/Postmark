import { describe, it, expect, vi } from "vitest";
import { decodeFunctionData, bytesToHex } from "viem";
import { qorechainRegistry } from "@qorechain/sdk";
import { TxRaw, TxBody, AuthInfo } from "cosmjs-types/cosmos/tx/v1beta1/tx";
import { postmarkEscrowAbi } from "../../src/chain/abi";
import { ESCROW_ADDRESS } from "../../src/chain/config";
import {
  CROSS_VM_TYPE_URL, crossVmMessage, escrowPayload, explainNativeCode, explainNativeFailure,
  NATIVE_GAS, nativeGasLimit, nativeMaxFeeQor, NativeSimulationError, simulateNativeGas,
  simulationTxBytes, type NativeCall,
} from "../../src/chain/native";

const SENDER = "qor1g78j5z9gr0nuafpt6d9adyq9j0a9d39kcf9w77";
const SIG = `0x${"ab".repeat(4627)}` as const;
const HASH = `0x${"11".repeat(32)}` as const;

type Decoded = { sender: string; sourceVm: string; targetVm: string; targetContract: string; payload: Uint8Array; funds: unknown[]; async: boolean };
const decode = (value: Uint8Array) => {
  const t = qorechainRegistry().lookupType(CROSS_VM_TYPE_URL) as unknown as { decode: (b: Uint8Array) => Decoded };
  return t.decode(value);
};

describe("escrow payloads", () => {
  it.each<[NativeCall, string]>([
    [{ functionName: "claim", args: [7n, HASH, SIG] }, "0x8127bcf2"],
    [{ functionName: "finalize", args: [7n] }, "0x05261aea"],
    [{ functionName: "withdraw", args: [] }, "0x3ccfd60b"],
  ])("%o encodes with selector %s", (call, selector) => {
    const hex = bytesToHex(escrowPayload(call));
    expect(hex.slice(0, 10)).toBe(selector);
    const d = decodeFunctionData({ abi: postmarkEscrowAbi, data: hex });
    expect(d.functionName).toBe(call.functionName);
    expect(d.args ?? []).toEqual(call.args);
  });
});

describe("MsgCrossVMCall encoding", () => {
  it("wraps the claim calldata for the escrow with no funds", async () => {
    const call: NativeCall = { functionName: "claim", args: [3n, HASH, SIG] };
    const msg = await crossVmMessage(SENDER, call);
    expect(msg.typeUrl).toBe("/qorechain.crossvm.v1.MsgCrossVMCall");
    const m = decode(msg.value);
    expect(m.sender).toBe(SENDER);
    expect(m.sourceVm).toBe("cosmwasm");
    expect(m.targetVm).toBe("evm");
    expect(m.targetContract).toBe(ESCROW_ADDRESS.toLowerCase());
    expect(m.funds).toEqual([]);
    expect(m.async).toBe(false);
    expect(bytesToHex(m.payload)).toBe(bytesToHex(escrowPayload(call)));
  });

  it("encodes finalize and withdraw the same way", async () => {
    for (const call of [{ functionName: "finalize", args: [9n] }, { functionName: "withdraw", args: [] }] as NativeCall[]) {
      const m = decode((await crossVmMessage(SENDER, call, "0xAbCdEf0000000000000000000000000000000001")).value);
      expect(m.targetContract).toBe("0xabcdef0000000000000000000000000000000001");
      expect(bytesToHex(m.payload)).toBe(bytesToHex(escrowPayload(call)));
    }
  });

  it("builds a simulation tx with the message, the account key and sequence", async () => {
    const msg = await crossVmMessage(SENDER, { functionName: "withdraw", args: [] });
    const pubKey = new Uint8Array(33).fill(2);
    const raw = TxRaw.decode(simulationTxBytes(msg, { pubKeyType: "/cosmos.evm.crypto.v1.ethsecp256k1.PubKey", pubKey, sequence: 77n }));
    const body = TxBody.decode(raw.bodyBytes);
    expect(body.messages[0]!.typeUrl).toBe(CROSS_VM_TYPE_URL);
    expect(bytesToHex(body.messages[0]!.value)).toBe(bytesToHex(msg.value));
    const auth = AuthInfo.decode(raw.authInfoBytes);
    expect(auth.signerInfos[0]!.publicKey!.typeUrl).toBe("/cosmos.evm.crypto.v1.ethsecp256k1.PubKey");
    expect(bytesToHex(auth.signerInfos[0]!.publicKey!.value)).toBe(bytesToHex(Uint8Array.from([10, 33, ...pubKey])));
    expect(auth.signerInfos[0]!.sequence).toBe(77n);
    expect(auth.fee!.gasLimit).toBe(5_000_000n);
    expect(raw.signatures).toHaveLength(1);
  });
});

describe("gas and fee", () => {
  it("shows about 0.1 QOR for withdraw", () => {
    expect(NATIVE_GAS.withdraw).toBe(1_000_000);
    expect(nativeMaxFeeQor(NATIVE_GAS.withdraw)).toBeCloseTo(0.1);
  });
  it("pads a simulation for the hybrid layer and cross-VM multiplier, inside QoreX's clamp", () => {
    expect(nativeGasLimit(225_942)).toBe(Math.ceil((225_942 + 60_000) * 1.3));
    expect(nativeGasLimit(0)).toBe(100_000);
    expect(nativeGasLimit(10_000_000)).toBe(5_000_000);
  });
});

const json = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response;

describe("simulateNativeGas", () => {
  const account = json({ account: { pub_key: { "@type": "/cosmos.evm.crypto.v1.ethsecp256k1.PubKey", key: "A17B/5Y/qrbq744iLhDzzM+W0mOF2SWjQ2BadbyyizsZ" }, sequence: "77" } });
  const msg = { typeUrl: CROSS_VM_TYPE_URL, value: new Uint8Array([1, 2]) };

  it("returns the simulated gas", async () => {
    const f = vi.fn().mockResolvedValueOnce(account).mockResolvedValueOnce(json({ gas_info: { gas_used: "365717" } }));
    expect(await simulateNativeGas(SENDER, msg, f)).toBe(365_717);
    expect(f.mock.calls[1]![0]).toMatch(/\/cosmos\/tx\/v1beta1\/simulate$/);
  });
  it("is null for an account with no public key yet", async () => {
    const f = vi.fn().mockResolvedValueOnce(json({ account: { sequence: "0" } }));
    expect(await simulateNativeGas(SENDER, msg, f)).toBeNull();
  });
  it("throws when the escrow would revert", async () => {
    const f = vi.fn().mockResolvedValueOnce(account)
      .mockResolvedValueOnce(json({ code: 2, message: "failed to execute message; message index: 0: execution reverted: EVM contract execution failed" }));
    await expect(simulateNativeGas(SENDER, msg, f)).rejects.toBeInstanceOf(NativeSimulationError);
  });
});

describe("native failures", () => {
  it("names a QoreX rejection", () => {
    expect(explainNativeFailure(new Error("QoreX: signature rejected"), 1_000_000))
      .toEqual({ kind: "rejected", text: "You cancelled the request in QoreX. Nothing was sent." });
  });
  it("names the wrong network with the switch steps", () => {
    const f = explainNativeFailure(new Error("chain id qorechain-diana does not match the active network qorechain-vladi"), 1);
    expect(f.kind).toBe("network");
    expect(f.text).toMatch(/Switch QoreX to testnet/);
  });
  it("names out of gas, thrown or as code 11", () => {
    expect(explainNativeFailure(new Error("out of gas in location: WritePerByte"), 650_000))
      .toMatchObject({ kind: "gas", text: expect.stringMatching(/ran out of gas at the 650,000 limit/) });
    expect(explainNativeCode(11, 650_000)).toMatch(/ran out of gas/);
    expect(explainNativeCode(5, 650_000)).toMatch(/code 5/);
  });
});
