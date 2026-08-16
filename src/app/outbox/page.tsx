import { redirect } from "next/navigation";
import { getOutbox } from "@/lib/send";
import { getScheduled, runDueSends } from "@/lib/schedule";
import { getCurrentUserId } from "@/lib/user";
import { Card, Eyebrow, ButtonLink } from "@/components/ui";
import OutboxTable from "@/components/outbox-table";
import ScheduledTable from "@/components/scheduled-table";

export const dynamic = "force-dynamic";

export default async function OutboxPage() {
  const userId = await getCurrentUserId();
  if (!userId) redirect("/");
  // Flush anything already due before reading, so the page never shows an
  // email as "scheduled" for a time that has passed. This is also what makes
  // scheduling work when the cron only fires once a day.
  await runDueSends().catch(() => undefined);
  const [entries, scheduled] = await Promise.all([getOutbox(userId), getScheduled(userId)]);
  const waiting = scheduled.filter((s) => s.status === "scheduled" || s.status === "sending");

  return (
    <div className="px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl tracking-tight">Outbox</h1>
          <p className="mt-1 text-sm text-[#777169]">
            Every send attempt, including drafts queued locally when no provider is configured.
          </p>
        </div>
        <ButtonLink href="/researchers" variant="secondary">
          Find someone to email
        </ButtonLink>
      </div>

      {scheduled.length > 0 && (
        <div className="mt-8">
          {/* The list holds recently finished ones too, so the heading names
              the section and the count qualifies it, rather than claiming the
              whole list is still waiting. */}
          <Eyebrow>Scheduled</Eyebrow>
          <p className="mt-1 text-[13px] text-[#777169]">
            {waiting.length > 0
              ? `${waiting.length} waiting to send. Cancel any of them up until they go out.`
              : "Nothing waiting. These went out or were canceled."}
          </p>
          <div className="mt-3">
            <ScheduledTable entries={scheduled} />
          </div>
        </div>
      )}

      <div className="mt-8">
        {entries.length > 0 ? (
          <>
            {scheduled.length > 0 && <Eyebrow>Already sent</Eyebrow>}
            <div className={scheduled.length > 0 ? "mt-3" : ""}>
              <OutboxTable entries={entries} />
            </div>
          </>
        ) : (
          // With something queued, an empty sent list is not an empty page, so
          // the "nothing here yet" prompt would be wrong.
          scheduled.length === 0 && (
            <Card className="p-10 text-center">
              <Eyebrow>Nothing sent yet</Eyebrow>
              <p className="mx-auto mt-2 max-w-sm text-[13px] text-[#777169]">
                Pick a researcher, review the draft, and every email you send will be tracked here with its status.
              </p>
              <ButtonLink href="/dashboard" className="mt-5">
                See recommendations
              </ButtonLink>
            </Card>
          )
        )}
      </div>
    </div>
  );
}
