"use client";

import { useState } from "react";
import { SignInButton } from "@clerk/nextjs";
import { motion, useReducedMotion } from "motion/react";

interface Stats {
  researchers: number;
  withEmail: number;
  schools: string[];
}

const fieldClass =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-500 focus:border-orange-700 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-400 dark:focus:border-orange-400";

export default function WaitlistLanding({ stats, withClerk }: { stats: Stats; withClerk: boolean }) {
  const reduce = useReducedMotion();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [school, setSchool] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [joined, setJoined] = useState<{ position: number; alreadyOn: boolean } | null>(null);

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
      setJoined({ position: data.position, alreadyOn: data.alreadyOn });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <section className="mx-auto grid max-w-6xl gap-12 px-4 pt-16 pb-20 lg:grid-cols-[6fr_5fr] lg:gap-16">
        <div className="flex flex-col justify-center">
          <span className="text-xs font-medium uppercase tracking-[0.18em] text-orange-700 dark:text-orange-400">
            Private beta
          </span>
          <h1 className="mt-4 max-w-xl text-4xl font-semibold tracking-tighter text-balance md:text-5xl lg:text-6xl">
            Cold email the lab you actually want to join
          </h1>
          <p className="mt-5 max-w-md text-lg leading-relaxed text-zinc-600 dark:text-zinc-400">
            {stats.researchers} real AI and CS faculty across {stats.schools.length} universities. Upload your resume,
            get a draft written around their actual research, send it from your own Gmail.
          </p>

          <div className="mt-8 max-w-md">
            {joined ? (
              <motion.div
                initial={reduce ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                className="rounded-2xl border border-orange-700/30 bg-orange-50 p-6 dark:border-orange-400/30 dark:bg-orange-950/30"
              >
                <h2 className="font-semibold">
                  {joined.alreadyOn ? "You are already on the list" : "You are on the list"}
                </h2>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                  You are number {joined.position} in line. We will email you when your access opens up.
                </p>
              </motion.div>
            ) : (
              <form onSubmit={join} className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your name"
                    autoComplete="name"
                    className={fieldClass}
                  />
                  <input
                    value={school}
                    onChange={(e) => setSchool(e.target.value)}
                    placeholder="Your school (optional)"
                    autoComplete="organization"
                    className={fieldClass}
                  />
                </div>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@university.edu"
                  autoComplete="email"
                  className={fieldClass}
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full rounded-lg bg-orange-700 px-6 py-3 font-semibold text-white transition-transform hover:bg-orange-800 active:scale-[0.98] disabled:opacity-50"
                >
                  {busy ? "Saving your spot" : "Request early access"}
                </button>
                {error && <p className="text-sm text-red-700 dark:text-red-400">{error}</p>}
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {withClerk ? (
                    <>
                      Already have access?{" "}
                      <SignInButton mode="modal">
                        <button type="button" className="font-medium text-orange-700 hover:underline dark:text-orange-400">
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
          </div>
        </div>

        <div className="flex items-center">
          <div className="w-full rounded-2xl border border-zinc-200 bg-white p-8 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">What is inside</h2>
            <dl className="mt-6 space-y-6">
              {[
                { n: stats.researchers.toString(), label: "faculty profiles scraped from official university pages" },
                { n: stats.withEmail.toString(), label: "with an email published by their department" },
                { n: stats.schools.length.toString(), label: `universities: ${stats.schools.join(", ")}` },
              ].map((row) => (
                <div key={row.label}>
                  <dt className="font-mono text-3xl font-medium tabular-nums">{row.n}</dt>
                  <dd className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{row.label}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      <section className="border-t border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">How it works once you are in</h2>
          <div className="mt-10">
            {[
              {
                title: "Upload your resume",
                body: "PDF or plain text. It becomes a profile of your education, research, projects, and skills, with a summary you can edit.",
              },
              {
                title: "Pick a researcher",
                body: "Filter by school or research area. Every profile links back to the university page it came from.",
              },
              {
                title: "Review and send",
                body: "The draft is built from your background and their actual work, and cites the experience closest to their research. Edit anything, then send from your own Gmail.",
              },
            ].map((step) => (
              <div
                key={step.title}
                className="grid gap-2 border-t border-zinc-200 py-8 md:grid-cols-12 md:gap-6 dark:border-zinc-800"
              >
                <h3 className="text-lg font-medium md:col-span-4">{step.title}</h3>
                <p className="max-w-prose leading-relaxed text-zinc-600 md:col-span-7 md:col-start-6 dark:text-zinc-400">
                  {step.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
