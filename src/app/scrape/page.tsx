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
  "mt-1.5 w-full rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-sm text-black placeholder:text-[#777169] focus:border-black focus:outline-none";

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
    <div className="px-6 py-8">
      <h1 className="text-2xl tracking-tight">Scraper</h1>
      <p className="mt-1 max-w-prose text-sm text-[#777169]">
        Point the scraping agent at a faculty-directory page. It crawls profile links, extracts names, titles,
        research areas, and published emails, then adds new people to the directory. With{" "}
        <code className="font-mono text-[12px]">NVIDIA_API_KEY</code> set it extracts with an LLM; otherwise it uses
        heuristics.
      </p>

      <div className="mt-6 rounded-[14px] border border-[#e5e5e5] bg-white p-6">
        <div className="grid gap-4 sm:grid-cols-[1fr_220px]">
          <label className="text-sm">
            <span className="eyebrow">Faculty directory URL</span>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://university.edu/cs/faculty (or http://localhost:4001 for the bundled mock university)"
              className={fieldClass}
            />
          </label>
          <label className="text-sm">
            <span className="eyebrow">School label (optional)</span>
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
          className="mt-5 inline-flex h-9 items-center rounded-full border border-[#e5e5e5] bg-black px-4 text-sm font-medium text-[#fdfcfc] hover:bg-[#171717] disabled:opacity-50"
        >
          {busy ? "Scraping (crawls up to ~12 pages)" : "Run scraping agent"}
        </button>
        {error && <p className="mt-3 text-[13px] text-[#ff4704]">{error}</p>}
      </div>

      {busy && (
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {Array.from({ length: 2 }, (_, i) => (
            <div
              key={i}
              className="h-40 animate-pulse rounded-[12px] border border-[#e5e5e5] bg-white"
            />
          ))}
        </div>
      )}

      {result && (
        <div className="mt-8">
          <p className="text-[13px] text-[#777169]">
            Visited {result.pagesVisited} pages with the {result.extractor} extractor. Found{" "}
            <b>{result.profiles.length}</b> profiles, added <b>{result.added}</b> new to the{" "}
            <Link href="/researchers" className="text-black underline underline-offset-2">
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
