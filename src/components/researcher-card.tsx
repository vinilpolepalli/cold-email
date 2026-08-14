import Link from "next/link";
import { ResearcherProfile } from "@/lib/types";
import { ButtonLink } from "./ui";

export default function ResearcherCard({ profile, compact = false }: { profile: ResearcherProfile; compact?: boolean }) {
  const profileHref = `/researchers/${encodeURIComponent(profile.id)}`;
  return (
    <div className="flex h-full flex-col rounded-[12px] border border-[#e5e5e5] bg-white p-5 transition-colors hover:border-black">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={profileHref} className="truncate text-sm font-medium hover:underline underline-offset-2">
            {profile.name}
          </Link>
          <p className="mt-0.5 line-clamp-1 text-[13px] text-[#777169]">{profile.title}</p>
        </div>
        <span className="shrink-0 rounded-full border border-[#e5e5e5] bg-[#f5f3f1] px-2.5 py-0.5 text-[11px] text-[#777169]">
          {profile.school}
        </span>
      </div>
      <p className="mt-1 line-clamp-1 text-[11px] text-[#777169]">{profile.department}</p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {profile.researchAreas.slice(0, compact ? 2 : 4).map((a) => (
          <span key={a} className="rounded-full border border-[#e5e5e5] px-2 py-0.5 text-[11px] text-[#777169]">
            {a}
          </span>
        ))}
      </div>

      {!compact && profile.bio && (
        <p className="mt-3 line-clamp-3 text-[13px] leading-5 text-[#777169]">{profile.bio}</p>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 pt-4">
        <span className={`truncate text-[11px] ${profile.email ? "font-mono text-[#777169]" : "text-[#777169]/60"}`}>
          {profile.email ?? "no public email"}
        </span>
        <div className="flex shrink-0 gap-1.5">
          <ButtonLink href={profileHref} variant="secondary" className="h-7 px-3 text-[12px]">
            Profile
          </ButtonLink>
          <ButtonLink
            href={`/compose?researcher=${encodeURIComponent(profile.id)}`}
            className="h-7 px-3 text-[12px]"
          >
            Draft
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}
