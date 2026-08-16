"use client";

import { useState } from "react";
import { EmailRule } from "@/lib/preferences";

/**
 * The standing instructions the sender has given the AI. Every prompt typed
 * into the draft editor lands here and is replayed into future drafts, so this
 * list has to be somewhere the sender can actually see and prune it: a rule
 * that saves itself silently and cannot be found again is a rule nobody agreed
 * to keep.
 */
export function RulesPanel({
  rules,
  onChange,
  allowAdd = false,
  emptyText = "Nothing yet. Anything you ask the AI to change on a draft is remembered here and applied to your next email.",
}: {
  rules: EmailRule[];
  onChange: (rules: EmailRule[]) => void;
  allowAdd?: boolean;
  emptyText?: string;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  async function call(init: RequestInit, url = "/api/preferences") {
    setError("");
    const res = await fetch(url, init);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "That did not save");
    onChange(data.rules);
  }

  async function toggle(rule: EmailRule) {
    setBusyId(rule.id);
    try {
      await call({
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: rule.id, enabled: !rule.enabled }),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(rule: EmailRule) {
    setBusyId(rule.id);
    try {
      await call({ method: "DELETE" }, `/api/preferences?id=${encodeURIComponent(rule.id)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  async function add() {
    if (!draft.trim()) return;
    setAdding(true);
    try {
      await call({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: draft }),
      });
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(false);
    }
  }

  return (
    <div>
      {rules.length === 0 ? (
        <p className="text-[12px] leading-5 text-[#777169]">{emptyText}</p>
      ) : (
        <ul className="space-y-1.5">
          {rules.map((rule) => (
            <li key={rule.id} className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={rule.enabled}
                disabled={busyId === rule.id}
                onChange={() => toggle(rule)}
                className="mt-[3px] accent-black"
                aria-label={rule.enabled ? "Stop applying this" : "Apply this again"}
              />
              <span
                className={`min-w-0 flex-1 text-[12px] leading-5 ${
                  rule.enabled ? "text-black" : "text-[#777169] line-through"
                }`}
              >
                {rule.text}
              </span>
              <button
                type="button"
                onClick={() => remove(rule)}
                disabled={busyId === rule.id}
                className="shrink-0 text-[11px] text-[#777169] underline underline-offset-2 hover:text-black disabled:opacity-50"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      {allowAdd && (
        <div className="mt-3 flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            placeholder="Never mention my GPA"
            className="h-8 w-full rounded-lg border border-[#e5e5e5] bg-white px-3 text-[12px] text-black placeholder:text-[#777169] focus:border-black focus:outline-none"
          />
          <button
            type="button"
            onClick={add}
            disabled={adding || !draft.trim()}
            className="h-8 shrink-0 rounded-full border border-[#e5e5e5] bg-white px-3 text-[12px] hover:bg-[#f5f3f1] disabled:opacity-50"
          >
            {adding ? "Saving" : "Add"}
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-[12px] text-[#ff4704]">{error}</p>}
    </div>
  );
}
