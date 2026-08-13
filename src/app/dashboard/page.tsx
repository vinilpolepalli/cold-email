import Link from "next/link";
import { redirect } from "next/navigation";
import { getAllProfiles } from "@/lib/profiles";
import { getOutbox } from "@/lib/send";
import { getCurrentUserId, getUserProfile } from "@/lib/user";
import { recommendResearchers } from "@/lib/recommend";
import { ButtonLink, Card, Eyebrow, Pill, ScoreRing } from "@/components/ui";
import OutboxTable from "@/components/outbox-table";

export const dynamic = "force-dynamic";

// Pastel card tints, cycled in order, matching the reference's match cards.
const TINTS = ["bg-[#fef7e0]", "bg-[#e6f6ed]", "bg-[#eceaf8]", "bg-[#fdeceb]"];

export default async function DashboardPage() {
  const userId = await getCurrentUserId();
  if (!userId) redirect("/");

  const user = await getUserProfile(userId);
  // Without a profile there is nothing to recommend against, so send new users
  // straight into onboarding rather than showing an empty dashboard.
  if (!user) redirect("/onboarding");

  const [profiles, outbox] = await Promise.all([getAllProfiles(), getOutbox(userId)]);
  const contacted = new Set(outbox.map((e) => e.researcherId));
  const recommendations = recommendResearchers(user, profiles, { limit: 8, excludeIds: contacted });

  const sent = outbox.filter((e) => e.status === "sent").length;
  const queued = outbox.filter((e) => e.status === "queued").length;
  const failed = outbox.filter((e) => e.status === "failed").length;

  return (
    <div className="px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-[#777169]">
            {user.name}, {profiles.length} researchers indexed
          </p>
        </div>
        <div className="flex gap-2">
          <ButtonLink href="/researchers" variant="secondary">
            Browse researchers
          </ButtonLink>
          <ButtonLink href="/onboarding" variant="ghost">
            Edit profile
          </ButtonLink>
        </div>
      </div>

      {/* Outreach counters. */}
      <div className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-[14px] border border-[#e5e5e5] bg-[#e5e5e5] sm:grid-cols-4">
        {[
          { n: outbox.length, l: "emails" },
          { n: sent, l: "delivered" },
          { n: queued, l: "queued" },
          { n: contacted.size, l: "researchers contacted" },
        ].map((s) => (
          <div key={s.l} className="bg-white p-5">
            <div className="font-mono text-2xl">{s.n}</div>
            <div className="mt-1 text-[13px] text-[#777169]">{s.l}</div>
          </div>
        ))}
      </div>

      {failed > 0 && (
        <p className="mt-4 text-[13px] text-[#ff4704]">
          {failed} {failed === 1 ? "email" : "emails"} failed to send. Open the outbox for the provider error.
        </p>
      )}

      {/* Recommendations. */}
      <section className="mt-10">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-medium">Recommended for you</h2>
          <Link href="/researchers" className="text-[13px] text-[#777169] hover:text-black">
            Browse all ›
          </Link>
        </div>
        <p className="mt-1 text-[13px] text-[#777169]">
          Scored on overlap between your interests and skills and each lab&apos;s research areas.
        </p>

        {recommendations.length === 0 ? (
          <Card className="mt-4 p-8 text-center">
            <p className="text-sm font-medium">No matches yet</p>
            <p className="mx-auto mt-2 max-w-md text-[13px] text-[#777169]">
              Add research interests and skills to your profile and we can rank the directory against them.
            </p>
            <ButtonLink href="/onboarding" className="mt-5">
              Complete your profile
            </ButtonLink>
          </Card>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {recommendations.map((rec, i) => (
              <div key={rec.researcher.id} className="flex flex-col overflow-hidden rounded-[12px] border border-[#e5e5e5]">
                <div className={`${TINTS[i % TINTS.length]} flex-1 p-4`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[11px] text-[#777169]">{rec.researcher.school}</p>
                      <p className="mt-0.5 truncate text-sm font-medium">{rec.researcher.name}</p>
                    </div>
                    <ScoreRing value={rec.score} size={40} />
                  </div>
                  <p className="mt-2 line-clamp-2 text-[11px] leading-4 text-[#777169]">{rec.researcher.title}</p>
                  {rec.matchedOn.length > 0 && (
                    <p className="mt-2 truncate text-[11px] text-[#15362b]">matched on {rec.matchedOn.join(", ")}</p>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2 bg-white px-4 py-3">
                  <span className="truncate text-[11px] text-[#777169]">
                    {rec.researcher.email ? "email published" : "no public email"}
                  </span>
                  <ButtonLink
                    href={`/compose?researcher=${encodeURIComponent(rec.researcher.id)}`}
                    className="h-7 px-3 text-[12px]"
                  >
                    Draft
                  </ButtonLink>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Email tracker. */}
      <section className="mt-12">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-medium">Your outreach</h2>
          <Link href="/outbox" className="text-[13px] text-[#777169] hover:text-black">
            Full outbox ›
          </Link>
        </div>
        {outbox.length === 0 ? (
          <Card className="mt-4 p-8 text-center">
            <Eyebrow>Nothing sent yet</Eyebrow>
            <p className="mx-auto mt-2 max-w-md text-[13px] text-[#777169]">
              Pick a recommended researcher above, review the draft, and your sent emails will be tracked here.
            </p>
          </Card>
        ) : (
          <div className="mt-4">
            <OutboxTable entries={outbox.slice(0, 8)} />
          </div>
        )}
      </section>

      {!user.researchInterests.length && (
        <Card className="mt-10 flex flex-wrap items-center justify-between gap-4 p-5">
          <div>
            <p className="text-sm font-medium">Sharpen your matches</p>
            <p className="mt-1 text-[13px] text-[#777169]">
              You have no research interests saved. Adding two or three makes recommendations noticeably better.
            </p>
          </div>
          <Pill tone="accent">
            <ButtonLink href="/onboarding" variant="ghost" className="h-auto border-0 px-0 text-[13px] text-[#ff4704]">
              Add interests
            </ButtonLink>
          </Pill>
        </Card>
      )}
    </div>
  );
}
