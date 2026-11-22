import { Link } from "react-router";
import { PageBody, PageHeader } from "../components/Page";
import { JOIN_VERIFIER_PATH } from "../data/verifiers";

export default function Signer() {
  return (
    <div>
    <PageHeader>
      <div>
        <h1 className="font-sans text-4xl font-semibold tracking-tight text-ink">Signing your claims</h1>
        <p className="mt-2 text-sm text-charcoal">Post-quantum signatures, made in QoreX.</p>
      </div>
    </PageHeader>
    <PageBody className="max-w-6xl">
    <div className="max-w-3xl">
      <p className="mt-6 leading-relaxed text-charcoal">
        Claims and verdicts need an ML-DSA-87 signature. In the browser, <strong>QoreX</strong> makes it:
        click <em>Sign with QoreX</em>, approve the request, and the app checks the signature against your
        registered key before anything is sent. Your post-quantum secret never leaves QoreX.
      </p>
      <ul className="mt-4 list-inside list-disc space-y-2 text-sm text-gray">
        <li>Your EVM wallet (for example MetaMask) and QoreX must use the <strong>same account</strong> today — QoreX can sign, but it cannot send EVM transactions yet.</li>
        <li>New here? <Link to="/start" className="text-deep underline underline-offset-4">Get started</Link>.</li>
        <li>Want to review work for others? <Link className="text-deep underline underline-offset-4" to={JOIN_VERIFIER_PATH}>Become a verifier</Link>.</li>
      </ul>

      <details className="mt-8 rounded-xl border border-ink/10 bg-white p-5">
        <summary className="cursor-pointer font-medium text-charcoal">Advanced: use the local signer</summary>
        <p className="mt-4 leading-relaxed text-charcoal">
          For developers: a small local process holds the key, this app asks it to sign, and it signs only after
          you confirm the decoded request in the terminal.
        </p>
      <h2 className="mt-8 font-mono text-[10px] uppercase tracking-[0.18em] text-deep">run it</h2>
      <div className="mt-3 space-y-3 text-sm text-gray">
        <p>From the repo root, with a QRC1 recovery-code profile:</p>
        <pre className="overflow-x-auto rounded-lg border border-ink/10 bg-paper p-4 font-mono text-xs text-ink">
{`npm run signer -- serve --env ~/.config/postmark/<profile> \\
  --origin http://localhost:5173`}
        </pre>
        <p>…or with a mnemonic profile (<code className="text-ink">MNEMONIC=</code>, optional <code className="text-ink">HD_INDEX=</code>):</p>
        <pre className="overflow-x-auto rounded-lg border border-ink/10 bg-paper p-4 font-mono text-xs text-ink">
{`npm run signer -- serve --env ~/.config/postmark/<profile> \\
  --deployment diana --port 47321`}
        </pre>
        <p>The terminal prints an 8-character pairing code — paste it into the app once per tab.
          It prints a decoded summary of every request and asks <span className="font-mono">y/N</span> before signing.</p>
      </div>

      <h2 className="mt-8 font-mono text-[10px] uppercase tracking-[0.18em] text-deep">security model</h2>
      <ul className="mt-3 list-inside list-disc space-y-2 text-sm text-gray">
        <li>Binds <span className="font-mono">127.0.0.1</span> only — nothing on the network can reach it.</li>
        <li>Serves exactly one browser origin; every other origin, including preflights, is refused.</li>
        <li>Every request needs the pairing code; it lives in sessionStorage only.</li>
        <li>It rebuilds the sign bytes itself from the chain (<span className="font-mono">claimMessage</span>/<span className="font-mono">verdictMessage</span> on the escrow) and refuses any mismatch — the app's bytes are never trusted.</li>
        <li>It refuses anything that does not start with <span className="font-mono">qorechain-msg-v1|qorechain-diana|</span>.</li>
        <li>It refuses a claim whose claimant is not its own account, and it refuses to start unless the derived key equals the account's live registered key.</li>
        <li>Profile files must be mode <span className="font-mono">600</span>; the ECDSA key is never read.</li>
      </ul>

      <h2 className="mt-8 font-mono text-[10px] uppercase tracking-[0.18em] text-deep">troubleshooting</h2>
      <ul className="mt-3 list-inside list-disc space-y-2 text-sm text-gray">
        <li><span className="text-ink">"not reachable"</span> — start the signer; check the port (<span className="font-mono">--port</span>) matches 47321.</li>
        <li><span className="text-ink">"origin refused"</span> — pass <span className="font-mono">--origin</span> with exactly the URL you browse (http vs https, port included).</li>
        <li><span className="text-ink">"pairing code rejected"</span> — a new <span className="font-mono">serve</span> run prints a new code; re-paste it.</li>
        <li><span className="text-ink">"key does NOT match"</span> — the profile's recovery code derives a different key than the one registered for that account; use the right profile.</li>
        <li><span className="text-ink">"no live key"</span> — register first: <span className="font-mono">npm run window -- --env &lt;profile&gt; register</span>.</li>
        <li><span className="text-ink">port busy</span> — pick another port and run the app URL pairing against it, or kill the old signer.</li>
      </ul>
      </details>
      <p className="mt-8 text-xs text-gray">Signatures are ML-DSA-87 over diana testnet messages — test QOR, no monetary value.</p>
    </div>
    </PageBody>
    </div>
  );
}
