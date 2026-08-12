"use client";

import { useState } from "react";
import Link from "next/link";
import { ResearcherProfile } from "@/lib/types";

interface ScrapeResult {
  profiles: ResearcherProfile[];
  pagesVisited: number;
  extractor: "nim" | "heuristic";
  added: number;
}

export default function ScrapePage() {
  const [url, setUrl] = useState("");
  const [school, setSchool] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ScrapeResult | null>(null);

  async function run() {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, school: school || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Scrape failed");
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-bold">AI scraper</h1>
      <p className="mt-1 text-sm text-slate-600">
        Point the scraping agent at any faculty-directory page. It crawls profile links, extracts names, titles,
        research areas, and published emails (via NVIDIA NIM when <code>NVIDIA_API_KEY</code> is set, heuristics
        otherwise), and adds new people to the directory.
      </p>

      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="grid gap-4 sm:grid-cols-[1fr_220px]">
          <label className="text-sm">
            <span className="font-medium text-slate-700">Faculty directory URL</span>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://university.edu/cs/faculty (or http://localhost:4001 for the bundled mock university)"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="font-medium text-slate-700">School label (optional)</span>
            <input
              value={school}
              onChange={(e) => setSchool(e.target.value)}
              placeholder="e.g. Averton Tech"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
        </div>
        <button
          onClick={run}
          disabled={busy || !/^https?:\/\//.test(url)}
          className="mt-4 rounded-md bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy ? "Scraping… (crawls up to ~12 pages)" : "Run scraping agent"}
        </button>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </div>

      {result && (
        <div className="mt-8">
          <p className="text-sm text-slate-600">
            Visited {result.pagesVisited} pages with the <b>{result.extractor}</b> extractor — found{" "}
            <b>{result.profiles.length}</b> profiles, added <b>{result.added}</b> new to the{" "}
            <Link href="/researchers" className="text-indigo-600 underline">
              directory
            </Link>
            .
          </p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {result.profiles.map((p) => (
              <div key={p.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="font-semibold">{p.name}</h3>
                <p className="text-sm text-slate-600">{p.title}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {p.department}, {p.school}
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {p.researchAreas.map((a) => (
                    <span key={a} className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                      {a}
                    </span>
                  ))}
                </div>
                <p className={`mt-3 text-xs ${p.email ? "text-emerald-600" : "text-slate-400"}`}>
                  {p.email ?? "email not published"}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
