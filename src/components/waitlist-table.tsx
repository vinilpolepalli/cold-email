"use client";

import { useState } from "react";
import { WaitlistEntry } from "@/lib/waitlist";
import { Card } from "./ui";

/** Local date, so "when" reads the way the operator thinks about it. */
function when(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function WaitlistTable({ entries }: { entries: WaitlistEntry[] }) {
  const [rows, setRows] = useState(entries);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function remove(id: string) {
    setBusy(id);
    setError("");
    try {
      const res = await fetch(`/api/waitlist?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not remove that signup");
      setRows((current) => current.filter((r) => r.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
    }
  }

  return (
    <Card className="mt-6 overflow-hidden">
      {error && <p className="border-b border-[#e5e5e5] px-6 py-3 text-[13px] text-[#ff4704]">{error}</p>}
      <ul>
        {rows.map((entry) => (
          <li
            key={entry.id}
            className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e5e5e5] px-6 py-4 last:border-b-0"
          >
            <div className="min-w-0">
              <p className="font-mono text-[13px] break-all">{entry.email}</p>
              <p className="mt-0.5 text-[12px] text-[#777169]">
                {[entry.name, entry.school].filter(Boolean).join(" · ") || "no name given"} · {when(entry.createdAt)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <a
                href={`mailto:${entry.email}`}
                className="text-[13px] text-black underline underline-offset-2 hover:text-[#ff4704]"
              >
                Email them
              </a>
              <button
                type="button"
                onClick={() => remove(entry.id)}
                disabled={busy === entry.id}
                className="text-[13px] text-[#777169] underline underline-offset-2 hover:text-[#ff4704] disabled:opacity-50"
              >
                {busy === entry.id ? "Removing" : "Remove"}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
