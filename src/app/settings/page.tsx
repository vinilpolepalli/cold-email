"use client";

import { useCallback, useEffect, useState } from "react";

interface SettingsView {
  nimKeyMasked: string | null;
  nimModel: string | null;
  nimSource: "user" | "server" | "none";
}

interface ModelOption {
  id: string;
  label: string;
  recommended: boolean;
  speciality: boolean;
}

const fieldClass =
  "mt-1.5 w-full rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-sm text-black placeholder:text-[#777169] focus:border-black focus:outline-none";

const SOURCE_COPY: Record<SettingsView["nimSource"], string> = {
  user: "Drafts and summaries use your NVIDIA NIM key.",
  server: "Drafts and summaries use the server-wide NIM key. Add your own to override it.",
  none: "No key set, so the deterministic template engine writes drafts. Add a key for AI generation.",
};

export default function SettingsPage() {
  const [view, setView] = useState<SettingsView | null>(null);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [recommended, setRecommended] = useState("");
  const [nimApiKey, setNimApiKey] = useState("");
  const [nimModel, setNimModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState("");

  const loadModels = useCallback(async () => {
    const res = await fetch("/api/models");
    if (!res.ok) return;
    const data = await res.json();
    setModels(data.models ?? []);
    setRecommended(data.recommended ?? "");
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      const d = await fetch("/api/settings")
        .then((r) => r.json())
        .catch(() => null);
      if (cancelled) return;
      if (d?.settings) {
        setView(d.settings);
        setNimModel(d.settings.nimModel ?? "");
      }
      loadModels();
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [loadModels]);

  async function save(clearKey = false) {
    setBusy(true);
    setError("");
    try {
      const payload: Record<string, string> = { nimModel };
      if (clearKey) payload.nimApiKey = "";
      else if (nimApiKey.trim()) payload.nimApiKey = nimApiKey.trim();
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setView(data.settings);
      setNimApiKey("");
      setSavedAt(new Date().toLocaleTimeString());
      // A newly saved key can unlock models tied to the account.
      loadModels();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const hasKey = Boolean(view?.nimKeyMasked) || view?.nimSource === "server";
  const general = models.filter((m) => !m.speciality);
  const speciality = models.filter((m) => m.speciality);

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="text-2xl tracking-tight">Settings</h1>
      <p className="mt-1 text-sm text-[#777169]">
        Bring your own NVIDIA NIM key for AI-generated summaries, drafts, and scraper extraction. Get a free key at{" "}
        <a
          href="https://build.nvidia.com"
          target="_blank"
          rel="noreferrer"
          className="text-black underline underline-offset-2"
        >
          build.nvidia.com
        </a>
        .
      </p>

      <div className="mt-8 rounded-[14px] border border-[#e5e5e5] bg-white p-6">
        {view && (
          <p className="rounded-lg bg-[#f5f3f1] px-3 py-2 text-sm text-[#777169]">
            {SOURCE_COPY[view.nimSource]}
          </p>
        )}

        <label className="mt-5 block text-sm">
          <span className="eyebrow">NVIDIA NIM API key</span>
          <input
            type="password"
            value={nimApiKey}
            onChange={(e) => setNimApiKey(e.target.value)}
            placeholder={view?.nimKeyMasked ?? "nvapi-..."}
            autoComplete="off"
            className={fieldClass}
          />
          <span className="mt-1.5 block text-[11px] text-[#777169]">
            Stored server-side for your account and never shown again in full.
          </span>
        </label>

        <label className="mt-5 block text-sm">
          <span className="eyebrow">Model</span>
          <select
            value={nimModel}
            onChange={(e) => setNimModel(e.target.value)}
            disabled={!hasKey}
            className={`${fieldClass} disabled:cursor-not-allowed disabled:opacity-60`}
          >
            <option value="">
              {recommended ? `Recommended: ${recommended}` : "Recommended default"}
            </option>
            {general.length > 0 && (
              <optgroup label="General purpose">
                {general.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                    {m.recommended ? " (recommended)" : ""}
                  </option>
                ))}
              </optgroup>
            )}
            {speciality.length > 0 && (
              <optgroup label="Domain specific">
                {speciality.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <span className="mt-1.5 block text-[11px] text-[#777169]">
            {hasKey
              ? `${models.length} models available on the NVIDIA NIM free tier. Leave on the default to use ${recommended || "the recommended model"}.`
              : "Save an API key to choose a model."}
          </span>
        </label>

        {error && <p className="mt-3 text-[13px] text-[#ff4704]">{error}</p>}

        <div className="mt-6 flex items-center gap-4">
          <button
            onClick={() => save(false)}
            disabled={busy}
            className="inline-flex h-9 items-center rounded-full border border-[#e5e5e5] bg-black px-4 text-sm font-medium text-[#fdfcfc] hover:bg-[#171717] disabled:opacity-50"
          >
            Save settings
          </button>
          {view?.nimKeyMasked && (
            <button
              onClick={() => save(true)}
              disabled={busy}
              className="text-[13px] text-[#777169] hover:text-[#ff4704]"
            >
              Remove my key
            </button>
          )}
          {savedAt && <span className="text-[11px] text-[#15362b]">Saved {savedAt}</span>}
        </div>
      </div>
    </div>
  );
}
