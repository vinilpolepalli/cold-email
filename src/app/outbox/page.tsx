"use client";

import { useEffect, useState } from "react";
import { OutboxEntry } from "@/lib/types";

const METHOD_LABEL: Record<OutboxEntry["method"], string> = {
  "gmail-oauth": "Gmail (your account)",
  smtp: "SMTP",
  resend: "Resend",
  "demo-outbox": "Demo outbox",
};

export default function OutboxPage() {
  const [entries, setEntries] = useState<OutboxEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/send")
      .then((r) => r.json())
      .then((d) => setEntries(d.outbox ?? []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-bold">Outbox</h1>
      <p className="mt-1 text-sm text-slate-600">
        Every send attempt lands here — including demo-mode emails that were queued locally because no email provider
        is configured.
      </p>

      <div className="mt-6 space-y-3">
        {loading && <p className="text-slate-500">Loading…</p>}
        {!loading && entries.length === 0 && (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500">
            Nothing sent yet.
          </p>
        )}
        {entries.map((e) => (
          <div key={e.id} className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <button
              onClick={() => setOpen(open === e.id ? null : e.id)}
              className="flex w-full items-center gap-3 p-4 text-left"
            >
              <span
                className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                  e.status === "sent" ? "bg-emerald-500" : e.status === "queued" ? "bg-amber-400" : "bg-red-500"
                }`}
                title={e.status}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{e.subject}</p>
                <p className="truncate text-sm text-slate-500">
                  to {e.researcherName} &lt;{e.to}&gt;
                </p>
              </div>
              <span className="shrink-0 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                {METHOD_LABEL[e.method]}
              </span>
              <span className="shrink-0 text-xs text-slate-400">{new Date(e.createdAt).toLocaleString()}</span>
            </button>
            {open === e.id && (
              <div className="border-t border-slate-100 p-4">
                {e.detail && <p className="mb-3 text-xs text-slate-500">{e.detail}</p>}
                <pre className="whitespace-pre-wrap rounded-md bg-slate-50 p-4 text-sm leading-relaxed text-slate-700">
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
