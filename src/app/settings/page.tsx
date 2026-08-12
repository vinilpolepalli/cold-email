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
  "mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-500 focus:border-orange-700 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-400 dark:focus:border-orange-400";

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
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Bring your own NVIDIA NIM key for AI-generated summaries, drafts, and scraper extraction. Get a free key at{" "}
        <a
          href="https://build.nvidia.com"
          target="_blank"
          rel="noreferrer"
          className="text-orange-700 hover:underline dark:text-orange-400"
        >
          build.nvidia.com
        </a>
        .
      </p>

      <div className="mt-8 rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        {view && (
          <p className="rounded-lg bg-zinc-50 px-3 py-2 text-sm text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400">
            {SOURCE_COPY[view.nimSource]}
          </p>
        )}

        <label className="mt-5 block text-sm">
          <span className="font-medium">NVIDIA NIM API key</span>
          <input
            type="password"
            value={nimApiKey}
            onChange={(e) => setNimApiKey(e.target.value)}
            placeholder={view?.nimKeyMasked ?? "nvapi-..."}
            autoComplete="off"
            className={fieldClass}
          />
          <span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">
            Stored server-side for your account and never shown again in full.
          </span>
        </label>

        <label className="mt-5 block text-sm">
          <span className="font-medium">Model</span>
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
          <span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">
            {hasKey
              ? `${models.length} models available on the NVIDIA NIM free tier. Leave on the default to use ${recommended || "the recommended model"}.`
              : "Save an API key to choose a model."}
          </span>
        </label>

        {error && <p className="mt-3 text-sm text-red-700 dark:text-red-400">{error}</p>}

        <div className="mt-6 flex items-center gap-4">
          <button
            onClick={() => save(false)}
            disabled={busy}
            className="rounded-lg bg-orange-700 px-4 py-2 font-medium text-white transition-transform hover:bg-orange-800 active:scale-[0.98] disabled:opacity-50"
          >
            Save settings
          </button>
          {view?.nimKeyMasked && (
            <button
              onClick={() => save(true)}
              disabled={busy}
              className="text-sm font-medium text-zinc-500 hover:text-red-700 dark:text-zinc-400 dark:hover:text-red-400"
            >
              Remove my key
            </button>
          )}
          {savedAt && <span className="text-xs text-emerald-700 dark:text-emerald-400">Saved {savedAt}</span>}
        </div>
      </div>
    </div>
  );
}
