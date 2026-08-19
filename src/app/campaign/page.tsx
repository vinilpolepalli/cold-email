import { redirect } from "next/navigation";
import { getCurrentUserId, getUserProfile } from "@/lib/user";
import { Card, Eyebrow, ButtonLink } from "@/components/ui";
import CampaignConsole from "@/components/campaign-console";

export const dynamic = "force-dynamic";

export default async function CampaignPage() {
  const userId = await getCurrentUserId();
  if (!userId) redirect("/");

  // Everything on this page ranks the directory against the sender's own work,
  // so without a profile there is nothing to rank and the console would be a
  // page of zeroes.
  const profile = await getUserProfile(userId);

  return (
    <div className="px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl tracking-tight">Campaign</h1>
          <p className="mt-1 max-w-2xl text-sm text-[#777169]">
            Stanford first, then MIT, then Harvard. Drafts are written the night before and wait here for you until a
            track has earned the right to send on its own.
          </p>
        </div>
        <ButtonLink href="/settings" variant="secondary">
          Templates and settings
        </ButtonLink>
      </div>

      <div className="mt-8">
        {profile ? (
          <CampaignConsole />
        ) : (
          <Card className="p-10 text-center">
            <Eyebrow>Profile needed first</Eyebrow>
            <p className="mx-auto mt-2 max-w-sm text-[13px] text-[#777169]">
              The queue is ranked against your own research interests and experience, so it needs your resume before it
              can pick anyone.
            </p>
            <ButtonLink href="/onboarding" className="mt-5">
              Add your profile
            </ButtonLink>
          </Card>
        )}
      </div>
    </div>
  );
}
