import { redirect } from "next/navigation";
import { getAllProfiles } from "@/lib/profiles";
import { clerkConfigured, getCurrentUserId } from "@/lib/user";
import WaitlistLanding from "@/components/waitlist-landing";

export const dynamic = "force-dynamic";

export default async function Home() {
  const userId = await getCurrentUserId();
  // Signed-in users have no use for the marketing page.
  if (userId) redirect("/dashboard");

  const profiles = await getAllProfiles();
  return (
    <WaitlistLanding
      stats={{
        researchers: profiles.length,
        withEmail: profiles.filter((p) => p.email).length,
        schools: [...new Set(profiles.map((p) => p.school))].sort(),
      }}
      withClerk={clerkConfigured()}
    />
  );
}
