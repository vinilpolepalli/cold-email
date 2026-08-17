"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, Eyebrow, Pill } from "@/components/ui";
import type { CampaignTarget, CampaignSummary, SendPolicy } from "@/lib/campaign";
import type { RoutineReport } from "@/lib/routines/types";
import type { TrackState } from "@/lib/tracks";

// The campaign console: who is queued, what is written, when it goes, and who
// is allowed to send without being watched.
//
// The ordering on this page is deliberate. The mailbox comes first, because
// nothing else matters if email would leave from the wrong address. Then the
// review queue, because that is the daily job. Tracks and routines sit below,
// because they are set up once and then left alone.

interface TrackView {
  id: string;
  label: string;
  blurb: string;
  professors: number;
  reachable: number;
  state: TrackState;
  canArm: boolean;
  autoSending: boolean;
}

interface RoutineView {
  name: string;
  description: string;
  sends: boolean;
  lastRun: RoutineReport | null;
}

interface SenderView {
  email: string;
  connectedAt: string;
  canDetectReplies: boolean;
  lastError: string | null;
}

function when(iso: string | null | undefined): string {
  if (!iso) return "—";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "—";
  return at.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit", month: "short", day: "numeric" });
}

export default function CampaignConsole() {
  const [targets, setTargets] = useState<CampaignTarget[]>([]);
  const [summary, setSummary] = useState<CampaignSummary | null>(null);
  const [policy, setPolicy] = useState<SendPolicy | null>(null);
  const [tracks, setTracks] = useState<TrackView[]>([]);
  const [routines, setRoutines] = useState<RoutineView[]>([]);
  const [scheduled, setScheduled] = useState(false);
  const [sender, setSender] = useState<SenderView | null>(null);
  const [oauthConfigured, setOauthConfigured] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const [campaign, trackData, routineData, senderData] = await Promise.all([
      fetch("/api/campaign").then((r) => r.json()).catch(() => null),
      fetch("/api/tracks").then((r) => r.json()).catch(() => null),
      fetch("/api/routines").then((r) => r.json()).catch(() => null),
      fetch("/api/sender").then((r) => r.json()).catch(() => null),
    ]);
    if (campaign?.targets) {
      setTargets(campaign.targets);
      setSummary(campaign.summary);
      setPolicy(campaign.policy);
    }
    if (trackData?.tracks) setTracks(trackData.tracks);
    if (routineData?.routines) {
      setRoutines(routineData.routines);
      setScheduled(Boolean(routineData.scheduled));
    }
    if (senderData) {
      setSender(senderData.identity ?? null);
      setOauthConfigured(senderData.configured !== false);
    }
  }, []);

  // Deferred by a tick so the first paint is not a cascade of setState calls
  // from inside the effect body, matching how the settings page loads.
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  // The OAuth popup reports back here when the mailbox has been attached.
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      if (event.data?.source !== "sloan-google-oauth") return;
      if (event.data.ok) {
        setNotice(event.data.message ?? "Connected");
        setError("");
        void load();
      } else {
        setError(event.data.message ?? "Could not connect that account");
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [load]);

  async function connectSchoolAccount() {
    setError("");
    setBusy("connect");
    try {
      const res = await fetch("/api/auth/google/start");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not start the connection");
      window.open(data.url, "sloan-google", "width=520,height=680");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
    }
  }

  async function act(action: string, target: CampaignTarget, extra: Record<string, unknown> = {}) {
    setError("");
    setBusy(`${action}:${target.researcherId}`);
    try {
      const res = await fetch("/api/campaign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, researcherId: target.researcherId, ...extra }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "That did not work");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
    }
  }

  async function toggleTrack(track: TrackView) {
    setError("");
    setBusy(`track:${track.id}`);
    try {
      const res = await fetch("/api/tracks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackId: track.id, autonomous: !track.state.autonomous }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not change that track");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
    }
  }

  async function runRoutine(name: string, dryRun: boolean) {
    setError("");
    setNotice("");
    setBusy(`routine:${name}`);
    try {
      const res = await fetch(`/api/routines/${name}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun }),
      });
      const data = await res.json();
      if (data.report) setNotice(`${name}${dryRun ? " (dry run)" : ""}: ${data.report.summary}`);
      if (!res.ok && !data.report) throw new Error(data.error ?? "The routine failed");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
    }
  }

  const review = targets.filter((t) => t.status === "drafted" && !t.autoApproved);
  const upcoming = targets.filter((t) => t.status === "approved");
  const armedDrafts = targets.filter((t) => t.status === "drafted" && t.autoApproved);

  return (
    <div className="space-y-8">
      {error && (
        <div className="rounded-lg border border-[#ff4704]/30 bg-[#ff4704]/8 px-4 py-3 text-[13px] text-[#ff4704]">{error}</div>
      )}
      {notice && (
        <div className="rounded-lg border border-[#e5e5e5] bg-[#f5f3f1] px-4 py-3 text-[13px] text-black">{notice}</div>
      )}

      <SenderPanel
        sender={sender}
        configured={oauthConfigured}
        busy={busy === "connect"}
        onConnect={connectSchoolAccount}
        onDisconnect={async () => {
          await fetch("/api/sender", { method: "DELETE" });
          await load();
        }}
      />

      {summary && <SummaryRow summary={summary} policy={policy} />}

      <ReviewQueue targets={review} busy={busy} onAct={act} />

      {(upcoming.length > 0 || armedDrafts.length > 0) && (
        <Scheduled upcoming={upcoming} armed={armedDrafts} busy={busy} onAct={act} />
      )}

      <Tracks tracks={tracks} busy={busy} onToggle={toggleTrack} />

      <Routines routines={routines} scheduled={scheduled} busy={busy} onRun={runRoutine} />
    </div>
  );
}

// ── the mailbox ─────────────────────────────────────────────────────────────

function SenderPanel({
  sender,
  configured,
  busy,
  onConnect,
  onDisconnect,
}: {
  sender: SenderView | null;
  configured: boolean;
  busy: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  return (
    <Card className="p-5">
      <Eyebrow>Sending from</Eyebrow>
      {sender ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-black">{sender.email}</p>
            <p className="mt-1 text-[13px] text-[#777169]">
              Connected {when(sender.connectedAt)}.{" "}
              {sender.canDetectReplies
                ? "Replies are checked before any follow-up goes out."
                : "Read permission was not granted, so follow-ups cannot check for replies first."}
            </p>
            {sender.lastError && (
              <p className="mt-1 text-[13px] text-[#ff4704]">
                Last attempt failed: {sender.lastError}. Reconnect to fix it.
              </p>
            )}
          </div>
          <Button variant="secondary" onClick={onDisconnect}>
            Disconnect
          </Button>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-xl text-[13px] text-[#777169]">
            {configured
              ? "Connect the university account these emails should come from. Until you do, nothing is sent: a cold email from the wrong address is a different email as far as the professor reading it is concerned."
              : "Google OAuth is not configured on this server yet. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, then reload."}
          </p>
          <Button onClick={onConnect} disabled={busy || !configured}>
            {busy ? "Opening…" : "Connect school account"}
          </Button>
        </div>
      )}
    </Card>
  );
}

// ── counts ──────────────────────────────────────────────────────────────────

function SummaryRow({ summary, policy }: { summary: CampaignSummary; policy: SendPolicy | null }) {
  const cells: [string, string | number][] = [
    ["Waiting on you", summary.awaitingReview],
    ["Approved", summary.approved],
    ["Queued", summary.queued],
    ["Sent", summary.sent],
    ["Replied", summary.replied],
    ["Sent in 24h", policy ? `${summary.sentLastDay} / ${policy.maxPerDay}` : summary.sentLastDay],
    ["Next send", when(summary.nextScheduledAt)],
  ];
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-[#e5e5e5] bg-[#e5e5e5] sm:grid-cols-4 lg:grid-cols-7">
      {cells.map(([label, value]) => (
        <div key={label} className="bg-white px-4 py-3">
          <p className="eyebrow">{label}</p>
          <p className="mt-1 truncate text-sm text-black">{value}</p>
        </div>
      ))}
    </div>
  );
}

// ── the daily job ───────────────────────────────────────────────────────────

function ReviewQueue({
  targets,
  busy,
  onAct,
}: {
  targets: CampaignTarget[];
  busy: string;
  onAct: (action: string, target: CampaignTarget, extra?: Record<string, unknown>) => void;
}) {
  return (
    <section>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-lg tracking-tight">Waiting for your review</h2>
          <p className="mt-1 text-[13px] text-[#777169]">
            Read it, fix anything that is off, then approve. Approving is what teaches a track it is ready.
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {targets.length === 0 ? (
          <Card className="p-8 text-center">
            <Eyebrow>Nothing to review</Eyebrow>
            <p className="mx-auto mt-2 max-w-sm text-[13px] text-[#777169]">
              Run <span className="font-mono text-black">write-drafts</span> below, or wait for tonight&apos;s run.
            </p>
          </Card>
        ) : (
          targets.map((target) => (
            <DraftCard key={target.researcherId} target={target} busy={busy} onAct={onAct} />
          ))
        )}
      </div>
    </section>
  );
}

function DraftCard({
  target,
  busy,
  onAct,
}: {
  target: CampaignTarget;
  busy: string;
  onAct: (action: string, target: CampaignTarget, extra?: Record<string, unknown>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState(target.subject ?? "");
  const [body, setBody] = useState(target.body ?? "");

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-black">{target.researcherName}</p>
            <Pill tone="muted">{target.school}</Pill>
            <Pill tone="muted">{target.trackId}</Pill>
            <span className="font-mono text-[11px] text-[#777169]">rank {target.rank}</span>
          </div>
          <p className="mt-1 truncate text-[13px] text-[#777169]">{target.to}</p>
          {target.reasons.length > 0 && (
            <p className="mt-1 text-[13px] text-[#777169]">{target.reasons.join(" · ")}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="ghost" onClick={() => setOpen((v) => !v)}>
            {open ? "Hide" : "Read"}
          </Button>
          <Button
            variant="secondary"
            disabled={busy.startsWith("skip")}
            onClick={() => onAct("skip", target)}
          >
            Skip
          </Button>
          <Button
            disabled={busy.startsWith("approve")}
            onClick={() => onAct("approve", target, { subject, body })}
          >
            Approve
          </Button>
        </div>
      </div>

      <p className="mt-2 text-[13px] text-[#777169]">
        Scheduled for {when(target.scheduledAt)}
        {target.note ? ` · ${target.note}` : ""}
      </p>

      {open && (
        <div className="mt-4 space-y-3 border-t border-[#e5e5e5] pt-4">
          <div>
            <label className="eyebrow" htmlFor={`subject-${target.researcherId}`}>
              Subject
            </label>
            <input
              id={`subject-${target.researcherId}`}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-sm text-black focus:border-black focus:outline-none"
            />
          </div>
          <div>
            <label className="eyebrow" htmlFor={`body-${target.researcherId}`}>
              Body
            </label>
            <textarea
              id={`body-${target.researcherId}`}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={16}
              className="mt-1.5 w-full rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 font-mono text-[13px] leading-relaxed text-black focus:border-black focus:outline-none"
            />
          </div>
          <p className="text-[13px] text-[#777169]">
            Edits here are what gets sent. Your resume is attached automatically.
          </p>
        </div>
      )}
    </Card>
  );
}

// ── what is going out ───────────────────────────────────────────────────────

function Scheduled({
  upcoming,
  armed,
  busy,
  onAct,
}: {
  upcoming: CampaignTarget[];
  armed: CampaignTarget[];
  busy: string;
  onAct: (action: string, target: CampaignTarget, extra?: Record<string, unknown>) => void;
}) {
  const rows = [...upcoming, ...armed].sort((a, b) => (a.scheduledAt ?? "").localeCompare(b.scheduledAt ?? ""));
  return (
    <section>
      <h2 className="text-lg tracking-tight">Going out</h2>
      <p className="mt-1 text-[13px] text-[#777169]">
        Pull anything back before its time and it returns to the review queue.
      </p>
      <Card className="mt-4 divide-y divide-[#e5e5e5] p-0">
        {rows.map((target) => (
          <div key={target.researcherId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm text-black">{target.researcherName}</p>
                <Pill tone="muted">{target.school}</Pill>
                {target.autoApproved && <Pill tone="accent">armed track</Pill>}
              </div>
              <p className="mt-0.5 truncate text-[13px] text-[#777169]">{target.subject}</p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="text-[13px] text-[#777169]">{when(target.scheduledAt)}</span>
              <Button
                variant="secondary"
                disabled={busy.startsWith("unapprove")}
                onClick={() => onAct("unapprove", target)}
              >
                Hold
              </Button>
            </div>
          </div>
        ))}
      </Card>
    </section>
  );
}

// ── the gates ───────────────────────────────────────────────────────────────

function Tracks({
  tracks,
  busy,
  onToggle,
}: {
  tracks: TrackView[];
  busy: string;
  onToggle: (track: TrackView) => void;
}) {
  return (
    <section>
      <h2 className="text-lg tracking-tight">Tracks</h2>
      <p className="mt-1 text-[13px] text-[#777169]">
        Autonomy is earned per research area. Approve a couple by hand first, then arm the track and it sends without
        waiting for you.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {tracks.map((track) => {
          const remaining = Math.max(0, track.state.unlockAt - track.state.reviewedSends);
          return (
            <Card key={track.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm text-black">{track.label}</p>
                  <p className="mt-1 text-[13px] text-[#777169]">{track.blurb}</p>
                </div>
                {track.autoSending ? (
                  <Pill tone="solid">armed</Pill>
                ) : track.canArm ? (
                  <Pill tone="accent">ready</Pill>
                ) : (
                  <Pill tone="muted">locked</Pill>
                )}
              </div>

              <p className="mt-3 text-[13px] text-[#777169]">
                {track.reachable} reachable of {track.professors} in campaign schools ·{" "}
                {track.state.reviewedSends} approved by you
              </p>

              <div className="mt-3 flex items-center gap-3">
                <Button
                  variant={track.state.autonomous ? "secondary" : "primary"}
                  disabled={busy === `track:${track.id}` || (!track.canArm && !track.state.autonomous)}
                  onClick={() => onToggle(track)}
                >
                  {track.state.autonomous ? "Disarm" : "Arm autonomous sending"}
                </Button>
                {!track.canArm && !track.state.autonomous && (
                  <span className="text-[13px] text-[#777169]">
                    {remaining} more approval{remaining === 1 ? "" : "s"} needed
                  </span>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

// ── the machinery ───────────────────────────────────────────────────────────

function Routines({
  routines,
  scheduled,
  busy,
  onRun,
}: {
  routines: RoutineView[];
  scheduled: boolean;
  busy: string;
  onRun: (name: string, dryRun: boolean) => void;
}) {
  return (
    <section>
      <h2 className="text-lg tracking-tight">Routines</h2>
      <p className="mt-1 text-[13px] text-[#777169]">
        {scheduled
          ? "A scheduler can run these unattended. You can also run any of them right now."
          : "ROUTINE_SECRET is not set, so nothing runs unattended yet. You can still run them by hand here."}
      </p>
      <Card className="mt-4 divide-y divide-[#e5e5e5] p-0">
        {routines.map((routine) => (
          <div key={routine.name} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[13px] text-black">{routine.name}</span>
                {routine.sends && <Pill tone="accent">sends email</Pill>}
              </div>
              <p className="mt-0.5 text-[13px] text-[#777169]">{routine.description}</p>
              {routine.lastRun && (
                <p className="mt-1 text-[13px] text-[#777169]">
                  Last run {when(routine.lastRun.startedAt)}
                  {routine.lastRun.dryRun ? " (dry run)" : ""}: {routine.lastRun.summary}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {routine.sends && (
                <Button
                  variant="ghost"
                  disabled={busy === `routine:${routine.name}`}
                  onClick={() => onRun(routine.name, true)}
                >
                  Dry run
                </Button>
              )}
              <Button
                variant="secondary"
                disabled={busy === `routine:${routine.name}`}
                onClick={() => onRun(routine.name, false)}
              >
                {busy === `routine:${routine.name}` ? "Running…" : "Run"}
              </Button>
            </div>
          </div>
        ))}
      </Card>
    </section>
  );
}
