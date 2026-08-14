import { UserProfile } from './types';
import { cleanHeadline, deriveDegree, deriveGradYear, deriveMajor, deriveSchool, deriveStanding } from './resume';

export { MEMORY_EXPORT_PROMPT } from './memory-prompt';

// A second way in, for people whose best record of themselves is not a resume.
//
// Assistants that keep long-term memory can export what they know about you.
// The export is dated one-line entries under five headings, which carries more
// than a resume does about what someone actually works on, so it feeds the
// same profile the drafts are written from.

type ParsedProfile = Omit<UserProfile, 'id' | 'aiSummary' | 'updatedAt'>;


type Category = 'instructions' | 'identity' | 'career' | 'projects' | 'preferences';

const CATEGORY_HEADER = /^(?:#{1,6}\s*)?(?:\d+[.)]\s*)?\**\s*(instructions|identity|career|projects|preferences)\b\s*\**\s*:?\s*$/i;

/** Headers sometimes arrive inline: "**Career**: entry, entry". */
const INLINE_HEADER = /^(?:#{1,6}\s*)?(?:\d+[.)]\s*)?\**\s*(instructions|identity|career|projects|preferences)\**\s*:\s*(.+)$/i;

/** Entry lines carry a leading date stamp that is metadata, not content. */
const DATE_PREFIX = /^[-*•]?\s*\[(?:\d{4}-\d{2}-\d{2}|unknown)\]\s*[-–—:]?\s*/i;

const SCHOOL_WORDS = /\b(university|college|school|institute|academy|studies|studying|majoring|major|degree|b\.?s\.?|b\.?a\.?|m\.?s\.?|ph\.?d|undergraduate|graduate|class of)\b/i;
const INTEREST_LEAD = /\b(?:interested in|focused on|wants to work on|working on|researching|passionate about|curious about)\s+(.{4,120})/i;

function stripFences(text: string): string {
  // The prompt asks for one code block, so the whole export usually arrives
  // wrapped in one.
  const fenced = text.match(/```(?:\w+)?\s*([\s\S]*?)```/);
  return (fenced ? fenced[1] : text).replace(/\r/g, '');
}

function cleanEntry(line: string): string {
  return line
    .replace(DATE_PREFIX, '')
    .replace(/^[-*•]\s*/, '')
    .replace(/\*\*/g, '')
    .trim();
}

/**
 * Split an export into its five buckets. Anything before the first recognised
 * header is dropped: it is the assistant's preamble, not content.
 */
function bucketize(text: string): Record<Category, string[]> {
  const buckets: Record<Category, string[]> = {
    instructions: [],
    identity: [],
    career: [],
    projects: [],
    preferences: [],
  };

  let current: Category | null = null;
  for (const raw of stripFences(text).split('\n')) {
    const line = raw.trim();
    if (!line) continue;

    const header = line.match(CATEGORY_HEADER);
    if (header) {
      current = header[1].toLowerCase() as Category;
      continue;
    }
    const inline = line.match(INLINE_HEADER);
    if (inline) {
      current = inline[1].toLowerCase() as Category;
      const rest = cleanEntry(inline[2]);
      if (rest) buckets[current].push(rest);
      continue;
    }
    if (!current) continue;

    const entry = cleanEntry(line);
    if (entry.length > 2) buckets[current].push(entry);
  }
  return buckets;
}

/** First plausible personal name in the identity block. */
function findName(identity: string[]): string {
  for (const entry of identity) {
    const stated = entry.match(/\b(?:name is|named|goes by|full name:?)\s+([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+){0,2})/);
    if (stated) return stated[1];
  }
  for (const entry of identity) {
    // Entries commonly open with the name: "Vinil Polepalli is a student at..."
    const leading = entry.match(/^([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+){1,2})\b/);
    if (leading) return leading[1];
  }
  return '';
}

/**
 * An export writes education as prose, so the degree-marker split that works
 * on a resume line returns the whole sentence. Take the proper-noun phrase
 * after "at" instead, stopping at the first comma.
 */
function findSchool(education: string[]): string {
  for (const entry of education) {
    const match = entry.match(
      /\b(?:at|attends|attending|enrolled at|student at)\s+((?:the\s+)?[A-Z][\w.'&-]*(?:\s+(?:of|and|for|the)\s+[A-Z][\w.'&-]*|\s+[A-Z][\w.'&-]*)*)/
    );
    if (match) return match[1].split(',')[0].trim();
  }
  return deriveSchool(education.map(cleanHeadline));
}

export function parseMemoryExport(raw: string): ParsedProfile {
  const buckets = bucketize(raw);
  const identity = buckets.identity;

  const education = identity.filter((entry) => SCHOOL_WORDS.test(entry)).slice(0, 6);
  const degree = deriveDegree(education);

  // Interests are stated rather than listed, so pull the clause that follows
  // the phrase that introduces them. Preferences are excluded on purpose: a
  // working-style note is not a research interest, and one in the list would
  // steer every recommendation.
  const researchInterests = [...identity, ...buckets.career]
    .map((entry) => entry.match(INTEREST_LEAD)?.[1])
    .filter((match): match is string => Boolean(match))
    .map((match) => match.replace(/[.;].*$/, '').trim())
    .filter((match) => match.length > 3)
    .slice(0, 8);

  return {
    name: findName(identity) || 'Unknown',
    email: raw.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)?.[0] ?? '',
    school: findSchool(education),
    degree,
    major: deriveMajor(degree),
    gradYear: deriveGradYear(education),
    standing: deriveStanding(education, degree),
    education,
    experience: buckets.career.slice(0, 14),
    projects: buckets.projects.slice(0, 12),
    // Skills, publications, and awards are rarely listed as such in an export.
    // Left empty for the model pass rather than guessed at from prose.
    skills: [],
    publications: [],
    researchInterests: [...new Set(researchInterests)],
    awards: [],
    rawResumeText: raw.slice(0, 20000),
  };
}

/**
 * True when the text looks like an export rather than a resume. The test is
 * the dated entry format, not the headings: a resume with a PROJECTS section
 * matches a heading too, and treating one as an export throws away the whole
 * parse.
 */
export function looksLikeMemoryExport(text: string): boolean {
  const dated = stripFences(text)
    .split('\n')
    .filter((line) => DATE_PREFIX.test(line.trim())).length;
  if (dated < 3) return false;
  const buckets = bucketize(text);
  return buckets.identity.length + buckets.career.length + buckets.projects.length >= 2;
}
