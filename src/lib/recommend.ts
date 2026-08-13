import { ResearcherProfile, UserProfile } from './types';

// Ranks researchers against a user's profile so the dashboard can surface who
// is actually worth emailing. Scoring is deliberately explainable: every
// recommendation carries the terms that earned it.

const STOPWORDS = new Set([
  'and', 'the', 'for', 'with', 'from', 'that', 'this', 'into', 'across', 'using', 'their', 'a', 'an', 'of', 'in', 'on',
  'by', 'to', 'at', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'my', 'our', 'i', 'we', 'it', 'its',
  // Generic academic vocabulary matches everything and tells us nothing.
  'research', 'researcher', 'work', 'works', 'working', 'study', 'studies', 'analysis', 'analyses', 'method',
  'methods', 'group', 'lab', 'laboratory', 'university', 'college', 'professor', 'department', 'project',
  'projects', 'develop', 'develops', 'developing', 'development', 'build', 'built', 'building', 'new', 'based',
  'focus', 'focuses', 'including', 'through', 'used', 'use', 'uses', 'team', 'intern', 'internship', 'student',
  'science', 'sciences', 'scientist', 'engineering', 'engineer', 'institute', 'school', 'center', 'centre',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9+]+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

export interface Recommendation {
  researcher: ResearcherProfile;
  score: number;
  matchedOn: string[];
}

/**
 * A user's interest profile weights explicit interests highest, then skills,
 * then the prose of their experience and projects.
 */
function userTerms(user: UserProfile): Map<string, number> {
  const weights = new Map<string, number>();
  const add = (text: string, weight: number) => {
    for (const term of new Set(tokenize(text))) {
      weights.set(term, (weights.get(term) ?? 0) + weight);
    }
  };
  user.researchInterests.forEach((t) => add(t, 3));
  user.skills.forEach((t) => add(t, 2));
  add(user.aiSummary ?? '', 1.5);
  user.experience.forEach((t) => add(t, 1));
  user.projects.forEach((t) => add(t, 1));
  user.publications.forEach((t) => add(t, 1.5));
  return weights;
}

export function recommendResearchers(
  user: UserProfile,
  researchers: ResearcherProfile[],
  opts: { limit?: number; excludeIds?: Set<string> } = {}
): Recommendation[] {
  const weights = userTerms(user);
  if (weights.size === 0) return [];

  const raw: { researcher: ResearcherProfile; value: number; matchedOn: string[] }[] = [];
  for (const researcher of researchers) {
    if (opts.excludeIds?.has(researcher.id)) continue;

    const matchedOn: string[] = [];
    let value = 0;

    // Research-area tags are the strongest signal: they are curated, short,
    // and describe what the lab actually does.
    for (const area of researcher.researchAreas) {
      const hit = tokenize(area).reduce((sum, t) => sum + (weights.get(t) ?? 0), 0);
      if (hit > 0) {
        value += hit * 2;
        matchedOn.push(area);
      }
    }
    // Bio prose contributes at a lower weight and does not add match labels.
    for (const term of new Set(tokenize(researcher.bio ?? ''))) {
      value += (weights.get(term) ?? 0) * 0.4;
    }

    if (value > 0) raw.push({ researcher, value, matchedOn: [...new Set(matchedOn)].slice(0, 3) });
  }
  if (raw.length === 0) return [];

  // Normalize against the strongest match in this directory rather than an
  // absolute constant. An absolute curve saturates and prints 97 next to 93
  // for every candidate, which tells the reader nothing; scaling to the field
  // keeps the spread meaningful.
  const top = Math.max(...raw.map((r) => r.value));
  const scored: Recommendation[] = raw.map((r) => ({
    researcher: r.researcher,
    matchedOn: r.matchedOn,
    // Map onto 30-99 so even a weak-but-real overlap reads as a number rather
    // than a discouraging single digit.
    score: Math.max(30, Math.min(99, Math.round(30 + (r.value / top) * 69))),
  }));

  scored.sort((a, b) => b.score - a.score || a.researcher.name.localeCompare(b.researcher.name));
  return scored.slice(0, opts.limit ?? 8);
}
