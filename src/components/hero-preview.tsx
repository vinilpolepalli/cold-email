"use client";

// Hero visual: the REAL researcher-card component rendered with real scraped
// data (taste-skill 4.8: a live component preview, never a div-faked
// screenshot). Entry stagger communicates "a directory, arriving".

import { motion, useReducedMotion } from "motion/react";
import { ResearcherProfile } from "@/lib/types";
import ResearcherCard from "./researcher-card";

export default function HeroPreview({ profiles }: { profiles: ResearcherProfile[] }) {
  const reduce = useReducedMotion();

  if (profiles.length === 0) {
    return (
      <div className="flex h-full min-h-64 items-center justify-center rounded-2xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
        The directory populates when the scraping agents finish their first run. Start one on the Scraper page.
      </div>
    );
  }

  return (
    <div className="relative flex flex-col gap-4">
      {profiles.map((p, i) => (
        <motion.div
          key={p.id}
          className={i === 1 ? "sm:translate-x-8" : i === 2 ? "sm:-translate-x-4" : undefined}
          initial={reduce ? false : { opacity: 0, y: 32 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.15 + i * 0.12, ease: [0.16, 1, 0.3, 1] }}
        >
          <ResearcherCard profile={p} compact />
        </motion.div>
      ))}
    </div>
  );
}
