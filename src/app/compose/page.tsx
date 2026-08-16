"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ContactLookup, FocusPaper, LabContact, OutboxEntry, ResearcherProfile } from "@/lib/types";
import { EmailRule } from "@/lib/preferences";
import { SavedDraft } from "@/lib/drafts";
import { Button, Card, Inset } from "@/components/ui";
import { DraftEditor } from "@/components/draft-editor";

const inputClass =
  "h-10 w-full rounded-lg border border-[#e5e5e5] bg-white px-3 text-sm text-black placeholder:text-[#777169] focus:border-black focus:outline-none";

/** Everything the saved copy holds, as one comparable string. Autosave fires
 *  on a change to any of it and skips when nothing has moved. The ticked
 *  contacts are sorted so re-ordering the same set is not read as an edit. */
function snapshotOf(
  subject: string,
  body: string,
  to: string,
  ccExtra: string,
  ccChecked: string[],
  attachResume: boolean
): string {
  return JSON.stringify({ subject, body, to, ccExtra, ccChecked: [...ccChecked].sort(), attachResume });
}

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
  const [focus, setFocus] = useState<FocusPaper | null>(null);
  const [paperUrl, setPaperUrl] = useState("");
  const [paperNotes, setPaperNotes] = useState("");
  const [overriding, setOverriding] = useState(false);
  const [attachResume, setAttachResume] = useState(true);
  const [contacts, setContacts] = useState<ContactLookup | null>(null);
  const [findingContacts, setFindingContacts] = useState(false);
  const [ccChecked, setCcChecked] = useState<Record<string, boolean>>({});
  const [ccExtra, setCcExtra] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingDraft, setLoadingDraft] = useState(true);
  const [error, setError] = useState("");
  const [sent, setSent] = useState<OutboxEntry | null>(null);
  const [rules, setRules] = useState<EmailRule[]>([]);
  // Whether AI edits are possible at all: the sender's own NIM key, or a
  // server-wide one. Without either, the prompt box says so rather than
  // failing on submit.
  const [aiAvailable, setAiAvailable] = useState(false);
  // The last state written to the server, so autosave can tell a real edit
  // from a re-render.
  const savedState = useRef("");
  // Set once a saved draft has supplied the copy list, so the contacts lookup
  // knows not to impose its defaults.
  const ccRestored = useRef(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");

  // The paper override is passed explicitly rather than read from state, so
  // typing in the notes box does not re-trigger the effect below.
  const generate = useCallback(
    async (override?: { paperUrl: string; paperNotes: string; regenerate?: boolean }) => {
    if (!researcherId) return;
    setBusy(true);
    setLoadingDraft(true);
    setError("");
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ researcherId, ...override }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Draft generation failed");
      setResearcher(data.researcher);
      setSubject(data.draft.subject);
      setBody(data.draft.body);
      setGenerator(data.draft.generator);
      setResume(data.resume ?? null);
      setFocus(data.focusPaper ?? null);
      if (Array.isArray(data.rules)) setRules(data.rules);

      const saved: SavedDraft | null = data.saved ?? null;
      setTo(saved ? saved.to : data.researcher.email ?? "");
      if (saved) {
        setAttachResume(saved.attachResume);
        setCcExtra(saved.ccExtra);
        setCcChecked(Object.fromEntries(saved.ccChecked.map((email) => [email, true])));
        // Who to copy was decided last time. The contacts lookup below must not
        // re-tick its own suggestions over the top, or unticking one would not
        // survive a reload.
        ccRestored.current = true;
        // Reopened exactly as it was left, so there is nothing to write back
        // until something actually changes.
        savedState.current = snapshotOf(
          saved.subject,
          saved.body,
          saved.to,
          saved.ccExtra,
          saved.ccChecked,
          saved.attachResume
        );
        setSaveState("saved");
      } else {
        // Freshly written: no stored copy yet, so let the autosave below make
        // one on its next pass.
        savedState.current = "";
        setSaveState("idle");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setLoadingDraft(false);
    }
  },
    [researcherId]
  );

  useEffect(() => {
    const t = setTimeout(() => generate(), 0);
    return () => clearTimeout(t);
  }, [generate]);

  // Whether the draft editor can call a model at all. Asked once on load, so
  // the prompt box can be honest about it before anyone types into it.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.settings) setAiAvailable(data.settings.nimSource !== "none");
      })
      .catch(() => {
        // Treated as unavailable, which is the safe reading.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Contacts are looked up separately: it reads the lab's own pages, which is
  // far slower than writing the draft and should not hold it up.
  useEffect(() => {
    if (!researcherId) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setFindingContacts(true);
      try {
        const res = await fetch(`/api/researchers/${encodeURIComponent(researcherId)}/contacts`);
        const data: { lookup?: ContactLookup } = await res.json();
        if (cancelled || !data.lookup) return;
        setContacts(data.lookup);
        // Assistants are pre-selected because reaching one is usually the
        // point. Lab members are not: copying a stranger's postdoc is a
        // judgement call the sender should make deliberately. A reopened draft
        // already carries that decision, so the defaults stay out of its way.
        if (!ccRestored.current) {
          setCcChecked(
            Object.fromEntries(data.lookup.contacts.filter((c) => c.kind === "admin").map((c) => [c.email, true]))
          );
        }
      } catch {
        // No suggestions is a fine outcome; the email sends without them.
      } finally {
        if (!cancelled) setFindingContacts(false);
      }
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [researcherId]);

  // Deduplicated: an address that is both a ticked suggestion and typed into
  // the box is one recipient, not two, and a duplicate in a Cc header is a
  // thing the professor can see.
  const ccList = [
    ...new Set([
      ...(contacts?.contacts ?? []).filter((c) => ccChecked[c.email]).map((c) => c.email),
      ...ccExtra.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean),
    ]),
  ];
  const ccCheckedList = Object.entries(ccChecked)
    .filter(([, on]) => on)
    .map(([email]) => email);

  // Autosave. The email survives leaving this page for the profile screen and
  // coming back, which is otherwise a silent way to lose a draft that took
  // several AI edits to get right. Debounced so typing does not write on every
  // keystroke, and skipped once the email has gone out, since the server drops
  // the saved copy at that point and re-saving would resurrect it.
  const snapshot = snapshotOf(subject, body, to, ccExtra, ccCheckedList, attachResume);
  useEffect(() => {
    if (loadingDraft || !researcherId || sent) return;
    if (!subject && !body) return;
    if (snapshot === savedState.current) return;

    setSaveState("saving");
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/draft", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ researcherId, subject, body, to, ccExtra, ccChecked: ccCheckedList, attachResume }),
        });
        if (!res.ok) throw new Error("save failed");
        savedState.current = snapshot;
        setSaveState("saved");
      } catch {
        // Losing one autosave is not worth an error banner over the draft. The
        // next keystroke tries again, and the indicator stops claiming "saved".
        setSaveState("idle");
      }
    }, 900);
    return () => clearTimeout(timer);
    // `snapshot` covers every field the save writes; listing them again would
    // only re-run this for a re-render that changed nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, loadingDraft, researcherId, sent]);

  async function send() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ researcherId, subject, body, to, cc: ccList, attachResume }),
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

        {/* The paragraph that carries the email. Whatever paper is in here is
            what the draft reacts to, so it can be swapped for one the sender
            has actually read. */}
        {!sent && (
          <Card className="mt-3 p-5">
            <p className="eyebrow">The paper this draft reacts to</p>
            {focus?.title ? (
              <>
                <p className="mt-2 text-[13px] leading-5">{focus.title}</p>
                <p className="mt-1 text-[11px] text-[#777169]">
                  {[focus.venue, focus.year].filter(Boolean).join(" · ")}
                </p>
                {focus.url && (
                  <a
                    href={focus.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-flex h-7 items-center rounded-full border border-[#ff4704]/30 bg-[#ff4704]/8 px-3 text-[12px] text-[#ff4704]"
                  >
                    Read it
                  </a>
                )}
                <p className="mt-3 text-[11px] leading-4 text-[#777169]">
                  Read it before you send. The draft reacts to it, so a reply will assume you know it.
                </p>
              </>
            ) : (
              <p className="mt-2 text-[13px] leading-5 text-[#777169]">
                {focus?.notes
                  ? "Using the paper and notes you gave below."
                  : "No paper matched confidently. Paste one you have read and the draft will work from it."}
              </p>
            )}

            <button
              type="button"
              onClick={() => setOverriding((v) => !v)}
              className="mt-3 text-[12px] text-black underline underline-offset-2"
            >
              {overriding ? "Hide" : "Use a different paper"}
            </button>

            {overriding && (
              <div className="mt-3 space-y-2">
                <input
                  value={paperUrl}
                  onChange={(e) => setPaperUrl(e.target.value)}
                  placeholder="https://link to the paper"
                  className={`${inputClass} font-mono text-[12px]`}
                />
                <textarea
                  value={paperNotes}
                  onChange={(e) => setPaperNotes(e.target.value)}
                  rows={4}
                  placeholder="A line or two on what you took from it, and what you would try next."
                  className="w-full rounded-lg border border-[#e5e5e5] bg-white p-3 text-[13px] leading-5 text-black placeholder:text-[#777169] focus:border-black focus:outline-none"
                />
                <Button
                  className="h-8 px-3 text-[12px]"
                  onClick={() => generate({ paperUrl, paperNotes })}
                  disabled={busy || (!paperUrl && !paperNotes)}
                >
                  {busy ? "Rewriting" : "Rewrite with this paper"}
                </Button>
                <p className="text-[11px] leading-4 text-[#777169]">
                  A link on its own works when it is one of their indexed papers. Otherwise your notes are what the
                  paragraph is built from.
                </p>
              </div>
            )}
          </Card>
        )}
        {/* Reaching a professor often works better through the person who runs
            their calendar, and the lab member on the project is frequently the
            one who replies. */}
        {!sent && (
          <Card className="mt-3 p-5">
            <p className="eyebrow">Who else to copy</p>

            {findingContacts && (
              <p className="mt-2 text-[13px] leading-5 text-[#777169]">Reading their lab and department pages.</p>
            )}

            {!findingContacts && !contacts?.contacts.length && (
              <p className="mt-2 text-[13px] leading-5 text-[#777169]">
                Nobody else published an address on their lab or department pages, so there is nobody to suggest. Add
                one below if you know it.
              </p>
            )}

            {contacts?.contacts.map((c: LabContact) => (
              <label key={c.email} className="mt-3 flex cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  checked={Boolean(ccChecked[c.email])}
                  onChange={(e) => setCcChecked((prev) => ({ ...prev, [c.email]: e.target.checked }))}
                  className="mt-1 accent-black"
                />
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5">
                    <span className="text-[13px]">{c.name ?? c.email}</span>
                    <span
                      className={`rounded-full px-1.5 py-px text-[10px] ${
                        c.kind === "admin" ? "bg-[#ff4704]/10 text-[#ff4704]" : "bg-[#f5f3f1] text-[#777169]"
                      }`}
                    >
                      {c.kind === "admin" ? "assistant" : "lab"}
                    </span>
                  </span>
                  {c.role && <span className="mt-0.5 block text-[11px] leading-4 text-[#777169]">{c.role}</span>}
                  <span className="mt-0.5 block font-mono text-[11px] break-all text-[#777169]">{c.email}</span>
                </span>
              </label>
            ))}

            <input
              value={ccExtra}
              onChange={(e) => setCcExtra(e.target.value)}
              placeholder="someone.else@lab.edu"
              className={`${inputClass} mt-4 font-mono text-[12px]`}
            />
            <p className="mt-2 text-[11px] leading-4 text-[#777169]">
              Only addresses published on their own pages are suggested, never guessed from a name.
            </p>
          </Card>
        )}

        {generator && !sent && (
          <p className="mt-3 text-[11px] leading-4 text-[#777169]">
            {generator === "saved"
              ? "Picked up where you left off. Your edits are saved as you make them, and Start over writes a new draft."
              : `Drafted by ${generator === "nim" ? "your NIM model" : "the built-in template engine"}. Edit before sending.`}
          </p>
        )}
      </aside>

      <Card className="p-6">
        {sent ? (
          <div className="py-10 text-center">
            <h2 className="text-[17px] font-medium">{sent.status === "sent" ? "Email sent" : "Saved to outbox"}</h2>
            <p className="mx-auto mt-2 max-w-md text-[13px] text-[#777169]">
              To {sent.to}
              {sent.cc?.length ? `, copying ${sent.cc.join(", ")}` : ""} via {sent.method}. {sent.detail}
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
            {/* Stated here rather than only in the sidebar: these are real
                people who will receive the email, and the sender should see
                them without looking for them. */}
            {ccList.length > 0 && (
              <p className="mt-2 text-[13px] text-[#777169]">
                Copying <span className="font-mono text-[12px] text-black">{ccList.join(", ")}</span>
              </p>
            )}

            <label className="mt-4 block">
              <span className="eyebrow">Subject</span>
              <input value={subject} onChange={(e) => setSubject(e.target.value)} className={`${inputClass} mt-1.5`} />
            </label>
            <div className="mt-4">
              <DraftEditor
                body={body}
                setBody={setBody}
                subject={subject}
                setSubject={setSubject}
                researcherId={researcherId}
                aiAvailable={aiAvailable}
                rules={rules}
                setRules={setRules}
                disabled={busy}
              />
            </div>

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
            <div className="mt-5 flex flex-wrap gap-2">
              <Button onClick={send} disabled={busy || !subject || !body}>
                {busy ? "Working" : "Send email"}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  // An explicit request for new text. The stored copy is
                  // dropped first so the generate call does not just hand back
                  // the draft being replaced.
                  savedState.current = "";
                  setSaveState("idle");
                  generate({ paperUrl, paperNotes, regenerate: true });
                }}
                disabled={busy}
              >
                Start over
              </Button>
              <span className="self-center text-[11px] text-[#777169]">
                {saveState === "saving" ? "Saving" : saveState === "saved" ? "Draft saved" : ""}
              </span>
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
