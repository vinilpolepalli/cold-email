"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { UserProfile } from "@/lib/types";

const LIST_FIELDS: { key: keyof UserProfile; label: string }[] = [
  { key: "education", label: "Education" },
  { key: "experience", label: "Experience" },
  { key: "projects", label: "Projects" },
  { key: "skills", label: "Skills" },
  { key: "publications", label: "Publications" },
  { key: "researchInterests", label: "Research interests" },
];

const fieldClass =
  "mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-500 focus:border-orange-700 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-400 dark:focus:border-orange-400";

export default function OnboardingPage() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [tab, setTab] = useState<"upload" | "paste">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState("");

  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((d) => d.profile && setProfile(d.profile));
  }, []);

  async function submitResume() {
    setBusy(true);
    setError("");
    try {
      let res: Response;
      if (tab === "upload") {
        if (!file) throw new Error("Choose a PDF or text file first");
        const form = new FormData();
        form.set("resume", file);
        res = await fetch("/api/onboard", { method: "POST", body: form });
      } else {
        res = await fetch("/api/onboard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to parse resume");
      setProfile(data.profile);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveProfile() {
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
      setSavedAt(new Date().toLocaleTimeString());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Onboarding</h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Upload your resume. We parse it into a profile, write a summary you can edit, and use both to draft your
        emails.
      </p>

      <div className="mt-8 rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex gap-2">
          {(["upload", "paste"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                tab === t
                  ? "bg-orange-700 text-white"
                  : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
              }`}
            >
              {t === "upload" ? "Upload PDF / TXT" : "Paste text"}
            </button>
          ))}
        </div>
        {tab === "upload" ? (
          <input
            type="file"
            accept=".pdf,.txt,.md"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="mt-4 block w-full text-sm text-zinc-600 file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-100 file:px-3 file:py-2 file:font-medium file:text-zinc-900 dark:text-zinc-400 dark:file:bg-zinc-800 dark:file:text-zinc-100"
          />
        ) : (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            placeholder={"Jane Okafor\njane@school.edu\n\nEDUCATION\nB.S. Computer Science, ...\n\nEXPERIENCE\n..."}
            className={`${fieldClass} mt-4 font-mono`}
          />
        )}
        <button
          onClick={submitResume}
          disabled={busy}
          className="mt-4 rounded-lg bg-orange-700 px-4 py-2 font-medium text-white transition-transform hover:bg-orange-800 active:scale-[0.98] disabled:opacity-50"
        >
          {busy ? "Parsing" : "Parse resume"}
        </button>
        {error && <p className="mt-3 text-sm text-red-700 dark:text-red-400">{error}</p>}
      </div>

      {profile && (
        <div className="mt-8 rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Your profile</h2>
            {savedAt && <span className="text-xs text-emerald-700 dark:text-emerald-400">Saved {savedAt}</span>}
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="text-sm">
              <span className="font-medium">Name</span>
              <input
                value={profile.name}
                onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                className={fieldClass}
              />
            </label>
            <label className="text-sm">
              <span className="font-medium">Email (used as reply-to)</span>
              <input
                value={profile.email}
                onChange={(e) => setProfile({ ...profile, email: e.target.value })}
                className={fieldClass}
              />
            </label>
          </div>

          <label className="mt-4 block text-sm">
            <span className="font-medium">Summary (appears in your emails)</span>
            <textarea
              value={profile.aiSummary}
              onChange={(e) => setProfile({ ...profile, aiSummary: e.target.value })}
              rows={3}
              className={fieldClass}
            />
          </label>

          {LIST_FIELDS.map(({ key, label }) => (
            <label key={key} className="mt-4 block text-sm">
              <span className="font-medium">{label} (one per line)</span>
              <textarea
                value={(profile[key] as string[]).join("\n")}
                onChange={(e) => setProfile({ ...profile, [key]: e.target.value.split("\n").filter(Boolean) })}
                rows={Math.min(6, Math.max(2, (profile[key] as string[]).length + 1))}
                className={fieldClass}
              />
            </label>
          ))}

          <div className="mt-6 flex items-center gap-4">
            <button
              onClick={saveProfile}
              disabled={busy}
              className="rounded-lg bg-orange-700 px-4 py-2 font-medium text-white transition-transform hover:bg-orange-800 active:scale-[0.98] disabled:opacity-50"
            >
              Save profile
            </button>
            <Link
              href="/researchers"
              className="text-sm font-medium text-orange-700 hover:underline dark:text-orange-400"
            >
              Next: pick a researcher
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
