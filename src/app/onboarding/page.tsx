"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { UserProfile } from "@/lib/types";
import { Button, Card, Eyebrow, Inset, StepRail } from "@/components/ui";

// Onboarding collects exactly what the email needs, in the order the email
// uses it: who you are, the two experiences that open it, the linked work that
// fills the bullet list, and the interests that pick your matches.
//
// The upload returns a deterministic parse in a couple of seconds and the LLM
// pass lands afterwards, so nobody waits on a model to start editing.

const STEPS = ["Resume", "You", "Highlights", "Publications", "Interests"];

const inputClass =
  "h-10 w-full rounded-lg border border-[#e5e5e5] bg-white px-3 text-sm text-black placeholder:text-[#777169] focus:border-black focus:outline-none";
const areaClass =
  "w-full rounded-lg border border-[#e5e5e5] bg-white p-3 text-sm leading-6 text-black placeholder:text-[#777169] focus:border-black focus:outline-none";

type ListKey = "education" | "experience" | "projects" | "skills" | "publications" | "researchInterests" | "awards";
type TextKey = "name" | "email" | "standing" | "school" | "gradYear" | "degree" | "aiSummary";

const STANDINGS = ["undergraduate", "master's student", "PhD student", "postdoc"];

/** Matches how the draft writes it: "an undergraduate", "a PhD student". */
function withArticle(noun: string | undefined): string {
  const trimmed = noun?.trim();
  if (!trimmed) return "";
  return `${/^[aeiou]/i.test(trimmed) ? "an" : "a"} ${trimmed}`;
}

/** Sections compared side by side when a returning user uploads a new file. */
const MERGEABLE: { key: ListKey; label: string }[] = [
  { key: "education", label: "Education" },
  { key: "experience", label: "Experience" },
  { key: "projects", label: "Projects" },
  { key: "publications", label: "Publications" },
  { key: "awards", label: "Awards" },
  { key: "skills", label: "Skills" },
];

interface ResumeInfo {
  fileName: string;
  size: number;
  updatedAt: string;
}

// ── linked rows ─────────────────────────────────────────────────────────────
//
// Publications and awards are stored as plain strings so the draft can drop
// them into a bullet verbatim. The editor splits the trailing URL out so it
// gets its own field, and joins it back on the way out.

interface LinkedRow {
  text: string;
  url: string;
}

function parseRow(entry: string): LinkedRow {
  const match = entry.match(/(https?:\/\/\S+)\s*$/);
  if (!match) return { text: entry.trim(), url: "" };
  return { text: entry.slice(0, match.index).replace(/[\s:,-]+$/, "").trim(), url: match[1] };
}

function serializeRow(row: LinkedRow): string {
  const text = row.text.trim();
  const url = row.url.trim();
  if (!text && !url) return "";
  return [text, url].filter(Boolean).join(" ");
}

