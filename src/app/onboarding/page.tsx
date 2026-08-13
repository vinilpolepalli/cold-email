"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { UserProfile } from "@/lib/types";
import { Button, Card, Eyebrow, StepRail } from "@/components/ui";

// Seamless post-signup flow: upload, confirm the parse, add what only the user
// knows, then straight into the dashboard. Each step is one focused card.

const STEPS = ["Resume", "Basics", "Background", "Interests"];

const inputClass =
  "h-10 w-full rounded-lg border border-[#e5e5e5] bg-white px-3 text-sm text-black placeholder:text-[#777169] focus:border-black focus:outline-none";
const areaClass =
  "w-full rounded-lg border border-[#e5e5e5] bg-white p-3 text-sm leading-6 text-black placeholder:text-[#777169] focus:border-black focus:outline-none";

type ListKey = "education" | "experience" | "projects" | "skills" | "publications" | "researchInterests" | "awards";

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [pasted, setPasted] = useState("");
  const [mode, setMode] = useState<"upload" | "paste">("upload");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [parser, setParser] = useState("");
  const [returning, setReturning] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      const d = await fetch("/api/me").then((r) => r.json()).catch(() => null);
      if (cancelled || !d?.profile) return;
      // An existing profile means this is an edit, not first-run onboarding.
      setProfile(d.profile);
      setReturning(true);
      setStep(1);
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, []);

  const setList = (key: ListKey, value: string) =>
    setProfile((p) => (p ? { ...p, [key]: value.split("\n").filter((l) => l.trim().length > 0) } : p));

  async function parseResume() {
    setBusy(true);
    setError("");
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
      setProfile(data.profile);
      setParser(data.parser ?? "");
      setStep(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl tracking-tight">{returning ? "Your profile" : "Let us set you up"}</h1>
          <p className="mt-1 text-sm text-[#777169]">
            {returning
              ? "Everything here feeds your email drafts and recommendations."
              : "Four short steps. Your resume does most of the work."}
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

      {error && <p className="mt-6 text-[13px] text-[#ff4704]">{error}</p>}

      {/* 01 Resume */}
      {step === 0 && (
        <Card className="mt-6 p-6">
          <Eyebrow>01 · Resume</Eyebrow>
          <h2 className="mt-3 text-[17px] font-medium">Upload your resume</h2>
          <p className="mt-2 text-sm leading-6 text-[#777169]">
            We read it once to fill in your profile, and keep the file so it can be attached to the emails you send.
          </p>

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
              {busy ? "Reading your resume" : "Continue"}
            </Button>
            <span className="text-[13px] text-[#777169]">Nothing is sent to anyone at this stage.</span>
          </div>
        </Card>
      )}

      {/* 02 Basics */}
      {step === 1 && profile && (
        <Card className="mt-6 p-6">
          <Eyebrow>02 · Basics</Eyebrow>
          <h2 className="mt-3 text-[17px] font-medium">Check what we picked up</h2>
          <p className="mt-2 text-sm leading-6 text-[#777169]">
            {parser === "nim"
              ? "Parsed with your NIM model. Correct anything that looks off."
              : "Parsed from the file. Correct anything that looks off."}
          </p>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="eyebrow">Name</span>
              <input
                value={profile.name}
                onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                className={`${inputClass} mt-1.5`}
              />
            </label>
            <label className="block">
              <span className="eyebrow">Email professors reply to</span>
              <input
                value={profile.email}
                onChange={(e) => setProfile({ ...profile, email: e.target.value })}
                className={`${inputClass} mt-1.5`}
              />
            </label>
          </div>

          <label className="mt-4 block">
            <span className="eyebrow">Education</span>
            <textarea
              value={profile.education.join("\n")}
              onChange={(e) => setList("education", e.target.value)}
              rows={3}
              className={`${areaClass} mt-1.5`}
            />
          </label>

          <label className="mt-4 block">
            <span className="eyebrow">Summary used to open your emails</span>
            <textarea
              value={profile.aiSummary}
              onChange={(e) => setProfile({ ...profile, aiSummary: e.target.value })}
              rows={4}
              className={`${areaClass} mt-1.5`}
            />
          </label>

          <div className="mt-5 flex gap-2">
            <Button onClick={() => save(() => setStep(2))} disabled={busy}>
              Continue
            </Button>
            <Button variant="secondary" onClick={() => setStep(0)}>
              Back
            </Button>
          </div>
        </Card>
      )}

      {/* 03 Background */}
      {step === 2 && profile && (
        <Card className="mt-6 p-6">
          <Eyebrow>03 · Background</Eyebrow>
          <h2 className="mt-3 text-[17px] font-medium">What you have actually worked on</h2>
          <p className="mt-2 text-sm leading-6 text-[#777169]">
            One entry per line. These become the bullet list in your emails, so keep the concrete results.
          </p>

          <div className="mt-5 space-y-4">
            {(
              [
                ["experience", "Research and work experience"],
                ["projects", "Projects"],
                ["publications", "Publications and links"],
                ["awards", "Awards"],
              ] as [ListKey, string][]
            ).map(([key, label]) => (
              <label key={key} className="block">
                <span className="eyebrow">
                  {label} <span className="font-mono normal-case">({count(key)})</span>
                </span>
                <textarea
                  value={((profile[key] as string[]) ?? []).join("\n")}
                  onChange={(e) => setList(key, e.target.value)}
                  rows={Math.min(6, Math.max(2, count(key) + 1))}
                  className={`${areaClass} mt-1.5`}
                />
              </label>
            ))}
          </div>

          <div className="mt-5 flex gap-2">
            <Button onClick={() => save(() => setStep(3))} disabled={busy}>
              Continue
            </Button>
            <Button variant="secondary" onClick={() => setStep(1)}>
              Back
            </Button>
          </div>
        </Card>
      )}

      {/* 04 Interests */}
      {step === 3 && profile && (
        <Card className="mt-6 p-6">
          <Eyebrow>04 · Interests</Eyebrow>
          <h2 className="mt-3 text-[17px] font-medium">What do you want to work on?</h2>
          <p className="mt-2 text-sm leading-6 text-[#777169]">
            This is the strongest signal for recommendations. Two or three specific topics beat ten vague ones.
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

          <div className="mt-5 flex gap-2">
            <Button onClick={() => save(() => router.push("/dashboard"))} disabled={busy}>
              {busy ? "Saving" : "Finish and see matches"}
            </Button>
            <Button variant="secondary" onClick={() => setStep(2)}>
              Back
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
