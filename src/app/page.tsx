import Link from "next/link";
import { getAllProfiles } from "@/lib/profiles";
import HeroPreview from "@/components/hero-preview";
import { Reveal } from "@/components/reveal";

export const dynamic = "force-dynamic";

const STEPS = [
  {
    title: "Upload your resume",
    body: "PDF or plain text. We parse your education, experience, projects, and skills into a profile, then write a short summary you can edit.",
  },
  {
    title: "Review the draft",
    body: "Pick a researcher and get a draft built from your background and their actual work. Every word stays editable before anything goes out.",
  },
  {
    title: "Send from your Gmail",
    body: "Sign in with Google and the email leaves from your own address. SMTP and Resend work too, and with nothing configured it lands in a local outbox.",
  },
];

export default async function Home() {
  const profiles = await getAllProfiles();
  const withEmail = profiles.filter((p) => p.email).length;
  const schools = [...new Set(profiles.map((p) => p.school))];
  const areas = new Set(profiles.flatMap((p) => p.researchAreas.map((a) => a.toLowerCase())));

  // Real component preview: pick three profiles from different schools.
  const preview: typeof profiles = [];
  for (const school of schools) {
    const p = profiles.find((x) => x.school === school && x.email) ?? profiles.find((x) => x.school === school);
    if (p) preview.push(p);
    if (preview.length === 3) break;
  }

  return (
    <div>
      {/* Hero: asymmetric split, single primary CTA */}
      <section className="mx-auto grid max-w-6xl gap-12 px-4 pt-16 pb-20 lg:grid-cols-[7fr_5fr] lg:gap-16">
        <div className="flex flex-col justify-center">
          <h1 className="max-w-xl text-4xl font-semibold tracking-tighter text-balance md:text-5xl lg:text-6xl">
            Cold email the lab you actually want to join
          </h1>
          <p className="mt-5 max-w-md text-lg leading-relaxed text-zinc-600 dark:text-zinc-400">
            Real AI and CS faculty from four top schools. A draft built from your resume, sent from your own Gmail.
          </p>
          <div className="mt-8">
            <Link
              href="/onboarding"
              className="inline-block rounded-lg bg-orange-700 px-6 py-3 font-semibold text-white transition-transform hover:bg-orange-800 active:scale-[0.98]"
            >
              Upload your resume
            </Link>
          </div>
        </div>
        <HeroPreview profiles={preview} />
      </section>

      {/* Stats: real data from the scraped directory */}
      <section className="border-y border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto grid max-w-6xl grid-cols-2 divide-zinc-200 px-4 sm:grid-cols-4 sm:divide-x dark:divide-zinc-800">
          {[
            { n: profiles.length, label: profiles.length === 1 ? "researcher" : "researchers" },
            { n: withEmail, label: withEmail === 1 ? "published email" : "published emails" },
            { n: schools.length, label: schools.length === 1 ? "university" : "universities" },
            { n: areas.size, label: areas.size === 1 ? "research area" : "research areas" },
          ].map((s) => (
            <div key={s.label} className="py-8 sm:px-8 sm:first:pl-0">
              <div className="font-mono text-3xl font-medium tabular-nums">{s.n}</div>
              <div className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* How it works: editorial rows, no cards */}
      <section className="mx-auto max-w-6xl px-4 py-20">
        <Reveal>
          <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">Three steps, nothing hidden</h2>
        </Reveal>
        <div className="mt-10">
          {STEPS.map((step, i) => (
            <Reveal key={step.title} delay={i * 0.06}>
              <div className="grid gap-2 border-t border-zinc-200 py-8 md:grid-cols-12 md:gap-6 dark:border-zinc-800">
                <h3 className="text-lg font-medium md:col-span-4">{step.title}</h3>
                <p className="max-w-prose leading-relaxed text-zinc-600 md:col-span-7 md:col-start-6 dark:text-zinc-400">
                  {step.body}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Directory + scraper: tinted band, distinct CTAs */}
      <section className="bg-zinc-100 dark:bg-zinc-900">
        <div className="mx-auto max-w-6xl px-4 py-20">
          <Reveal>
            <h2 className="max-w-2xl text-2xl font-semibold tracking-tight md:text-3xl">
              A directory built by scraping agents, not a stale spreadsheet
            </h2>
            <p className="mt-4 max-w-prose leading-relaxed text-zinc-600 dark:text-zinc-400">
              AI agents crawl public faculty directories at Stanford, Harvard, MIT, and Penn, including Wharton,
              CS+bio, and AI+health labs. They keep names, titles, research areas, and a source link for every
              profile. An email is stored only when a university page publishes it. Point the built-in scraper at any
              other directory to grow the list.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-5">
              <Link
                href="/researchers"
                className="rounded-lg border border-zinc-400 bg-white px-5 py-2.5 font-medium text-zinc-900 transition-colors hover:border-orange-700 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:border-orange-400"
              >
                Browse all {profiles.length} researchers
              </Link>
              <Link
                href="/scrape"
                className="font-medium text-orange-700 hover:underline dark:text-orange-400"
              >
                Run the scraper yourself
              </Link>
            </div>
          </Reveal>
        </div>
      </section>
    </div>
  );
}
