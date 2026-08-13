"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { OutboxEntry, ResearcherProfile } from "@/lib/types";

const fieldClass =
  "mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-500 focus:border-orange-700 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-400 dark:focus:border-orange-400";

function DraftSkeleton() {
  return (
    <div className="animate-pulse space-y-5">
      <div>
        <div className="h-3 w-8 rounded bg-zinc-200 dark:bg-zinc-800" />
        <div className="mt-2 h-9 w-full rounded-lg bg-zinc-200 dark:bg-zinc-800" />
      </div>
      <div>
        <div className="h-3 w-14 rounded bg-zinc-200 dark:bg-zinc-800" />
        <div className="mt-2 h-9 w-full rounded-lg bg-zinc-200 dark:bg-zinc-800" />
      </div>
      <div>
        <div className="h-3 w-10 rounded bg-zinc-200 dark:bg-zinc-800" />
        <div className="mt-2 h-72 w-full rounded-lg bg-zinc-200 dark:bg-zinc-800" />
      </div>
    </div>
  );
}

function ComposeInner() {
  const params = useSearchParams();
  const researcherId = params.get("researcher") ?? "";

  const [researcher, setResearcher] = useState<ResearcherProfile | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [to, setTo] = useState("");
  const [generator, setGenerator] = useState("");
  const [resume, setResume] = useState<{ fileName: string; size: number } | null>(null);
  const [attachResume, setAttachResume] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadingDraft, setLoadingDraft] = useState(true);
  const [error, setError] = useState("");
  const [sent, setSent] = useState<OutboxEntry | null>(null);

  const generate = useCallback(async () => {
    if (!researcherId) return;
    setBusy(true);
    setLoadingDraft(true);
    setError("");
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ researcherId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Draft generation failed");
      setResearcher(data.researcher);
      setSubject(data.draft.subject);
      setBody(data.draft.body);
      setGenerator(data.draft.generator);
      setTo(data.researcher.email ?? "");
      setResume(data.resume ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setLoadingDraft(false);
    }
  }, [researcherId]);

  useEffect(() => {
    const t = setTimeout(generate, 0);
    return () => clearTimeout(t);
  }, [generate]);

  async function send() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ researcherId, subject, body, to, attachResume }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Send failed");
      setSent(data.entry);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!researcherId) {
    return (
      <p className="text-zinc-600 dark:text-zinc-400">
        No researcher selected. Pick one from the{" "}
        <Link href="/researchers" className="text-orange-700 hover:underline dark:text-orange-400">
          directory
        </Link>
        .
      </p>
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[320px_1fr]">
      <aside>
        <h1 className="text-2xl font-semibold tracking-tight">Compose</h1>
        {researcher && (
          <div className="mt-4 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <h3 className="font-semibold">{researcher.name}</h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">{researcher.title}</p>
            <p className="mt-1 text-xs text-zinc-500">
              {researcher.department}, {researcher.school}
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {researcher.researchAreas.map((a) => (
                <span
                  key={a}
                  className="rounded-lg border border-zinc-200 px-2 py-0.5 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"
                >
                  {a}
                </span>
              ))}
            </div>
            {researcher.bio && (
              <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{researcher.bio}</p>
            )}
            <a
              href={researcher.website ?? researcher.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-block text-xs text-orange-700 hover:underline dark:text-orange-400"
            >
              Profile source
            </a>
          </div>
        )}
        {generator && !sent && (
          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
            Draft generated by {generator === "nim" ? "NVIDIA NIM" : "the built-in template engine"}. Edit freely
            before sending.
          </p>
        )}
      </aside>

      <section className="rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        {sent ? (
          <div className="py-12 text-center">
            <h2 className="text-xl font-semibold">{sent.status === "sent" ? "Email sent" : "Saved to outbox"}</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-zinc-600 dark:text-zinc-400">
              To {sent.to} via {sent.method}. {sent.detail}
            </p>
            {sent.attachmentName && (
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                Attached: <span className="font-mono">{sent.attachmentName}</span>
              </p>
            )}
            <div className="mt-6 flex justify-center gap-5 text-sm font-medium">
              <Link href="/outbox" className="text-orange-700 hover:underline dark:text-orange-400">
                View outbox
              </Link>
              <Link href="/researchers" className="text-orange-700 hover:underline dark:text-orange-400">
                Email another researcher
              </Link>
            </div>
          </div>
        ) : loadingDraft ? (
          <DraftSkeleton />
        ) : (
          <>
            <label className="block text-sm">
              <span className="font-medium">To</span>
              <input
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder={researcher?.email ?? "researcher@university.edu (no published email; check their site)"}
                className={fieldClass}
              />
            </label>
            <label className="mt-4 block text-sm">
              <span className="font-medium">Subject</span>
              <input value={subject} onChange={(e) => setSubject(e.target.value)} className={fieldClass} />
            </label>
            <label className="mt-4 block text-sm">
              <span className="font-medium">Body</span>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={16}
                className={`${fieldClass} leading-relaxed`}
              />
            </label>
            {resume ? (
              <label className="mt-4 flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
                <input
                  type="checkbox"
                  checked={attachResume}
                  onChange={(e) => setAttachResume(e.target.checked)}
                  className="accent-orange-700"
                />
                Attach{" "}
                <span className="font-mono text-xs text-zinc-700 dark:text-zinc-300">{resume.fileName}</span>
                <span className="text-xs text-zinc-400">({Math.round(resume.size / 1024)} KB)</span>
              </label>
            ) : (
              <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
                Upload a resume file on{" "}
                <Link href="/onboarding" className="text-orange-700 hover:underline dark:text-orange-400">
                  onboarding
                </Link>{" "}
                to attach it to your emails.
              </p>
            )}
            {error && <p className="mt-3 text-sm text-red-700 dark:text-red-400">{error}</p>}
            <div className="mt-5 flex gap-3">
              <button
                onClick={send}
                disabled={busy || !subject || !body}
                className="rounded-lg bg-orange-700 px-5 py-2 font-medium text-white transition-transform hover:bg-orange-800 active:scale-[0.98] disabled:opacity-50"
              >
                {busy ? "Working" : "Send email"}
              </button>
              <button
                onClick={generate}
                disabled={busy}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:border-orange-700 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-orange-400"
              >
                Regenerate draft
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

export default function ComposePage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <Suspense fallback={<DraftSkeleton />}>
        <ComposeInner />
      </Suspense>
    </div>
  );
}
