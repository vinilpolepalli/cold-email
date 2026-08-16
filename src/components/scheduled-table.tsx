"use client";

import { useState } from "react";
import { ScheduledEmail } from "@/lib/types";
import { Card } from "./ui";

/** Local time, because that is the clock the sender picked it in. */
function when(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? iso
    : at.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const TONE: Record<ScheduledEmail["status"], string> = {
  scheduled: "text-[#ff4704]",
  sending: "text-[#777169]",
  sent: "text-[#15362b]",
  failed: "text-[#ff4704]",
  canceled: "text-[#777169]",
};

const LABEL: Record<ScheduledEmail["status"], string> = {
  scheduled: "Scheduled",
  sending: "Sending",
  sent: "Sent",
  failed: "Failed",
  canceled: "Canceled",
};

export default function ScheduledTable({ entries }: { entries: ScheduledEmail[] }) {
  const [rows, setRows] = useState(entries);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function act(id: string, dismiss: boolean) {
    setBusy(id);
    setError("");
    try {
      const res = await fetch(`/api/schedule?id=${encodeURIComponent(id)}${dismiss ? "&dismiss=1" : ""}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "That did not work");
      setRows((current) =>
        dismiss
          ? current.filter((r) => r.id !== id)
          : current.map((r) => (r.id === id ? { ...r, status: "canceled", detail: "Canceled before it sent" } : r))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
    }
  }

  if (rows.length === 0) return null;

  return (
    <Card className="overflow-hidden">
      {error && <p className="border-b border-[#e5e5e5] px-6 py-3 text-[13px] text-[#ff4704]">{error}</p>}
      <ul>
        {rows.map((row) => (
          <li
            key={row.id}
            className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e5e5e5] px-6 py-4 last:border-b-0"
          >
            <div className="min-w-0">
              <p className="text-[13px] font-medium">{row.researcherName}</p>
              <p className="mt-0.5 truncate text-[12px] text-[#777169]">{row.subject}</p>
              <p className="mt-0.5 text-[12px] text-[#777169]">
                {when(row.sendAt)} · {row.to}
                {row.cc.length ? ` · copying ${row.cc.length}` : ""}
              </p>
              {row.detail && row.status !== "scheduled" && (
                <p className="mt-1 max-w-xl text-[11px] leading-4 text-[#777169]">{row.detail}</p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className={`text-[12px] ${TONE[row.status]}`}>{LABEL[row.status]}</span>
              {row.status === "scheduled" && (
                <button
                  type="button"
                  onClick={() => act(row.id, false)}
                  disabled={busy === row.id}
                  className="text-[13px] text-[#777169] underline underline-offset-2 hover:text-[#ff4704] disabled:opacity-50"
                >
                  {busy === row.id ? "Canceling" : "Cancel"}
                </button>
              )}
              {(row.status === "sent" || row.status === "failed" || row.status === "canceled") && (
                <button
                  type="button"
                  onClick={() => act(row.id, true)}
                  disabled={busy === row.id}
                  className="text-[13px] text-[#777169] underline underline-offset-2 hover:text-[#ff4704] disabled:opacity-50"
                >
                  {busy === row.id ? "Clearing" : "Clear"}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