function LinkedRows({
  label,
  hint,
  entries,
  placeholder,
  onChange,
}: {
  label: string;
  hint: string;
  entries: string[];
  placeholder: string;
  onChange: (next: string[]) => void;
}) {
  const rows = entries.map(parseRow);
  const shown = rows.length ? rows : [{ text: "", url: "" }];

  const update = (index: number, patch: Partial<LinkedRow>) => {
    const next = shown.map((row, i) => (i === index ? { ...row, ...patch } : row));
    onChange(next.map(serializeRow).filter(Boolean));
  };

  return (
    <div>
      <span className="eyebrow">
        {label} <span className="font-mono normal-case">({entries.length})</span>
      </span>
      <p className="mt-1 text-[13px] leading-5 text-[#777169]">{hint}</p>
      <div className="mt-3 space-y-2">
        {shown.map((row, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[1fr_260px]">
            <input
              value={row.text}
              placeholder={placeholder}
              onChange={(e) => update(i, { text: e.target.value })}
              className={inputClass}
            />
            <div className="flex gap-2">
              <input
                value={row.url}
                placeholder="https://link to it"
                onChange={(e) => update(i, { url: e.target.value })}
                className={`${inputClass} font-mono text-[12px]`}
              />
              <button
                type="button"
                onClick={() => onChange(shown.filter((_, j) => j !== i).map(serializeRow).filter(Boolean))}
                className="h-10 shrink-0 rounded-lg border border-[#e5e5e5] px-3 text-[13px] text-[#777169] hover:border-black hover:text-black"
                aria-label={`Remove ${label} row ${i + 1}`}
              >
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => onChange([...entries, ""])}
        className="mt-2 text-[13px] text-black underline underline-offset-2"
      >
        Add another
      </button>
    </div>
  );
}

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [candidate, setCandidate] = useState<UserProfile | null>(null);
  const [storedResume, setStoredResume] = useState<ResumeInfo | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [pasted, setPasted] = useState("");
  const [mode, setMode] = useState<"upload" | "paste">("upload");
  const [busy, setBusy] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const [parser, setParser] = useState("");
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [returning, setReturning] = useState(false);

  // Fields the user has typed into. The background LLM pass fills in around
  // them rather than overwriting work they have already done.
  const touched = useRef(new Set<string>());

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      const [me, resume] = await Promise.all([
        fetch("/api/me").then((r) => r.json()).catch(() => null),
        fetch("/api/resume").then((r) => r.json()).catch(() => null),
      ]);
      if (cancelled) return;
      if (resume?.resume) setStoredResume(resume.resume);
      if (!me?.profile) return;
      // An existing profile means this is an edit, not first-run onboarding.
      setProfile(me.profile);
      setReturning(true);
      setStep(1);
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, []);

  const setText = (key: TextKey, value: string) => {
    touched.current.add(key);
    setProfile((p) => (p ? { ...p, [key]: value } : p));
  };

  const setList = (key: ListKey, value: string) => {
    touched.current.add(key);
    setProfile((p) => (p ? { ...p, [key]: value.split("\n").filter((l) => l.trim().length > 0) } : p));
  };

  const setEntries = (key: ListKey, entries: string[]) => {
    touched.current.add(key);
    setProfile((p) => (p ? { ...p, [key]: entries } : p));
  };

  /**
   * Run the LLM extraction after the fast parse has already been shown, then
   * fold it into every field the user has not touched.
   */
  async function enhance(rawText: string, isNew: boolean) {
    if (!rawText) return;
    setEnhancing(true);
    try {
      const res = await fetch("/api/onboard/enhance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: rawText }),
      });
      const data = await res.json();
      if (!res.ok || !data.enhanced) return;
      setParser("nim");
      const apply = (previous: UserProfile | null): UserProfile | null => {
        if (!previous) return previous;
        const merged: UserProfile = { ...previous };
        for (const [key, value] of Object.entries(data.parsed as Record<string, unknown>)) {
          if (touched.current.has(key)) continue;
          if (Array.isArray(value) ? value.length > 0 : typeof value === "string" && value.trim()) {
            (merged as unknown as Record<string, unknown>)[key] = value;
          }
        }
        return merged;
      };
      // A returning user is comparing against their saved profile, so the
      // improved parse belongs to the candidate, not to what they already have.
      if (isNew) setProfile(apply);
      else setCandidate(apply);
    } catch {
      // The deterministic parse already on screen is a complete profile.
    } finally {
      setEnhancing(false);
    }
  }

  async function parseResume() {
    setBusy(true);
    setError("");
    setWarning("");
    try {
      let res: Response;
      if (mode === "upload") {
        if (!file) throw new Error("Choose a PDF or text file first");
        const form = new FormData();
        form.set("resume", file);
        res = await fetch("/api/onboard", { method: "POST", body: form });
      } else {
        res = await fetch("/api/onboard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: pasted }),
        });
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not read that resume");

      setParser(data.parser ?? "");
      setWarning(data.resumeWarning ?? "");
      if (mode === "upload" && file) {
        setStoredResume({ fileName: file.name, size: file.size, updatedAt: new Date().toISOString() });
      }

      if (data.isNew) {
        touched.current.clear();
        setProfile(data.profile);
        setStep(1);
      } else {
        // Nothing is overwritten yet: the merge panel below shows what the new
        // file would change, section by section.
        setCandidate(data.candidate);
      }
      void enhance(data.rawText ?? "", Boolean(data.isNew));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function removeResumeFile() {
    setBusy(true);
    try {
      await fetch("/api/resume", { method: "DELETE" });
      setStoredResume(null);
    } finally {
      setBusy(false);
    }
  }

  async function save(then?: () => void) {
    if (!profile) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setProfile(data.profile);
      then?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const count = (k: ListKey) => (profile?.[k] as string[] | undefined)?.length ?? 0;
  const nav = (back: number, forward?: () => void, label = "Continue") => (
    <div className="mt-6 flex gap-2">
      <Button onClick={() => save(forward)} disabled={busy}>
        {busy ? "Saving" : label}
      </Button>
      <Button variant="secondary" onClick={() => setStep(back)} disabled={busy}>
        Back
      </Button>
    </div>
  );

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl tracking-tight">{returning ? "Your profile" : "Let us set you up"}</h1>
          <p className="mt-1 text-sm text-[#777169]">
            {returning
              ? "Everything here feeds your email drafts and recommendations."
              : "Five short steps. Your resume does most of the work."}
          </p>
        </div>
        {profile && (
          <Button variant="secondary" onClick={() => save(() => router.push("/dashboard"))} disabled={busy}>
            Save and exit
          </Button>
        )}
      </div>

      <div className="mt-8">
        <StepRail steps={STEPS} current={step} />
      </div>

      {enhancing && (
        <p className="mt-6 text-[13px] text-[#777169]">
          Reading it again with your model to catch anything the quick pass missed. Keep editing, nothing you type
          will be overwritten.
        </p>
      )}
      {!enhancing && parser === "nim" && step > 0 && (
        <p className="mt-6 text-[13px] text-[#777169]">Refined with your NIM model.</p>
      )}
      {error && <p className="mt-6 text-[13px] text-[#ff4704]">{error}</p>}
      {warning && <p className="mt-6 text-[13px] text-[#ff4704]">{warning}</p>}

      {/* 01 Resume */}
      {step === 0 && (
        <Card className="mt-6 p-6">
          <Eyebrow>01 · Resume</Eyebrow>
          <h2 className="mt-3 text-[17px] font-medium">{storedResume ? "Replace your resume" : "Upload your resume"}</h2>
          <p className="mt-2 text-sm leading-6 text-[#777169]">
            We read it once to fill in your profile, and keep the file so it can be attached to the emails you send.
          </p>

          {storedResume && (
            <Inset className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-mono text-[13px]">{storedResume.fileName}</p>
                <p className="mt-0.5 text-[11px] text-[#777169]">
                  {Math.round(storedResume.size / 1024)} KB · attached to outgoing emails
                </p>
              </div>
              <button
                type="button"
                onClick={removeResumeFile}
                disabled={busy}
                className="shrink-0 text-[13px] text-[#777169] underline underline-offset-2 hover:text-[#ff4704]"
              >
                Remove
              </button>
            </Inset>
          )}

          <div className="mt-5 flex gap-2">
            {(["upload", "paste"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`inline-flex h-8 items-center rounded-full border px-3 text-[13px] ${
                  mode === m ? "border-transparent bg-black text-[#fdfcfc]" : "border-[#e5e5e5] bg-white text-[#777169]"
                }`}
              >
                {m === "upload" ? "Upload a file" : "Paste text"}
              </button>
            ))}
          </div>

          {mode === "upload" ? (
            <label className="mt-4 flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-[#e5e5e5] bg-[#f5f3f1] px-6 py-10 text-center transition-colors hover:border-black">
              <input
                type="file"
                accept=".pdf,.txt,.md"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="sr-only"
              />
              <span className="text-sm font-medium">{file ? file.name : "Choose a PDF"}</span>
              <span className="mt-1 text-[13px] text-[#777169]">
                {file ? `${Math.round(file.size / 1024)} KB, ready to parse` : "PDF, TXT, or Markdown"}
              </span>
            </label>
          ) : (
            <textarea
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              rows={12}
              placeholder={"Alex Rivera\nalex@university.edu\n\nEDUCATION\n...\n\nEXPERIENCE\n..."}
              className={`${areaClass} mt-4 font-mono`}
            />
          )}

          <div className="mt-5 flex items-center gap-3">
            <Button onClick={parseResume} disabled={busy}>
              {busy ? "Reading your resume" : returning ? "Read this file" : "Continue"}
            </Button>
            <span className="text-[13px] text-[#777169]">
              {returning ? "Nothing is replaced until you say so." : "Nothing is sent to anyone at this stage."}
            </span>
          </div>

          {candidate && profile && (
            <div className="mt-6 border-t border-[#e5e5e5] pt-6">
              <Eyebrow>What this file would change</Eyebrow>
              <p className="mt-2 text-[13px] leading-5 text-[#777169]">
                Take the new version of a section, or keep what you have. Your edits stay until you press one of these.
              </p>
              <div className="mt-4 space-y-2">
                {MERGEABLE.map(({ key, label }) => {
                  const current = (profile[key] as string[]) ?? [];
                  const incoming = (candidate[key] as string[]) ?? [];
                  const same = current.join("\n") === incoming.join("\n");
                  return (
                    <div
                      key={key}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#e5e5e5] px-4 py-3"
                    >
                      <div>
                        <p className="text-[13px] font-medium">{label}</p>
                        <p className="mt-0.5 text-[12px] text-[#777169]">
                          {same
                            ? "identical"
                            : `${current.length} now, ${incoming.length} in the new file`}
                        </p>
                      </div>
                      {!same && (
                        <button
                          type="button"
                          onClick={() => setEntries(key, incoming)}
                          className="inline-flex h-8 shrink-0 items-center rounded-full border border-[#e5e5e5] px-3 text-[12px] hover:border-black"
                        >
                          Use the new one
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  onClick={() => {
                    for (const { key } of MERGEABLE) setEntries(key, (candidate[key] as string[]) ?? []);
                    setCandidate(null);
                    setStep(1);
                  }}
                  disabled={busy}
                >
                  Use everything new
                </Button>
                <Button variant="secondary" onClick={() => setCandidate(null)} disabled={busy}>
                  Keep what I have
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* 02 You */}
      {step === 1 && profile && (
        <Card className="mt-6 p-6">
          <Eyebrow>02 · You</Eyebrow>
          <h2 className="mt-3 text-[17px] font-medium">How you introduce yourself</h2>
          <p className="mt-2 text-sm leading-6 text-[#777169]">
            These four lines open every email and sign it off: &ldquo;My name is {profile.name || "you"} and I am{" "}
            {withArticle(profile.standing) || "a student"} at {profile.school || "your school"}.&rdquo;
          </p>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="eyebrow">Name</span>
              <input value={profile.name} onChange={(e) => setText("name", e.target.value)} className={`${inputClass} mt-1.5`} />
            </label>
            <label className="block">
              <span className="eyebrow">Email professors reply to</span>
              <input value={profile.email} onChange={(e) => setText("email", e.target.value)} className={`${inputClass} mt-1.5`} />
            </label>
            <label className="block">
              <span className="eyebrow">School</span>
              <input
                value={profile.school ?? ""}
                onChange={(e) => setText("school", e.target.value)}
                placeholder="Harvard College"
                className={`${inputClass} mt-1.5`}
              />
            </label>
            <label className="block">
              <span className="eyebrow">Standing</span>
              <input
                value={profile.standing ?? ""}
                onChange={(e) => setText("standing", e.target.value)}
                list="standings"
                placeholder="undergraduate"
                className={`${inputClass} mt-1.5`}
              />
              <datalist id="standings">
                {STANDINGS.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </label>
            <label className="block">
              <span className="eyebrow">Degree</span>
              <input
                value={profile.degree ?? ""}
                onChange={(e) => setText("degree", e.target.value)}
                placeholder="A.B. Degree Candidate in Neuroscience"
                className={`${inputClass} mt-1.5`}
              />
            </label>
            <label className="block">
              <span className="eyebrow">Class of</span>
              <input
                value={profile.gradYear ?? ""}
                onChange={(e) => setText("gradYear", e.target.value)}
                placeholder="2027"
                className={`${inputClass} mt-1.5`}
              />
            </label>
          </div>

          <label className="mt-4 block">
            <span className="eyebrow">Education, one entry per line</span>
            <textarea
              value={profile.education.join("\n")}
              onChange={(e) => setList("education", e.target.value)}
              rows={3}
              className={`${areaClass} mt-1.5`}
            />
          </label>

          <label className="mt-4 block">
            <span className="eyebrow">Summary, used when nothing else fits</span>
            <textarea
              value={profile.aiSummary}
              onChange={(e) => setText("aiSummary", e.target.value)}
              rows={3}
              className={`${areaClass} mt-1.5`}
            />
          </label>

          {nav(0, () => setStep(2))}
        </Card>
      )}

      {/* 03 Highlights */}
      {step === 2 && profile && (
        <Card className="mt-6 p-6">
          <Eyebrow>03 · Highlights</Eyebrow>
          <h2 className="mt-3 text-[17px] font-medium">What you have actually worked on</h2>
          <p className="mt-2 text-sm leading-6 text-[#777169]">
            One entry per line, in the form <span className="font-mono text-[12px]">Place, Role: what you did</span>.
            The two that best match a professor open the email, so keep the numbers in: &ldquo;trained a segmentation
            model on 25,000 aerial images, 0.88 mean IoU&rdquo; beats &ldquo;worked on computer vision&rdquo;.
          </p>

          <div className="mt-5 space-y-4">
            {(
              [
                ["experience", "Research and work experience"],
                ["projects", "Projects"],
              ] as [ListKey, string][]
            ).map(([key, label]) => (
              <label key={key} className="block">
                <span className="eyebrow">
                  {label} <span className="font-mono normal-case">({count(key)})</span>
                </span>
                <textarea
                  value={((profile[key] as string[]) ?? []).join("\n")}
                  onChange={(e) => setList(key, e.target.value)}
                  rows={Math.min(8, Math.max(3, count(key) + 1))}
                  className={`${areaClass} mt-1.5`}
                />
              </label>
            ))}
          </div>

          {nav(1, () => setStep(3))}
        </Card>
      )}

      {/* 04 Publications */}
      {step === 3 && profile && (
        <Card className="mt-6 p-6">
          <Eyebrow>04 · Publications</Eyebrow>
          <h2 className="mt-3 text-[17px] font-medium">The things a professor can go and check</h2>
          <p className="mt-2 text-sm leading-6 text-[#777169]">
            These become the bullet list in your emails, links included. A paper with a URL is the single strongest
            thing you can put in a cold email, and press coverage counts too.
          </p>

          <div className="mt-5 space-y-6">
            <LinkedRows
              label="Publications, preprints, posters"
              hint="Say your author position if you have one. &ldquo;3rd author on CT image processing study&rdquo;."
              entries={profile.publications}
              placeholder="1st author preprint on UNet image2image regression"
              onChange={(next) => setEntries("publications", next)}
            />
            <LinkedRows
              label="Awards and press"
              hint="Anything with a link a professor could open, plus the honours worth naming."
              entries={profile.awards ?? []}
              placeholder="Young Scientist Challenge winner"
              onChange={(next) => setEntries("awards", next)}
            />
          </div>

          {nav(2, () => setStep(4))}
        </Card>
      )}

      {/* 05 Interests */}
      {step === 4 && profile && (
        <Card className="mt-6 p-6">
          <Eyebrow>05 · Interests</Eyebrow>
          <h2 className="mt-3 text-[17px] font-medium">What do you want to work on?</h2>
          <p className="mt-2 text-sm leading-6 text-[#777169]">
            This picks your recommendations and decides which of a professor&apos;s papers your email points at. Two or
            three specific topics beat ten vague ones.
          </p>

          <label className="mt-5 block">
            <span className="eyebrow">Research interests, one per line</span>
            <textarea
              value={profile.researchInterests.join("\n")}
              onChange={(e) => setList("researchInterests", e.target.value)}
              rows={4}
              placeholder={"machine learning for genomics\nprotein structure prediction"}
              className={`${areaClass} mt-1.5`}
            />
          </label>

          <label className="mt-4 block">
            <span className="eyebrow">
              Skills and tools <span className="font-mono normal-case">({count("skills")})</span>
            </span>
            <textarea
              value={profile.skills.join("\n")}
              onChange={(e) => setList("skills", e.target.value)}
              rows={5}
              className={`${areaClass} mt-1.5`}
            />
          </label>

          {nav(3, () => router.push("/dashboard"), "Finish and see matches")}
        </Card>
      )}
    </div>
  );
}
