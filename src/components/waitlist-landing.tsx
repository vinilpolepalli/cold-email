"use client";

import { useState } from "react";
import { SignInButton } from "@clerk/nextjs";
import { Button, Card, Eyebrow, Inset, Pill, ScoreRing, SectionHeading } from "./ui";

interface Stats {
  researchers: number;
  withEmail: number;
  schools: string[];
}

const inputClass =
  "h-10 w-full rounded-lg border border-[#e5e5e5] bg-white px-3 text-sm text-black placeholder:text-[#777169] focus:border-black focus:outline-none";

export default function WaitlistLanding({ stats, withClerk }: { stats: Stats; withClerk: boolean }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [school, setSchool] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [joined, setJoined] = useState(false);

  async function join(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name, school }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not join the waitlist");
      setJoined(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {/* Hero: 96px rhythm, oversized 400-weight display, copy left and
          controls right, exactly as the reference stages it. */}
      <section className="container-page pt-20 pb-16">
        <Pill className="mb-8">
          <span className="h-1.5 w-1.5 rounded-full bg-[#ff4704]" />
          Private beta
        </Pill>

        <h1 className="display max-w-4xl text-balance">
          Email the lab you actually want to join. Not a template blast.
        </h1>

        <div className="mt-10 flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
          <p className="max-w-[640px] text-base leading-6 text-[#777169]">
            Sloan tracks {stats.researchers} AI and CS faculty across {stats.schools.length} universities, reads
            your resume, and writes each email around the professor&apos;s actual research. You review every word before
            it sends from your own Gmail.
          </p>
          <div className="shrink-0">
            <div className="flex flex-wrap gap-2">
              <a href="#access" className="inline-flex">
                <Button type="button">Request early access</Button>
              </a>
              <a href="#how" className="inline-flex">
                <Button type="button" variant="secondary">
                  See how it works
                </Button>
              </a>
            </div>
            <p className="mt-3 text-[13px] text-[#777169]">Invite only while we are in beta.</p>
          </div>
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-[#777169]">
          <span>Covering</span>
          {stats.schools.map((s) => (
            <span key={s}>{s}</span>
          ))}
        </div>

        {/* Product preview: the reference anchors its hero with a real UI
            rendering, so this mirrors the dashboard the user gets. */}
        <div className="mt-14 overflow-hidden rounded-[14px] border border-[#e5e5e5] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <DashboardPreview stats={stats} />
        </div>
      </section>

      {/* How it works: numbered cards with inset panels. */}
      <section id="how" className="container-page border-t border-[#e5e5e5] py-24">
        <SectionHeading
          eyebrow="How it works"
          title="Four steps between your resume and a reply"
          body="Nothing sends automatically. The agent does the research and the drafting; you keep the judgement."
        />
        <div className="mt-12 grid gap-4 md:grid-cols-2">
          <Card className="p-6">
            <Eyebrow>01 · Onboarding</Eyebrow>
            <h3 className="mt-3 text-[17px] font-medium">Your resume becomes a profile</h3>
            <p className="mt-2 text-sm leading-6 text-[#777169]">
              Upload a PDF. We pull out education, research, projects, publications, and skills, then let you correct
              anything in a few short cards.
            </p>
            <Inset className="mt-5 space-y-2">
              {["Education", "Research experience", "Projects", "Skills"].map((f) => (
                <div key={f} className="flex items-center justify-between text-[13px]">
                  <span className="text-[#777169]">{f}</span>
                  <span className="font-mono text-[11px] text-[#15362b]">parsed</span>
                </div>
              ))}
            </Inset>
          </Card>

          <Card className="p-6">
            <Eyebrow>02 · Matching</Eyebrow>
            <h3 className="mt-3 text-[17px] font-medium">Researchers ranked against your work</h3>
            <p className="mt-2 text-sm leading-6 text-[#777169]">
              Every faculty profile is scored on overlap with your interests and skills, so the shortlist is people who
              would actually want your email.
            </p>
            <Inset className="mt-5 space-y-3">
              {[
                { n: "Computational biology", v: 86 },
                { n: "Machine learning", v: 74 },
              ].map((r) => (
                <div key={r.n} className="flex items-center gap-3">
                  <ScoreRing value={r.v} size={34} />
                  <span className="text-[13px]">{r.n}</span>
                </div>
              ))}
            </Inset>
          </Card>

          <Card className="p-6">
            <Eyebrow>03 · Drafting</Eyebrow>
            <h3 className="mt-3 text-[17px] font-medium">A draft built on their actual research</h3>
            <p className="mt-2 text-sm leading-6 text-[#777169]">
              The email cites the experience closest to that lab&apos;s work, names what they study, and asks one clear
              question. Every word stays editable.
            </p>
            <Inset className="mt-5">
              <p className="text-[13px] leading-6">
                <span className="text-[#777169]">In the past, I have worked on the following related projects:</span>
                <br />- Protein-ligand GNN models reaching 0.984 ROC AUC
              </p>
            </Inset>
          </Card>

          <Card className="p-6" dark>
            <p className="eyebrow text-[#fdfcfc]/60">04 · Sending</p>
            <h3 className="mt-3 text-[17px] font-medium">From your address, with your resume attached</h3>
            <p className="mt-2 text-sm leading-6 text-[#fdfcfc]/70">
              Sign in with Google and the message leaves from your own Gmail, resume attached, so a reply lands in your
              inbox like any other email.
            </p>
            <div className="mt-5 rounded-lg border border-[#fdfcfc]/10 bg-[#fdfcfc]/5 p-4">
              <div className="flex items-center justify-between text-[13px]">
                <span className="text-[#fdfcfc]/70">Resume.pdf</span>
                <span className="font-mono text-[11px] text-[#ff4704]">attached</span>
              </div>
            </div>
          </Card>
        </div>
      </section>

      {/* Directory stats. */}
      <section id="directory" className="container-page border-t border-[#e5e5e5] py-24">
        <SectionHeading
          eyebrow="The directory"
          title="Built by scraping agents, not bought as a list"
          body="Agents crawl public faculty pages and keep a source link for every profile. An email is stored only when a university page publishes it."
        />
        <div className="mt-12 grid grid-cols-2 gap-px overflow-hidden rounded-[14px] border border-[#e5e5e5] bg-[#e5e5e5] sm:grid-cols-4">
          {[
            { n: stats.researchers, l: "faculty profiles" },
            { n: stats.withEmail, l: "published emails" },
            { n: stats.schools.length, l: "universities" },
            { n: 0, l: "guessed addresses" },
          ].map((s) => (
            <div key={s.l} className="bg-white p-6">
              <div className="font-mono text-3xl">{s.n}</div>
              <div className="mt-1 text-[13px] text-[#777169]">{s.l}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Waitlist form. */}
      <section id="access" className="container-page border-t border-[#e5e5e5] py-24">
        <div className="grid gap-12 lg:grid-cols-[1fr_460px]">
          <div>
            <SectionHeading
              eyebrow="Access"
              title="Request an invite"
              body="Sloan is invite only while we are in beta. Tell us where you study and we will open a seat when one is free."
            />
          </div>
          <Card className="p-6">
            {joined ? (
              <div className="py-6 text-center">
                <ScoreRing value={100} size={48} />
                <h3 className="mt-4 text-[17px] font-medium">You are on the list</h3>
                <p className="mt-2 text-sm text-[#777169]">
                  We will email you when a seat opens up.
                </p>
              </div>
            ) : (
              <form onSubmit={join} className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="eyebrow">Name</span>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Alex Rivera"
                      autoComplete="name"
                      className={`${inputClass} mt-1.5`}
                    />
                  </label>
                  <label className="block">
                    <span className="eyebrow">School</span>
                    <input
                      value={school}
                      onChange={(e) => setSchool(e.target.value)}
                      placeholder="Optional"
                      autoComplete="organization"
                      className={`${inputClass} mt-1.5`}
                    />
                  </label>
                </div>
                <label className="block">
                  <span className="eyebrow">Email</span>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@university.edu"
                    autoComplete="email"
                    className={`${inputClass} mt-1.5`}
                  />
                </label>
                <Button type="submit" disabled={busy} className="w-full">
                  {busy ? "Saving your spot" : "Request early access"}
                </Button>
                {error && <p className="text-[13px] text-[#ff4704]">{error}</p>}
                <p className="text-[13px] text-[#777169]">
                  {withClerk ? (
                    <>
                      Already have access?{" "}
                      <SignInButton mode="modal">
                        <button type="button" className="text-black underline underline-offset-2">
                          Sign in
                        </button>
                      </SignInButton>
                      .
                    </>
                  ) : (
                    "Set Clerk keys to enable sign-in."
                  )}
                </p>
              </form>
            )}
          </Card>
        </div>
      </section>
    </div>
  );
}

/** Static rendering of the real dashboard, used as the hero visual. */
function DashboardPreview({ stats }: { stats: Stats }) {
  const matches = [
    { name: "Ellen Zhong", school: "Princeton", area: "protein structure, cryo-EM", score: 86, tone: "bg-[#fef7e0]" },
    { name: "Ben Raphael", school: "Princeton", area: "cancer genomics", score: 79, tone: "bg-[#e6f6ed]" },
    { name: "Caroline Uhler", school: "MIT", area: "causal inference, genomics", score: 71, tone: "bg-[#eceaf8]" },
    { name: "Marinka Zitnik", school: "Harvard", area: "graph ML for medicine", score: 68, tone: "bg-[#fdeceb]" },
  ];
  return (
    <div className="flex min-h-[420px] text-left">
      <div className="hidden w-[190px] shrink-0 border-r border-[#e5e5e5] p-3 sm:block">
        <div className="flex items-center gap-2 px-2 py-1.5 text-[13px] font-medium">
          <span className="flex h-5 w-5 items-center justify-center rounded bg-black text-[10px] text-[#fdfcfc]">S</span>
          Sloan
        </div>
        <p className="eyebrow mt-4 px-2">Workspace</p>
        <div className="mt-1 space-y-0.5">
          {["Dashboard", "Researchers", "Outbox", "Scraper"].map((l, i) => (
            <div
              key={l}
              className={`flex items-center justify-between rounded-lg px-2 py-1.5 text-[13px] ${
                i === 0 ? "bg-[#f5f3f1] font-medium text-black" : "text-[#777169]"
              }`}
            >
              {l}
              {l === "Outbox" && (
                <span className="rounded-full bg-[#e5e5e5] px-1.5 font-mono text-[10px]">12</span>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="min-w-0 flex-1 p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-[15px] font-medium">Dashboard</h3>
          <span className="hidden h-8 items-center rounded-full bg-[#f5f3f1] px-3 text-[13px] text-[#777169] sm:inline-flex">
            Search {stats.researchers} researchers
          </span>
        </div>
        <div className="mt-5 flex items-center justify-between">
          <p className="text-[13px] font-medium">Recommended for you</p>
          <span className="text-[13px] text-[#777169]">Browse all ›</span>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {matches.map((m) => (
            <div key={m.name} className="overflow-hidden rounded-[10px] border border-[#e5e5e5]">
              <div className={`${m.tone} p-3`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[11px] text-[#777169]">{m.school}</p>
                    <p className="truncate text-[13px] font-medium">{m.name}</p>
                  </div>
                  <ScoreRing value={m.score} size={34} />
                </div>
                <p className="mt-2 truncate text-[11px] text-[#777169]">{m.area}</p>
              </div>
              <div className="flex items-center justify-between bg-white px-3 py-2">
                <span className="text-[11px] text-[#777169]">match</span>
                <span className="inline-flex h-6 items-center rounded-full bg-black px-2.5 text-[11px] text-[#fdfcfc]">
                  Draft
                </span>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-6 flex items-center gap-2">
          {["All", "Sent", "Replied", "Drafts"].map((f, i) => (
            <span
              key={f}
              className={`inline-flex h-7 items-center rounded-full border px-3 text-[11px] ${
                i === 0 ? "border-transparent bg-black text-[#fdfcfc]" : "border-[#e5e5e5] bg-white text-[#777169]"
              }`}
            >
              {f}
            </span>
          ))}
        </div>
        <div className="mt-3 overflow-hidden rounded-[10px] border border-[#e5e5e5]">
          <div className="grid grid-cols-[1.4fr_1fr_0.8fr] gap-2 border-b border-[#e5e5e5] bg-[#f5f3f1] px-3 py-2">
            {["Researcher", "Subject", "Status"].map((h) => (
              <span key={h} className="eyebrow">
                {h}
              </span>
            ))}
          </div>
          {[
            { r: "Danqi Chen", s: "Prospective researcher interested in NLP", st: "Sent" },
            { r: "Tri Dao", s: "Interested in efficient sequence models", st: "Sent" },
          ].map((row) => (
            <div key={row.r} className="grid grid-cols-[1.4fr_1fr_0.8fr] gap-2 px-3 py-2.5 text-[13px]">
              <span className="truncate">{row.r}</span>
              <span className="truncate text-[#777169]">{row.s}</span>
              <span className="text-[#15362b]">{row.st}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
