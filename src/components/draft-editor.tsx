"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { EmailRule } from "@/lib/preferences";
import { Inset } from "@/components/ui";
import { RulesPanel } from "@/components/rules-panel";

interface Selection {
  start: number;
  end: number;
  /** Kept alongside the offsets so a stale range can be re-found rather than
   *  splicing the reply into whatever now sits at those positions. */
  text: string;
}

/**
 * Put the replacement back where it came from. Offsets are checked against the
 * text they were taken from first: the sender can type into the body between
 * highlighting a passage and pressing Apply, which shifts everything after the
 * edit. When the offsets no longer hold, the passage is looked up by content.
 */
function splice(body: string, selection: Selection | null, replacement: string): string | null {
  if (!selection) return replacement;
  if (body.slice(selection.start, selection.end) === selection.text) {
    return body.slice(0, selection.start) + replacement + body.slice(selection.end);
  }
  const at = body.indexOf(selection.text);
  if (at === -1) return null;
  return body.slice(0, at) + replacement + body.slice(at + selection.text.length);
}

function snippet(text: string, max = 60): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

const textareaClass =
  "w-full rounded-lg border border-[#e5e5e5] bg-white p-4 text-sm leading-6 text-black focus:border-black focus:outline-none";

/**
 * The email body plus a prompt bar that edits it. Highlight a passage and the
 * instruction applies to that passage alone; highlight nothing and it applies
 * to the whole email. Either way the instruction is kept and replayed into
 * future drafts, which is the point: a correction made once should not have to
 * be made again on the next professor.
 */
