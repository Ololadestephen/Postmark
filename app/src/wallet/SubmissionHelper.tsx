import { useState } from "react";
import { submissionLine } from "../formats/lines";

const URL_OK = /^https:\/\/\S+$/;

/** Claimant helper on a testing/url bounty: build the postmark-submission line. */
export function SubmissionHelper() {
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const trimmed = url.trim();
  const ok = URL_OK.test(trimmed);
  const line = ok ? submissionLine(trimmed) : "";

  const copy = () => {
    if (!ok) return;
    void navigator.clipboard?.writeText(line);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="mt-4 rounded-lg border border-ink/10 bg-white/60 p-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-gray">build your submission line</p>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-stretch">
        <input value={url} onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…" aria-label="Submission URL"
          className="w-full grow rounded-lg border border-ink/15 bg-white px-3 py-2 font-mono text-sm text-ink placeholder:text-gray focus:outline-none focus:ring-2 focus:ring-deep" />
        <button type="button" onClick={copy} disabled={!ok}
          className="shrink-0 rounded-lg bg-deep px-5 py-2 text-sm font-medium text-paper hover:brightness-110 disabled:opacity-40">
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {trimmed && !ok && <p role="alert" className="mt-2 text-sm text-orange">Must be an https:// URL with no spaces.</p>}
      {ok && <code className="mt-2 block break-all rounded-lg border border-ink/10 bg-paper p-2 font-mono text-xs text-ink">{line}</code>}
    </div>
  );
}
