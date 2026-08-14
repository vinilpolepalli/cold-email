import { redirect } from "next/navigation";
import { getOutbox } from "@/lib/send";
import { getCurrentUserId } from "@/lib/user";
import { Card, Eyebrow, ButtonLink } from "@/components/ui";
import OutboxTable from "@/components/outbox-table";

export const dynamic = "force-dynamic";

export default async function OutboxPage() {
  const userId = await getCurrentUserId();
  if (!userId) redirect("/");
  const entries = await getOutbox(userId);

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

      <div className="mt-8">
        {entries.length === 0 ? (
          <Card className="p-10 text-center">
            <Eyebrow>Nothing sent yet</Eyebrow>
            <p className="mx-auto mt-2 max-w-sm text-[13px] text-[#777169]">
              Pick a researcher, review the draft, and every email you send will be tracked here with its status.
            </p>
            <ButtonLink href="/dashboard" className="mt-5">
              See recommendations
            </ButtonLink>
          </Card>
        ) : (
          <OutboxTable entries={entries} />
        )}
      </div>
    </div>
  );
}
