"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { OutboxEntry, Publication, ResearcherProfile } from "@/lib/types";
import { Button, Card, Inset } from "@/components/ui";

const inputClass =
  "h-10 w-full rounded-lg border border-[#e5e5e5] bg-white px-3 text-sm text-black placeholder:text-[#777169] focus:border-black focus:outline-none";

function DraftSkeleton() {
  return (
    <div className="animate-pulse space-y-5">
      <div className="h-10 rounded-lg bg-[#f5f3f1]" />
      <div className="h-10 rounded-lg bg-[#f5f3f1]" />
      <div className="h-80 rounded-lg bg-[#f5f3f1]" />
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
  const [cited, setCited] = useState<Publication | null>(null);
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
      setCited(data.citedPublication ?? null);
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
      <p className="text-sm text-[#777169]">
        No researcher selected. Pick one from your{" "}
        <Link href="/dashboard" className="text-black underline underline-offset-2">
          dashboard
        </Link>
        .
      </p>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
      <aside>
        <h1 className="text-2xl tracking-tight">Compose</h1>
        {researcher && (
          <Card className="mt-4 p-5">
            <p className="text-sm font-medium">{researcher.name}</p>
            <p className="mt-0.5 text-[13px] text-[#777169]">{researcher.title}</p>
            <p className="mt-1 text-[11px] text-[#777169]">
              {researcher.department}, {researcher.school}
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {researcher.researchAreas.map((a) => (
                <span key={a} className="rounded-full border border-[#e5e5e5] px-2 py-0.5 text-[11px] text-[#777169]">
                  {a}
                </span>
              ))}
            </div>
            {researcher.bio && <p className="mt-3 text-[13px] leading-5 text-[#777169]">{researcher.bio}</p>}
            <Link
              href={`/researchers/${encodeURIComponent(researcher.id)}`}
              className="mt-3 inline-block text-[11px] text-black underline underline-offset-2"
            >
              Read their research
            </Link>
          </Card>
        )}

        {cited && (
          <Card className="mt-3 p-5">
            <p className="eyebrow">Paper cited in this draft</p>
            <p className="mt-2 text-[13px] leading-5">{cited.title}</p>
            <p className="mt-1 text-[11px] text-[#777169]">
              {[cited.venue, cited.year].filter(Boolean).join(" · ")}
            </p>
            <div className="mt-3 flex gap-2">
              {cited.pdfUrl && (
                <a
                  href={cited.pdfUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-7 items-center rounded-full border border-[#ff4704]/30 bg-[#ff4704]/8 px-3 text-[12px] text-[#ff4704]"
                >
                  Read the PDF
                </a>
              )}
              {cited.url && (
                <a
                  href={cited.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-7 items-center rounded-full border border-[#e5e5e5] px-3 text-[12px] text-[#777169] hover:border-black hover:text-black"
                >
                  Source
                </a>
              )}
            </div>
            <p className="mt-3 text-[11px] leading-4 text-[#777169]">
              Skim it before you send. The draft names it, so a reply will assume you know it.
            </p>
          </Card>
        )}
        {generator && !sent && (
          <p className="mt-3 text-[11px] text-[#777169]">
            Drafted by {generator === "nim" ? "your NIM model" : "the built-in template engine"}. Edit before sending.
          </p>
        )}
      </aside>

      <Card className="p-6">
        {sent ? (
          <div className="py-10 text-center">
            <h2 className="text-[17px] font-medium">{sent.status === "sent" ? "Email sent" : "Saved to outbox"}</h2>
            <p className="mx-auto mt-2 max-w-md text-[13px] text-[#777169]">
              To {sent.to} via {sent.method}. {sent.detail}
            </p>
            {sent.attachmentName && (
              <p className="mt-1 text-[11px] text-[#777169]">
                Attached <span className="font-mono">{sent.attachmentName}</span>
              </p>
            )}
            <div className="mt-6 flex justify-center gap-2">
              <Link href="/dashboard" className="inline-flex">
                <Button type="button">Back to dashboard</Button>
              </Link>
              <Link href="/outbox" className="inline-flex">
                <Button type="button" variant="secondary">
                  View outbox
                </Button>
              </Link>
            </div>
          </div>
        ) : loadingDraft ? (
          <DraftSkeleton />
        ) : (
          <>
            <label className="block">
              <span className="eyebrow">To</span>
              <input
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder={researcher?.email ?? "no published email, enter one"}
                className={`${inputClass} mt-1.5`}
              />
            </label>
            <label className="mt-4 block">
              <span className="eyebrow">Subject</span>
              <input value={subject} onChange={(e) => setSubject(e.target.value)} className={`${inputClass} mt-1.5`} />
            </label>
            <label className="mt-4 block">
              <span className="eyebrow">Body</span>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={18}
                className="mt-1.5 w-full rounded-lg border border-[#e5e5e5] bg-white p-4 text-sm leading-6 text-black focus:border-black focus:outline-none"
              />
            </label>

            {resume ? (
              <Inset className="mt-4 flex items-center justify-between">
                <label className="flex items-center gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    checked={attachResume}
                    onChange={(e) => setAttachResume(e.target.checked)}
                    className="accent-black"
                  />
                  Attach <span className="font-mono text-[12px]">{resume.fileName}</span>
                </label>
                <span className="text-[11px] text-[#777169]">{Math.round(resume.size / 1024)} KB</span>
              </Inset>
            ) : (
              <p className="mt-4 text-[13px] text-[#777169]">
                Upload a resume file in{" "}
                <Link href="/onboarding" className="text-black underline underline-offset-2">
                  onboarding
                </Link>{" "}
                to attach it.
              </p>
            )}

            {error && <p className="mt-3 text-[13px] text-[#ff4704]">{error}</p>}
            <div className="mt-5 flex gap-2">
              <Button onClick={send} disabled={busy || !subject || !body}>
                {busy ? "Working" : "Send email"}
              </Button>
              <Button variant="secondary" onClick={generate} disabled={busy}>
                Regenerate
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

export default function ComposePage() {
  return (
    <div className="px-6 py-8">
      <Suspense fallback={<DraftSkeleton />}>
        <ComposeInner />
      </Suspense>
    </div>
  );
}
