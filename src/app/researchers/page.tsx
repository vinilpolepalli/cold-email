"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ResearcherProfile } from "@/lib/types";
import ResearcherCard from "@/components/researcher-card";

function CardSkeleton() {
  return (
    <div className="h-56 animate-pulse rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="h-4 w-2/3 rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="mt-2 h-3 w-1/2 rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="mt-6 flex gap-2">
        <div className="h-5 w-16 rounded-lg bg-zinc-200 dark:bg-zinc-800" />
        <div className="h-5 w-20 rounded-lg bg-zinc-200 dark:bg-zinc-800" />
      </div>
      <div className="mt-6 h-3 w-full rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="mt-2 h-3 w-4/5 rounded bg-zinc-200 dark:bg-zinc-800" />
    </div>
  );
}

const inputClass =
  "rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-500 focus:border-orange-700 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-400 dark:focus:border-orange-400";

export default function ResearchersPage() {
  const [profiles, setProfiles] = useState<ResearcherProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [school, setSchool] = useState("");
  const [onlyEmail, setOnlyEmail] = useState(false);

  useEffect(() => {
    fetch("/api/profiles")
      .then((r) => r.json())
      .then((d) => setProfiles(d.profiles ?? []))
      .finally(() => setLoading(false));
  }, []);

  const schools = useMemo(() => [...new Set(profiles.map((p) => p.school))].sort(), [profiles]);

  const filtered = useMemo(() => {
    const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return profiles.filter((p) => {
      if (school && p.school !== school) return false;
      if (onlyEmail && !p.email) return false;
      if (!terms.length) return true;
      const hay = [p.name, p.title, p.department, p.school, p.bio ?? "", ...p.researchAreas].join(" ").toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }, [profiles, q, school, onlyEmail]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Researchers</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {loading ? "Loading the directory" : `${filtered.length} of ${profiles.length} profiles`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, area, department"
            className={`w-64 ${inputClass}`}
          />
          <select value={school} onChange={(e) => setSchool(e.target.value)} className={inputClass}>
            <option value="">All schools</option>
            {schools.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
            <input
              type="checkbox"
              checked={onlyEmail}
              onChange={(e) => setOnlyEmail(e.target.checked)}
              className="accent-orange-700"
            />
            Has published email
          </label>
        </div>
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {loading
          ? Array.from({ length: 6 }, (_, i) => <CardSkeleton key={i} />)
          : filtered.map((p) => <ResearcherCard key={p.id} profile={p} />)}
      </div>

      {!loading && profiles.length === 0 && (
        <div className="mt-16 rounded-2xl border border-dashed border-zinc-300 p-12 text-center dark:border-zinc-700">
          <p className="font-medium">The directory is empty</p>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            Run the{" "}
            <Link href="/scrape" className="text-orange-700 hover:underline dark:text-orange-400">
              scraping agent
            </Link>{" "}
            against a faculty directory to populate it.
          </p>
        </div>
      )}
      {!loading && profiles.length > 0 && filtered.length === 0 && (
        <p className="mt-16 text-center text-zinc-500 dark:text-zinc-400">No matches. Try clearing filters.</p>
      )}
    </div>
  );
}
