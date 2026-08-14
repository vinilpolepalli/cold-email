import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getProfile } from "@/lib/profiles";
import { getPublications } from "@/lib/publications";
import { ResearcherProfile } from "@/lib/types";
import PublicationList from "@/components/publication-list";
import { ButtonLink, Card, Eyebrow, Pill } from "@/components/ui";

// The profile the user reads before writing to someone: what the lab works on,
// what they have published, and where to read it in full. Publications come
// from a live lookup, so they stream in under the profile rather than holding
// the whole page.

export const dynamic = "force-dynamic";

function scholarSearch(researcher: ResearcherProfile): string {
  return `https://scholar.google.com/scholar?q=${encodeURIComponent(`${researcher.name} ${researcher.school}`)}`;
}

function PublicationsSkeleton() {
  return (
    <div className="mt-5 animate-pulse space-y-5">
      {[0, 1, 2].map((i) => (
        <div key={i} className="border-t border-[#e5e5e5] pt-5 first:border-t-0 first:pt-0">
          <div className="h-4 w-3/4 rounded bg-[#f5f3f1]" />
          <div className="mt-2 h-3 w-1/3 rounded bg-[#f5f3f1]" />
          <div className="mt-3 h-3 w-full rounded bg-[#f5f3f1]" />
        </div>
      ))}
    </div>
  );
}

async function Publications({ researcher }: { researcher: ResearcherProfile }) {
  const works = await getPublications(researcher);

  if (works.publications.length === 0) {
    return (
      <div className="mt-5 rounded-lg bg-[#f5f3f1] p-5">
        <p className="text-[13px] leading-5 text-[#777169]">
          We could not confidently match this name to a publication record, so nothing is listed rather than risk
          showing someone else&apos;s papers. Their own page usually has a full list.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a
            href={researcher.website ?? researcher.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-7 items-center rounded-full border border-[#e5e5e5] bg-white px-3 text-[12px] text-[#777169] hover:border-black hover:text-black"
          >
            Faculty page
          </a>
          <a
            href={scholarSearch(researcher)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-7 items-center rounded-full border border-[#e5e5e5] bg-white px-3 text-[12px] text-[#777169] hover:border-black hover:text-black"
          >
            Search Google Scholar
          </a>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-[#777169]">
        {typeof works.worksCount === "number" && (
          <span>
            <span className="font-mono">{works.worksCount.toLocaleString()}</span> indexed works
          </span>
        )}
        {typeof works.citedByCount === "number" && works.citedByCount > 0 && (
          <span>
            <span className="font-mono">{works.citedByCount.toLocaleString()}</span> total citations
          </span>
        )}
        <span>via {works.provider === "openalex" ? "OpenAlex" : "Crossref"}</span>
      </div>
      <PublicationList publications={works.publications} />
      {works.authorUrl && (
        <a
          href={works.authorUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-4 inline-block text-[12px] text-[#777169] underline underline-offset-2 hover:text-black"
        >
          Full publication record
        </a>
      )}
    </>
  );
}

export default async function ResearcherProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const researcher = await getProfile(id);
  if (!researcher) notFound();

  return (
    <div className="px-6 py-8">
      <Link href="/researchers" className="text-[13px] text-[#777169] underline underline-offset-2 hover:text-black">
        Researchers
      </Link>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0 max-w-2xl">
          <h1 className="text-[32px] leading-[1.1] tracking-[-0.6px]">{researcher.name}</h1>
          <p className="mt-2 text-sm leading-6 text-[#777169]">{researcher.title}</p>
          <p className="mt-1 text-[13px] text-[#777169]">
            {researcher.department}
            {researcher.department && researcher.school ? " · " : ""}
            {researcher.school}
          </p>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {researcher.researchAreas.map((area) => (
              <Pill key={area} tone="muted" className="px-2.5 py-1 text-[12px]">
                {area}
              </Pill>
            ))}
          </div>
        </div>

        <ButtonLink href={`/compose?researcher=${encodeURIComponent(researcher.id)}`} className="shrink-0">
          Draft an email
        </ButtonLink>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="space-y-6">
          {researcher.bio && (
            <Card className="p-6">
              <Eyebrow>What they work on</Eyebrow>
              <p className="mt-3 text-sm leading-6">{researcher.bio}</p>
            </Card>
          )}

          <Card className="p-6">
            <Eyebrow>Selected work</Eyebrow>
            <Suspense fallback={<PublicationsSkeleton />}>
              <Publications researcher={researcher} />
            </Suspense>
          </Card>
        </div>

        <aside className="space-y-6">
          <Card className="p-5">
            <Eyebrow>Contact</Eyebrow>
            {researcher.email ? (
              <p className="mt-3 font-mono text-[13px] break-all">{researcher.email}</p>
            ) : (
              <p className="mt-3 text-[13px] text-[#777169]">
                No email is published on their department page, so we do not store one. Their faculty page usually
                lists a way to reach the lab.
              </p>
            )}
            <p className="mt-3 text-[11px] leading-4 text-[#777169]">
              Addresses are only ever copied from official university pages, never constructed.
            </p>
          </Card>

          <Card className="p-5">
            <Eyebrow>Links</Eyebrow>
            <ul className="mt-3 space-y-2 text-[13px]">
              {researcher.website && (
                <li>
                  <a
                    href={researcher.website}
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-2 hover:text-[#ff4704]"
                  >
                    Lab or personal site
                  </a>
                </li>
              )}
              <li>
                <a
                  href={researcher.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2 hover:text-[#ff4704]"
                >
                  Department profile
                </a>
              </li>
              <li>
                <a
                  href={scholarSearch(researcher)}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2 hover:text-[#ff4704]"
                >
                  Google Scholar search
                </a>
              </li>
            </ul>
          </Card>
        </aside>
      </div>
    </div>
  );
}
