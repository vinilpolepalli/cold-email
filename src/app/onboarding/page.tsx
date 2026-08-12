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
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold">Onboarding</h1>
      <p className="mt-1 text-sm text-slate-600">
        Upload your resume — we parse it into a profile and write an AI summary. Everything is editable, and it powers
        the email drafts.
      </p>

      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex gap-2">
          {(["upload", "paste"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                tab === t ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
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
            className="mt-4 block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-indigo-50 file:px-3 file:py-2 file:text-indigo-700"
          />
        ) : (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            placeholder={"Jane Doe\njane@school.edu\n\nEDUCATION\nB.S. Computer Science, ...\n\nEXPERIENCE\n..."}
            className="mt-4 w-full rounded-md border border-slate-300 p-3 font-mono text-sm"
          />
        )}
        <button
          onClick={submitResume}
          disabled={busy}
          className="mt-4 rounded-md bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy ? "Parsing…" : "Parse resume"}
        </button>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </div>

      {profile && (
        <div className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Your profile</h2>
            {savedAt && <span className="text-xs text-emerald-600">Saved {savedAt}</span>}
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="text-sm">
              <span className="font-medium text-slate-700">Name</span>
              <input
                value={profile.name}
                onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              />
            </label>
            <label className="text-sm">
              <span className="font-medium text-slate-700">Email (used as reply-to)</span>
              <input
                value={profile.email}
                onChange={(e) => setProfile({ ...profile, email: e.target.value })}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              />
            </label>
          </div>

          <label className="mt-4 block text-sm">
            <span className="font-medium text-slate-700">AI summary (appears in your emails)</span>
            <textarea
              value={profile.aiSummary}
              onChange={(e) => setProfile({ ...profile, aiSummary: e.target.value })}
              rows={3}
              className="mt-1 w-full rounded-md border border-slate-300 p-3 text-sm"
            />
          </label>

          {LIST_FIELDS.map(({ key, label }) => (
            <label key={key} className="mt-4 block text-sm">
              <span className="font-medium text-slate-700">{label} (one per line)</span>
              <textarea
                value={(profile[key] as string[]).join("\n")}
                onChange={(e) => setProfile({ ...profile, [key]: e.target.value.split("\n").filter(Boolean) })}
                rows={Math.min(6, Math.max(2, (profile[key] as string[]).length + 1))}
                className="mt-1 w-full rounded-md border border-slate-300 p-3 text-sm"
              />
            </label>
          ))}

          <div className="mt-6 flex items-center gap-4">
            <button
              onClick={saveProfile}
              disabled={busy}
              className="rounded-md bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              Save profile
            </button>
            <Link href="/researchers" className="text-sm font-medium text-indigo-600 hover:underline">
              Next: pick a researcher →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
