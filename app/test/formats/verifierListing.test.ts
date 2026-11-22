import { describe, it, expect } from "vitest";
import { bytesToHex, hexToBytes, type Hex } from "viem";
import { mldsa87 } from "@qorechain/pqc";
import {
  checkListing, collectListings, formatListingComment, isGithubLogin, listingMessage, parseListingLine,
  type ListingDeps,
} from "../../src/formats/verifierListing";
import { ESCROW_ADDRESS } from "../../src/chain/config";

const pair = mldsa87.keygen(new Uint8Array(32).fill(9));
const KEY = bytesToHex(pair.publicKey) as Hex;
const ADDR = "0xA46B8DC7593eDEe0f31b6F7fD1362e855Ad50693";
const sign = (address: string, login: string, escrow = ESCROW_ADDRESS) =>
  bytesToHex(mldsa87.sign(pair.secretKey, hexToBytes(listingMessage(address, login, escrow)))) as Hex;
const comment = (id: number, author: string, body: string) => ({ id, user: { login: author }, body, created_at: "" });
const line = (address: string, login: string, sig: Hex) => `postmark-verifier v1 ${address} ${login} ${sig}`;
const deps = (over: Partial<ListingDeps> = {}): ListingDeps => ({
  liveKey: async () => KEY, verify: (k, m, s) => mldsa87.verify(k, m, s), curated: new Set(), ...over,
});

describe("listing format", () => {
  it("builds the exact message bytes", () => {
    const text = new TextDecoder().decode(hexToBytes(listingMessage(ADDR, "Octo-Cat")));
    expect(text).toBe(`qorechain-msg-v1|qorechain-diana|postmark-verifier-v1|${ESCROW_ADDRESS.toLowerCase()}|${ADDR.toLowerCase()}|octo-cat`);
  });
  it("round-trips through the comment and accepts the line anywhere", () => {
    const sig = sign(ADDR, "octocat");
    const body = formatListingComment(ADDR, "octocat", sig);
    expect(parseListingLine(body)).toEqual({ address: ADDR, login: "octocat", signature: sig });
    expect(parseListingLine(`hello\n\n${line(ADDR, "octocat", sig)}\nthanks`)?.login).toBe("octocat");
  });
  it("rejects malformed lines and takes only the first valid one", () => {
    const sig = sign(ADDR, "octocat");
    expect(parseListingLine("postmark-verifier v1 0x12 octocat 0x34")).toBeNull();
    expect(parseListingLine(line(ADDR, "-bad", sig))).toBeNull();
    expect(parseListingLine(line(ADDR, "ok", `0x${"ab".repeat(4626)}`))).toBeNull();
    expect(parseListingLine(`${line(ADDR, "first", sig)}\n${line(ADDR, "second", sig)}`)?.login).toBe("first");
  });
  it("validates GitHub usernames", () => {
    for (const ok of ["a", "octo-cat", "A1", "x".repeat(39)]) expect(isGithubLogin(ok)).toBe(true);
    for (const bad of ["", "-a", "a-", "a--b", "a_b", "x".repeat(40), "a b"]) expect(isGithubLogin(bad)).toBe(false);
  });
});

describe("listing verification", () => {
  const good = line(ADDR, "octocat", sign(ADDR, "octocat"));
  it("accepts a valid signed line from its author", async () => {
    expect(await checkListing(comment(1, "OctoCat", good), deps())).toMatchObject({ address: ADDR, login: "octocat", commentId: 1 });
  });
  it("drops another author's reposted line", async () => {
    expect(await checkListing(comment(1, "someone-else", good), deps())).toBe("login-mismatch");
  });
  it("drops a signature for another escrow, a tampered one, or a key that is not live", async () => {
    expect(await checkListing(comment(1, "octocat", line(ADDR, "octocat", sign(ADDR, "octocat", "0x" + "1".repeat(40)))), deps())).toBe("bad-signature");
    const sig = sign(ADDR, "octocat");
    const tampered = (sig.slice(0, 20) + (sig[20] === "a" ? "b" : "a") + sig.slice(21)) as Hex;
    expect(await checkListing(comment(1, "octocat", line(ADDR, "octocat", tampered)), deps())).toBe("bad-signature");
    expect(await checkListing(comment(1, "octocat", good), deps({ liveKey: async () => null }))).toBe("key-not-live");
  });
  it("skips curated addresses and malformed comments", async () => {
    expect(await checkListing(comment(1, "octocat", good), deps({ curated: new Set([ADDR.toLowerCase()]) }))).toBe("curated");
    expect(await checkListing(comment(1, "octocat", "just chatting"), deps())).toBe("malformed");
  });
  it("keeps one entry per address (latest wins) and considers only the newest 50", async () => {
    const other = "0x4EaBC36D47dE61ECF41DBcFCeFffa8dDA9b5b023";
    const cs = [
      comment(1, "old-name", line(ADDR, "old-name", sign(ADDR, "old-name"))),
      comment(2, "octocat", good),
      comment(3, "bot", line(other, "bot", sign(other, "bot"))),
    ];
    const out = await collectListings(cs, deps());
    expect(out.map((l) => [l.address, l.login]).sort()).toEqual([[ADDR, "octocat"], [other, "bot"]].sort());
    const many = Array.from({ length: 60 }, (_, i) => comment(i + 1, "x", "noise"));
    many.unshift(comment(0, "octocat", good));
    expect(await collectListings(many, deps())).toEqual([]);
  });
});
