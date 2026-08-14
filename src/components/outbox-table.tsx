"use client";

import { useState } from "react";
import { OutboxEntry } from "@/lib/types";

const METHOD_LABEL: Record<OutboxEntry["method"], string> = {
  "gmail-oauth": "Gmail",
  smtp: "SMTP",
  resend: "Resend",
  "demo-outbox": "Outbox",
};

const STATUS_TONE: Record<OutboxEntry["status"], string> = {
  sent: "text-[#15362b]",
  queued: "text-[#777169]",
  failed: "text-[#ff4704]",
};

/**
 * Tracker table styled after the reference's applications list: tiny uppercase
 * headers, hairline rows, expandable detail.
 */
export default function OutboxTable({ entries }: { entries: OutboxEntry[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | OutboxEntry["status"]>("all");

  const shown = filter === "all" ? entries : entries.filter((e) => e.status === filter);
  const counts = {
    all: entries.length,
    sent: entries.filter((e) => e.status === "sent").length,
    queued: entries.filter((e) => e.status === "queued").length,
    failed: entries.filter((e) => e.status === "failed").length,
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {(["all", "sent", "queued", "failed"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-[12px] capitalize transition-colors ${
              filter === f
                ? "border-transparent bg-black text-[#fdfcfc]"
                : "border-[#e5e5e5] bg-white text-[#777169] hover:text-black"
            }`}
          >
            {f}
            <span className="font-mono text-[10px] opacity-70">{counts[f]}</span>
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-[12px] border border-[#e5e5e5] bg-white">
        <div className="grid grid-cols-[1.1fr_2fr_0.8fr_0.7fr] gap-3 border-b border-[#e5e5e5] bg-[#f5f3f1] px-4 py-2.5">
          {["Researcher", "Subject", "Sent", "Status"].map((h) => (
            <span key={h} className="eyebrow">
              {h}
            </span>
          ))}
        </div>
        {shown.length === 0 && <p className="px-4 py-6 text-center text-[13px] text-[#777169]">Nothing here.</p>}
        {shown.map((e) => (
          <div key={e.id} className="border-b border-[#e5e5e5] last:border-b-0">
            <button
              onClick={() => setOpen(open === e.id ? null : e.id)}
              className="grid w-full grid-cols-[1.1fr_2fr_0.8fr_0.7fr] gap-3 px-4 py-3 text-left text-[13px] transition-colors hover:bg-[#f5f3f1]"
            >
              <span className="truncate font-medium">{e.researcherName}</span>
              <span className="truncate text-[#777169]">{e.subject}</span>
              <span className="truncate text-[#777169]">
                {new Date(e.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              </span>
              <span className={`flex items-center gap-1.5 capitalize ${STATUS_TONE[e.status]}`}>
                {e.status}
                <span className="font-mono text-[10px] text-[#777169]">{METHOD_LABEL[e.method]}</span>
              </span>
            </button>
            {open === e.id && (
              <div className="border-t border-[#e5e5e5] bg-[#f5f3f1] px-4 py-4">
                <p className="text-[12px] text-[#777169]">
                  To {e.to}
                  {e.attachmentName ? ` · ${e.attachmentName} attached` : ""}
                </p>
                {e.detail && <p className="mt-1 text-[12px] text-[#777169]">{e.detail}</p>}
                <pre className="mt-3 max-h-72 overflow-auto rounded-lg border border-[#e5e5e5] bg-white p-4 font-sans text-[13px] leading-6 whitespace-pre-wrap">
                  {e.body}
                </pre>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
