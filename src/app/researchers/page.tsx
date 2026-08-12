"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ResearcherProfile } from "@/lib/types";

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
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Researchers</h1>
          <p className="text-sm text-slate-600">
            {loading ? "Loading…" : `${filtered.length} of ${profiles.length} profiles`}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, area, department…"
            className="w-64 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          />
          <select
            value={school}
            onChange={(e) => setSchool(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">All schools</option>
            {schools.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={onlyEmail} onChange={(e) => setOnlyEmail(e.target.checked)} />
            Has published email
          </label>
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {filtered.map((p) => (
          <div key={p.id} className="flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold leading-tight">{p.name}</h3>
                <p className="text-sm text-slate-600">{p.title}</p>
              </div>
              <span className="shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
                {p.school}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">{p.department}</p>
            <div className="mt-3 flex flex-wrap gap-1">
              {p.researchAreas.slice(0, 4).map((a) => (
                <span key={a} className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                  {a}
                </span>
              ))}
            </div>
            {p.bio && <p className="mt-3 line-clamp-3 text-sm text-slate-600">{p.bio}</p>}
            <div className="mt-auto flex items-center justify-between pt-4">
              <span className={`text-xs ${p.email ? "text-emerald-600" : "text-slate-400"}`}>
                {p.email ? p.email : "email not published"}
              </span>
              <Link
                href={`/compose?researcher=${encodeURIComponent(p.id)}`}
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
              >
                Compose
              </Link>
            </div>
          </div>
        ))}
      </div>
      {!loading && filtered.length === 0 && (
        <p className="mt-12 text-center text-slate-500">No matches — try clearing filters.</p>
      )}
    </div>
  );
}
