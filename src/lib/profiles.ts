import fs from 'fs';
import path from 'path';
import { ResearcherProfile } from './types';
import { readStore, writeStore } from './store';

const PROFILES_PATH = path.join(process.cwd(), 'data', 'profiles.json');

let cache: { mtimeMs: number; profiles: ResearcherProfile[] } | null = null;

function loadBase(): ResearcherProfile[] {
  try {
    const stat = fs.statSync(PROFILES_PATH);
    if (cache && cache.mtimeMs === stat.mtimeMs) return cache.profiles;
    const profiles = JSON.parse(fs.readFileSync(PROFILES_PATH, 'utf8')) as ResearcherProfile[];
    cache = { mtimeMs: stat.mtimeMs, profiles };
    return profiles;
  } catch {
    return [];
  }
}

/** Profiles added at runtime through the in-app scraper (kept out of git). */
function loadRuntime(): ResearcherProfile[] {
  return readStore<ResearcherProfile[]>('scraped-profiles', []);
}

export function getAllProfiles(): ResearcherProfile[] {
  const seen = new Set<string>();
  const all: ResearcherProfile[] = [];
  for (const p of [...loadRuntime(), ...loadBase()]) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    all.push(p);
  }
  return all;
}

export function getProfile(id: string): ResearcherProfile | undefined {
  return getAllProfiles().find((p) => p.id === id);
}

export function addScrapedProfiles(profiles: ResearcherProfile[]): number {
  const runtime = loadRuntime();
  const existingKeys = new Set(
    getAllProfiles().map((p) => `${p.name.toLowerCase().replace(/[^a-z]/g, '')}|${p.school.toLowerCase()}`)
  );
  let added = 0;
  for (const p of profiles) {
    const key = `${p.name.toLowerCase().replace(/[^a-z]/g, '')}|${p.school.toLowerCase()}`;
    if (existingKeys.has(key)) continue;
    existingKeys.add(key);
    runtime.push(p);
    added++;
  }
  writeStore('scraped-profiles', runtime);
  return added;
}

export function searchProfiles(opts: { q?: string; school?: string; area?: string }): ResearcherProfile[] {
  const q = (opts.q ?? '').trim().toLowerCase();
  return getAllProfiles().filter((p) => {
    if (opts.school && p.school !== opts.school) return false;
    if (opts.area && !p.researchAreas.some((a) => a.toLowerCase().includes(opts.area!.toLowerCase()))) return false;
    if (!q) return true;
    const hay = [p.name, p.title, p.department, p.school, p.bio ?? '', ...p.researchAreas].join(' ').toLowerCase();
    return q.split(/\s+/).every((term) => hay.includes(term));
  });
}
