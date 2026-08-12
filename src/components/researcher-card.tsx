import Link from "next/link";
import { ResearcherProfile } from "@/lib/types";

export default function ResearcherCard({ profile, compact = false }: { profile: ResearcherProfile; compact?: boolean }) {
  return (
    <div className="group flex h-full flex-col rounded-2xl border border-zinc-200 bg-white p-5 transition-all duration-300 hover:-translate-y-0.5 hover:border-orange-700/40 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-orange-400/40">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-semibold leading-tight">{profile.name}</h3>
          <p className="mt-0.5 line-clamp-1 text-sm text-zinc-600 dark:text-zinc-400">{profile.title}</p>
        </div>
        <span className="shrink-0 rounded-lg bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
          {profile.school}
        </span>
      </div>
      <p className="mt-1 line-clamp-1 text-xs text-zinc-500 dark:text-zinc-500">{profile.department}</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {profile.researchAreas.slice(0, compact ? 2 : 4).map((a) => (
          <span
            key={a}
            className="rounded-lg border border-zinc-200 px-2 py-0.5 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"
          >
            {a}
          </span>
        ))}
      </div>
      {!compact && profile.bio && (
        <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{profile.bio}</p>
      )}
      <div className="mt-auto flex items-center justify-between gap-2 pt-4">
        <span
          className={`truncate text-xs ${
            profile.email ? "font-mono text-zinc-600 dark:text-zinc-400" : "text-zinc-400 dark:text-zinc-600"
          }`}
        >
          {profile.email ?? "email not published"}
        </span>
        <Link
          href={`/compose?researcher=${encodeURIComponent(profile.id)}`}
          className="shrink-0 rounded-lg bg-orange-700 px-3 py-1.5 text-sm font-medium text-white transition-transform hover:bg-orange-800 active:scale-[0.98]"
        >
          Compose
        </Link>
      </div>
    </div>
  );
}
