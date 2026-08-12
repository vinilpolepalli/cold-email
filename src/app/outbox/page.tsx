"use client";

import { useEffect, useState } from "react";
import { OutboxEntry } from "@/lib/types";

const METHOD_LABEL: Record<OutboxEntry["method"], string> = {
  "gmail-oauth": "Gmail (your account)",
  smtp: "SMTP",
  resend: "Resend",
  "demo-outbox": "Demo outbox",
};

// Status dot conveys real semantic state (sent / queued / failed).
const STATUS_DOT: Record<OutboxEntry["status"], string> = {
  sent: "bg-emerald-600",
  queued: "bg-amber-500",
  failed: "bg-red-600",
};

function RowSkeleton() {
  return (
    <div className="h-16 animate-pulse rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="h-4 w-1/2 rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="mt-2 h-3 w-1/3 rounded bg-zinc-200 dark:bg-zinc-800" />
    </div>
  );
}

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
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Outbox</h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Every send attempt lands here, including demo-mode emails queued locally because no provider is configured.
      </p>

      <div className="mt-8 space-y-3">
        {loading && (
          <>
            <RowSkeleton />
            <RowSkeleton />
          </>
        )}
        {!loading && entries.length === 0 && (
          <div className="rounded-2xl border border-dashed border-zinc-300 p-12 text-center dark:border-zinc-700">
            <p className="font-medium">Nothing sent yet</p>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
              Pick a researcher, review your draft, and hit send. It will show up here.
            </p>
          </div>
        )}
        {entries.map((e) => (
          <div key={e.id} className="rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <button
              onClick={() => setOpen(open === e.id ? null : e.id)}
              className="flex w-full items-center gap-3 p-4 text-left"
            >
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_DOT[e.status]}`} title={e.status} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{e.subject}</p>
                <p className="truncate text-sm text-zinc-500 dark:text-zinc-400">
                  to {e.researcherName} ({e.to})
                </p>
              </div>
              <span className="shrink-0 rounded-lg bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                {METHOD_LABEL[e.method]}
              </span>
              <span className="shrink-0 text-xs text-zinc-400 dark:text-zinc-500">
                {new Date(e.createdAt).toLocaleString()}
              </span>
            </button>
            {open === e.id && (
              <div className="border-t border-zinc-100 p-4 dark:border-zinc-800">
                {e.detail && <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">{e.detail}</p>}
                <pre className="whitespace-pre-wrap rounded-lg bg-zinc-50 p-4 font-sans text-sm leading-relaxed text-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">
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
