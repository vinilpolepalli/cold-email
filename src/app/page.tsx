import Link from "next/link";
import { getAllProfiles } from "@/lib/profiles";

export const dynamic = "force-dynamic";

export default function Home() {
  const profiles = getAllProfiles();
  const schools = [...new Set(profiles.map((p) => p.school))];
  const withEmail = profiles.filter((p) => p.email).length;

  return (
    <div className="space-y-12">
      <section className="pt-8 text-center">
        <h1 className="mx-auto max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">
          Cold email real researchers, <span className="text-indigo-600">without the cold start</span>
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-slate-600">
          {profiles.length} real AI &amp; CS faculty profiles scraped by AI agents from{" "}
          {schools.length ? schools.join(", ") : "top universities"} — {withEmail} with published emails. Upload your
          resume, get a personalized draft, review it, and hit send.
        </p>
        <div className="mt-8 flex justify-center gap-4">
          <Link
            href="/onboarding"
            className="rounded-lg bg-indigo-600 px-6 py-3 font-semibold text-white shadow hover:bg-indigo-700"
          >
            Start with your resume
          </Link>
          <Link
            href="/researchers"
            className="rounded-lg border border-slate-300 bg-white px-6 py-3 font-semibold text-slate-700 hover:border-indigo-400"
          >
            Browse researchers
          </Link>
        </div>
      </section>

      <section className="grid gap-6 sm:grid-cols-3">
        {[
          {
            step: "1",
            title: "Onboard",
            text: "Upload your resume (PDF or text). We parse your education, experience, and skills, and generate an AI summary you can edit.",
          },
          {
            step: "2",
            title: "Pick & personalize",
            text: "Filter faculty by school or research area. A draft is generated from your background and their actual research — tweak every word before it goes out.",
          },
          {
            step: "3",
            title: "Send",
            text: "One click sends from your own Gmail (via Google sign-in), SMTP, or Resend — or lands in the demo outbox when nothing is configured.",
          },
        ].map((c) => (
          <div key={c.step} className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 font-bold text-indigo-700">
              {c.step}
            </div>
            <h3 className="mt-3 font-semibold">{c.title}</h3>
            <p className="mt-1 text-sm text-slate-600">{c.text}</p>
          </div>
        ))}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
        <h3 className="font-semibold text-slate-900">How the directory is built</h3>
        <p className="mt-2">
          AI scraping agents crawl public faculty directories (Stanford CS/HAI/Biomedical Data Science, MIT
          EECS/CSAIL/Jameel Clinic, Harvard SEAS/Kempner/DBMI, Penn CIS &amp; Wharton) and extract each researcher&apos;s
          name, title, research areas, and published contact info. Emails are only included when a university page
          publishes them. You can also point the built-in <Link className="text-indigo-600 underline" href="/scrape">scraper</Link>{" "}
          at any faculty directory URL to add more.
        </p>
      </section>
    </div>
  );
}
