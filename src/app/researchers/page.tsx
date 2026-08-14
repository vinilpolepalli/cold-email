"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ResearcherProfile } from "@/lib/types";
import ResearcherCard from "@/components/researcher-card";
import { Card, Eyebrow } from "@/components/ui";

function CardSkeleton() {
  return (
    <div className="h-52 animate-pulse rounded-[12px] border border-[#e5e5e5] bg-white p-5">
      <div className="h-4 w-2/3 rounded bg-[#f5f3f1]" />
      <div className="mt-2 h-3 w-1/2 rounded bg-[#f5f3f1]" />
      <div className="mt-6 flex gap-2">
        <div className="h-5 w-16 rounded-full bg-[#f5f3f1]" />
        <div className="h-5 w-20 rounded-full bg-[#f5f3f1]" />
      </div>
      <div className="mt-6 h-3 w-full rounded bg-[#f5f3f1]" />
    </div>
  );
}

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
    <div className="px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl tracking-tight">Researchers</h1>
          <p className="mt-1 text-sm text-[#777169]">
            {loading ? "Loading the directory" : `${filtered.length} of ${profiles.length} profiles`}
          </p>
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, area, department"
          className="h-9 w-full max-w-xs rounded-full border border-[#e5e5e5] bg-white px-4 text-sm placeholder:text-[#777169] focus:border-black focus:outline-none"
        />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button
          onClick={() => setSchool("")}
          className={`inline-flex h-7 items-center rounded-full border px-3 text-[12px] ${
            school === "" ? "border-transparent bg-black text-[#fdfcfc]" : "border-[#e5e5e5] bg-white text-[#777169]"
          }`}
        >
          All schools
        </button>
        {schools.map((s) => (
          <button
            key={s}
            onClick={() => setSchool(s)}
            className={`inline-flex h-7 items-center rounded-full border px-3 text-[12px] ${
              school === s ? "border-transparent bg-black text-[#fdfcfc]" : "border-[#e5e5e5] bg-white text-[#777169]"
            }`}
          >
            {s}
          </button>
        ))}
        <button
          onClick={() => setOnlyEmail(!onlyEmail)}
          className={`inline-flex h-7 items-center rounded-full border px-3 text-[12px] ${
            onlyEmail ? "border-transparent bg-black text-[#fdfcfc]" : "border-[#e5e5e5] bg-white text-[#777169]"
          }`}
        >
          Has published email
        </button>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {loading
          ? Array.from({ length: 6 }, (_, i) => <CardSkeleton key={i} />)
          : filtered.map((p) => <ResearcherCard key={p.id} profile={p} />)}
      </div>

      {!loading && profiles.length === 0 && (
        <Card className="mt-10 p-10 text-center">
          <Eyebrow>The directory is empty</Eyebrow>
          <p className="mt-2 text-[13px] text-[#777169]">
            Run the{" "}
            <Link href="/scrape" className="text-black underline underline-offset-2">
              scraping agent
            </Link>{" "}
            against a faculty directory to populate it.
          </p>
        </Card>
      )}
      {!loading && profiles.length > 0 && filtered.length === 0 && (
        <p className="mt-10 text-center text-[13px] text-[#777169]">No matches. Try clearing filters.</p>
      )}
    </div>
  );
}
