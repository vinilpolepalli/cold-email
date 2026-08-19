"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, Eyebrow, Pill } from "@/components/ui";
import type { EmailTemplate, TemplateMode } from "@/lib/user-template";

// Where the sender pastes the cold email they already write by hand.
//
// One default plus an override per track, because the email that works on a
// robotics lab is not the one that works on a genomics lab, and the per-track
// approval gate only means something if the thing being approved is per track
// too.

const SLOTS: { id: string; label: string; hint: string }[] = [
  { id: "default", label: "Default", hint: "Used by any track without its own template." },
  { id: "cs-core", label: "Pure CS", hint: "Theory, algorithms, systems, ML and NLP foundations." },
  { id: "cs-bio", label: "CS + Bio", hint: "Computational biology, genomics, neuro, health AI." },
  { id: "cs-robotics", label: "CS + Robotics", hint: "Robotics, computer vision, control, autonomy." },
  { id: "cs-other", label: "Other areas", hint: "Statistics, HCI, social, everything else." },
];

const MODE_COPY: Record<TemplateMode, string> = {
  skeleton: "Follow this structure closely, swapping in each professor's specifics.",
  reference: "Match the voice and length, but write each email fresh.",
};

export function TemplatePanel() {
  const [templates, setTemplates] = useState<Record<string, EmailTemplate | null>>({});
  const [slot, setSlot] = useState("default");
  const [text, setText] = useState("");
  const [mode, setMode] = useState<TemplateMode>("skeleton");
  const [maxLength, setMaxLength] = useState(6000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState("");

  const load = useCallback(async () => {
    const data = await fetch("/api/templates").then((r) => r.json()).catch(() => null);
    if (!data?.templates) return;
    setTemplates(data.templates);
    if (data.maxLength) setMaxLength(data.maxLength);
    return data.templates as Record<string, EmailTemplate | null>;
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void load().then((loaded) => {
        // Open on the default slot's saved text, so the panel shows what is
        // actually in force rather than an empty box over a stored template.
        const current = loaded?.default;
        if (current) {
          setText(current.text);
          setMode(current.mode);
        }
      });
    }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  // Switching slots shows whatever is stored for that slot, not what was being
  // typed in the previous one.
  function selectSlot(next: string) {
    setSlot(next);
    setSavedAt("");
    const stored = templates[next];
    setText(stored?.text ?? "");
    setMode(stored?.mode ?? "skeleton");
  }

  async function save() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/templates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackId: slot, text, mode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save that");
      setTemplates(data.templates ?? {});
      setSavedAt(new Date().toLocaleTimeString());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/templates?trackId=${encodeURIComponent(slot)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not remove that");
      setTemplates(data.templates ?? {});
      setText("");
      setSavedAt("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Eyebrow>Your cold email template</Eyebrow>
          <p className="mt-2 max-w-2xl text-[13px] text-[#777169]">
            Paste an email you have actually sent. Every draft is shaped like it. Names, papers and numbers inside it
            stay behind: they belong to whoever it was originally written to, and are replaced with the real details of
            each professor.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {SLOTS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => selectSlot(s.id)}
            className={`rounded-full border px-3 py-1 text-[13px] leading-none transition-colors ${
              slot === s.id
                ? "border-transparent bg-black text-[#fdfcfc]"
                : "border-[#e5e5e5] bg-white text-[#777169] hover:text-black"
            }`}
          >
            {s.label}
            {templates[s.id] ? " ·" : ""}
          </button>
        ))}
      </div>

      <p className="mt-2 text-[13px] text-[#777169]">{SLOTS.find((s) => s.id === slot)?.hint}</p>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, maxLength))}
        rows={14}
        placeholder={
          slot === "default"
            ? "Dear Professor ___,\n\nI am a ___ at ___ and I read your paper on ___…"
            : "Leave this empty to fall back to the default template."
        }
        className="mt-3 w-full rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 font-mono text-[13px] leading-relaxed text-black placeholder:text-[#777169] focus:border-black focus:outline-none"
      />

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {(["skeleton", "reference"] as TemplateMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-full border px-3 py-1 text-[13px] leading-none transition-colors ${
                mode === m
                  ? "border-transparent bg-black text-[#fdfcfc]"
                  : "border-[#e5e5e5] bg-white text-[#777169] hover:text-black"
              }`}
            >
              {m}
            </button>
          ))}
          <span className="text-[13px] text-[#777169]">{MODE_COPY[mode]}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-[#777169]">
            {text.length}/{maxLength}
          </span>
          {templates[slot] && (
            <Button variant="ghost" onClick={clear} disabled={busy}>
              Remove
            </Button>
          )}
          <Button onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save template"}
          </Button>
        </div>
      </div>

      {savedAt && <p className="mt-2 text-[13px] text-[#777169]">Saved at {savedAt}.</p>}
      {error && <p className="mt-2 text-[13px] text-[#ff4704]">{error}</p>}

      {Object.entries(templates).some(([, v]) => v) && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[#e5e5e5] pt-3">
          <span className="eyebrow">Saved</span>
          {SLOTS.filter((s) => templates[s.id]).map((s) => (
            <Pill key={s.id} tone="muted">
              {s.label} · {templates[s.id]?.mode}
            </Pill>
          ))}
        </div>
      )}
    </Card>
  );
}