export function DraftEditor({
  body,
  setBody,
  subject,
  setSubject,
  researcherId,
  aiAvailable,
  rules,
  setRules,
  disabled = false,
}: {
  body: string;
  setBody: (value: string) => void;
  subject: string;
  setSubject: (value: string) => void;
  researcherId: string;
  aiAvailable: boolean;
  rules: EmailRule[];
  setRules: (rules: EmailRule[]) => void;
  disabled?: boolean;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [instruction, setInstruction] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [applied, setApplied] = useState<{ instruction: string; rule: EmailRule | null } | null>(null);
  const [history, setHistory] = useState<{ body: string; subject: string }[]>([]);
  const [showRules, setShowRules] = useState(false);

  const readSelection = useCallback(() => {
    const el = area.current;
    // Only while the body itself has focus. Clicking into the instruction box
    // moves focus and must not wipe the passage that was just highlighted.
    if (!el || document.activeElement !== el) return;
    const { selectionStart: start, selectionEnd: end } = el;
    if (start === end) {
      setSelection(null);
      return;
    }
    setSelection({ start, end, text: el.value.slice(start, end) });
  }, []);

  // `selectionchange` on the document rather than React's onSelect: onSelect is
  // synthesised from mouse and key events, so it misses a selection made any
  // other way, and this one event covers dragging, shift-arrow and select-all
  // alike.
  useEffect(() => {
    document.addEventListener("selectionchange", readSelection);
    return () => document.removeEventListener("selectionchange", readSelection);
  }, [readSelection]);

  async function apply() {
    const asked = instruction.trim();
    if (!asked || !body.trim()) return;
    setWorking(true);
    setError("");
    try {
      const res = await fetch("/api/revise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          researcherId,
          subject,
          body,
          instruction: asked,
          selection: selection ? { start: selection.start, end: selection.end } : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "That edit did not go through");

      const next = splice(body, selection, data.text);
      if (next === null) {
        throw new Error("The passage you highlighted has changed since. Highlight it again and retry.");
      }

      setHistory((prev) => [...prev, { body, subject }].slice(-20));
      setBody(next);
      if (data.subject) setSubject(data.subject);
      setApplied({ instruction: asked, rule: data.rule ?? null });
      if (Array.isArray(data.rules)) setRules(data.rules);
      setInstruction("");
      setSelection(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setWorking(false);
    }
  }

  function undo() {
    const previous = history[history.length - 1];
    if (!previous) return;
    setHistory((prev) => prev.slice(0, -1));
    setBody(previous.body);
    setSubject(previous.subject);
    setApplied(null);
  }

  async function forgetLastRule() {
    const rule = applied?.rule;
    if (!rule) return;
    try {
      const res = await fetch(`/api/preferences?id=${encodeURIComponent(rule.id)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not remove that");
      setRules(data.rules);
      setApplied((prev) => (prev ? { ...prev, rule: null } : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const activeRules = rules.filter((r) => r.enabled).length;

  return (
    <div>
      <label className="block">
        <span className="eyebrow">Body</span>
        <textarea
          ref={area}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onSelect={readSelection}
          rows={18}
          className={`${textareaClass} mt-1.5`}
        />
      </label>

      {aiAvailable ? (
        <Inset className="mt-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="eyebrow">Tell the AI what to change</p>
            {selection ? (
              <button
                type="button"
                onClick={() => setSelection(null)}
                className="text-[11px] text-[#777169] underline underline-offset-2 hover:text-black"
              >
                Clear highlight
              </button>
            ) : (
              <span className="text-[11px] text-[#777169]">Highlight a passage to edit only that part</span>
            )}
          </div>

          {selection && (
            <p className="mt-2 text-[12px] leading-5 text-[#777169]">
              Editing <span className="text-black">“{snippet(selection.text)}”</span>
            </p>
          )}

          <div className="mt-2 flex gap-2">
            <input
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  apply();
                }
              }}
              disabled={disabled || working}
              placeholder={
                selection ? "Make this one sentence" : "Cut the last paragraph and mention my fencing award"
              }
              className="h-9 w-full rounded-lg border border-[#e5e5e5] bg-white px-3 text-[13px] text-black placeholder:text-[#777169] focus:border-black focus:outline-none disabled:opacity-50"
            />
            <button
              type="button"
              onClick={apply}
              disabled={disabled || working || !instruction.trim()}
              className="h-9 shrink-0 rounded-full border border-transparent bg-black px-4 text-[13px] font-medium text-[#fdfcfc] hover:bg-[#171717] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {working ? "Editing" : "Apply"}
            </button>
          </div>

          {error && <p className="mt-2 text-[12px] leading-5 text-[#ff4704]">{error}</p>}

          {applied && (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] leading-5">
              <span className="text-[#777169]">
                Applied <span className="text-black">“{snippet(applied.instruction, 48)}”</span>
              </span>
              {history.length > 0 && (
                <button type="button" onClick={undo} className="text-black underline underline-offset-2">
                  Undo
                </button>
              )}
              {applied.rule && (
                <>
                  <span className="text-[#777169]">and saved it for future emails</span>
                  <button
                    type="button"
                    onClick={forgetLastRule}
                    className="text-[#777169] underline underline-offset-2 hover:text-black"
                  >
                    Just this once
                  </button>
                </>
              )}
            </div>
          )}

          <div className="mt-3 border-t border-[#e5e5e5] pt-3">
            <button
              type="button"
              onClick={() => setShowRules((v) => !v)}
              className="text-[12px] text-black underline underline-offset-2"
            >
              {showRules ? "Hide" : "Show"} what you have taught it
              {rules.length > 0 && ` (${activeRules} of ${rules.length} on)`}
            </button>
            {showRules && (
              <div className="mt-3">
                <RulesPanel rules={rules} onChange={setRules} allowAdd />
                <p className="mt-3 text-[11px] leading-4 text-[#777169]">
                  Every instruction you type is kept and applied to your next email. Untick one to stop applying it
                  without losing it.
                </p>
              </div>
            )}
          </div>
        </Inset>
      ) : (
        <Inset className="mt-3">
          <p className="eyebrow">Tell the AI what to change</p>
          <p className="mt-2 text-[12px] leading-5 text-[#777169]">
            AI edits need an NVIDIA NIM key.{" "}
            <Link href="/settings" className="text-black underline underline-offset-2">
              Add one in settings
            </Link>{" "}
            and you can rewrite any passage by highlighting it and saying what to change. Editing the text above by hand
            works either way.
          </p>
        </Inset>
      )}
    </div>
  );
}
