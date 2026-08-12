"use client";

import { useState } from "react";
import Link from "next/link";
import { ResearcherProfile } from "@/lib/types";
import ResearcherCard from "@/components/researcher-card";

interface ScrapeResult {
  profiles: ResearcherProfile[];
  pagesVisited: number;
  extractor: "nim" | "heuristic";
  added: number;
}

const fieldClass =
  "mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-500 focus:border-orange-700 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-400 dark:focus:border-orange-400";

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
    <div className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">AI scraper</h1>
      <p className="mt-1 max-w-prose text-sm text-zinc-600 dark:text-zinc-400">
        Point the scraping agent at a faculty-directory page. It crawls profile links, extracts names, titles,
        research areas, and published emails, then adds new people to the directory. With{" "}
        <code className="font-mono text-xs">NVIDIA_API_KEY</code> set it extracts with an LLM; otherwise it uses
        heuristics.
      </p>

      <div className="mt-8 rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="grid gap-4 sm:grid-cols-[1fr_220px]">
          <label className="text-sm">
            <span className="font-medium">Faculty directory URL</span>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://university.edu/cs/faculty (or http://localhost:4001 for the bundled mock university)"
              className={fieldClass}
            />
          </label>
          <label className="text-sm">
            <span className="font-medium">School label (optional)</span>
            <input
              value={school}
              onChange={(e) => setSchool(e.target.value)}
              placeholder="e.g. Averton Tech"
              className={fieldClass}
            />
          </label>
        </div>
        <button
          onClick={run}
          disabled={busy || !/^https?:\/\//.test(url)}
          className="mt-4 rounded-lg bg-orange-700 px-4 py-2 font-medium text-white transition-transform hover:bg-orange-800 active:scale-[0.98] disabled:opacity-50"
        >
          {busy ? "Scraping (crawls up to ~12 pages)" : "Run scraping agent"}
        </button>
        {error && <p className="mt-3 text-sm text-red-700 dark:text-red-400">{error}</p>}
      </div>

      {busy && (
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {Array.from({ length: 2 }, (_, i) => (
            <div
              key={i}
              className="h-40 animate-pulse rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
            />
          ))}
        </div>
      )}

      {result && (
        <div className="mt-8">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Visited {result.pagesVisited} pages with the {result.extractor} extractor. Found{" "}
            <b>{result.profiles.length}</b> profiles, added <b>{result.added}</b> new to the{" "}
            <Link href="/researchers" className="text-orange-700 hover:underline dark:text-orange-400">
              directory
            </Link>
            .
          </p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {result.profiles.map((p) => (
              <ResearcherCard key={p.id} profile={p} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
