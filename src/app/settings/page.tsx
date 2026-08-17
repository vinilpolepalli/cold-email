"use client";

import { useCallback, useEffect, useState } from "react";
import { EmailRule } from "@/lib/preferences";
import { RulesPanel } from "@/components/rules-panel";
import { TemplatePanel } from "@/components/template-panel";

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

interface TestResult {
  ok: boolean;
  model?: string;
  latencyMs?: number;
  usingServerKey?: boolean;
  reply?: string;
  reason?: string;
  error?: string;
}

/** What each failure actually means, rather than making the user read a 401. */
const TEST_REASON: Record<string, string> = {
  "no-key": "No key saved or entered. Paste one above first.",
  "bad-key": "NVIDIA rejected that key. Check it was copied whole from build.nvidia.com.",
  "bad-model": "The key works, but this model is not available to your account. Try the recommended one.",
  "slow-model":
    "Your key is valid, but this model did not answer in 20 seconds. Free-tier models idle when unused, so try again or pick another.",
  failed: "The request did not get through.",
};

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
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const [rules, setRules] = useState<EmailRule[]>([]);

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
      const prefs = await fetch("/api/preferences")
        .then((r) => r.json())
        .catch(() => null);
      if (!cancelled && Array.isArray(prefs?.rules)) setRules(prefs.rules);
      loadModels();
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [loadModels]);

  /**
   * A real call to the model. The key in the form field wins over the saved
   * one, so a new key can be checked before it is stored.
   */
  async function testConnection() {
    setTesting(true);
    setTest(null);
    setError("");
    try {
      const res = await fetch("/api/nim/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: nimApiKey.trim() || undefined, model: nimModel || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Test failed");
      setTest(data);
    } catch (err) {
      setTest({ ok: false, reason: "failed", error: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  }

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

        {test && (
          <div
            className={`mt-4 rounded-lg border px-3 py-2.5 text-[13px] ${
              test.ok ? "border-[#15362b]/20 bg-[#15362b]/5 text-[#15362b]" : "border-[#ff4704]/30 bg-[#ff4704]/5 text-[#ff4704]"
            }`}
          >
            {test.ok ? (
              <>
                <p className="font-medium">Connection works.</p>
                <p className="mt-0.5 text-[12px] opacity-80">
                  <span className="font-mono">{test.model}</span> replied in{" "}
                  <span className="font-mono">{test.latencyMs}ms</span>
                  {test.usingServerKey ? ", using the server key" : ""}.
                </p>
              </>
            ) : (
              <>
                <p className="font-medium">{TEST_REASON[test.reason ?? "failed"] ?? "The request did not get through."}</p>
                {test.error && <p className="mt-1 font-mono text-[11px] break-all opacity-80">{test.error}</p>}
              </>
            )}
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-4">
          <button
            onClick={() => save(false)}
            disabled={busy}
            className="inline-flex h-9 items-center rounded-full border border-[#e5e5e5] bg-black px-4 text-sm font-medium text-[#fdfcfc] hover:bg-[#171717] disabled:opacity-50"
          >
            Save settings
          </button>
          <button
            onClick={testConnection}
            disabled={testing || busy}
            className="inline-flex h-9 items-center rounded-full border border-[#e5e5e5] bg-white px-4 text-sm font-medium text-black hover:bg-[#f5f3f1] disabled:opacity-50"
          >
            {testing ? "Testing" : "Test connection"}
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

      {/* What the sender has taught the AI on past drafts. It accumulates
          silently while they edit emails, so there has to be one place that
          shows the whole list and lets them cut it back. */}
      <div className="mt-6 rounded-[14px] border border-[#e5e5e5] bg-white p-6">
        <h2 className="text-[15px] font-medium">How your emails should read</h2>
        <p className="mt-1 mb-4 text-[13px] leading-5 text-[#777169]">
          Anything you ask the AI to change while composing is kept here and applied to every email you write after it.
        </p>
        <RulesPanel rules={rules} onChange={setRules} allowAdd />
      </div>

      {/* The sender's own email. Rules describe a preference; this shows one,
          which is a far stronger signal for the draft than any instruction. */}
      <div className="mt-6">
        <TemplatePanel />
      </div>
    </div>
  );
}
