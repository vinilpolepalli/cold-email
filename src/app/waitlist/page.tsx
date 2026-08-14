import { getCurrentUserId } from "@/lib/user";
import { getWaitlist, isWaitlistAdmin } from "@/lib/waitlist";
import { Card, Eyebrow } from "@/components/ui";
import WaitlistTable from "@/components/waitlist-table";

// Who has asked for access. Read from storage on the server, so the addresses
// never travel to a browser that is not the operator's.

export const dynamic = "force-dynamic";

export default async function WaitlistPage() {
  const userId = await getCurrentUserId();
  if (!userId || !isWaitlistAdmin(userId)) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="text-2xl tracking-tight">Waitlist</h1>
        <Card className="mt-6 p-6">
          <p className="text-sm leading-6 text-[#777169]">
            This page is for whoever runs the site. Add your Clerk user id to{" "}
            <span className="font-mono text-[12px]">WAITLIST_ADMIN_IDS</span> to see the signups.
          </p>
          {userId && <p className="mt-3 font-mono text-[12px] break-all">{userId}</p>}
        </Card>
      </div>
    );
  }

  const entries = await getWaitlist();

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl tracking-tight">Waitlist</h1>
          <p className="mt-1 text-sm text-[#777169]">
            {entries.length === 0
              ? "Nobody has asked for access yet."
              : `${entries.length} ${entries.length === 1 ? "person has" : "people have"} asked for access.`}
          </p>
        </div>
      </div>

      <Card className="mt-6 p-6">
        <Eyebrow>How to let someone in</Eyebrow>
        <p className="mt-2 text-sm leading-6 text-[#777169]">
          Sign-up is invite only. Add their address to the allowlist in the Clerk dashboard, under User and
          Authentication, then Restrictions, then Allowlist. Removing a row here does not let anyone in or keep
          anyone out; it just clears the row once you have dealt with it.
        </p>
      </Card>

      {entries.length > 0 && <WaitlistTable entries={entries} />}
    </div>
  );
}
