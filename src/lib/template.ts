import { GeneratedDraft, ResearcherProfile, UserProfile } from './types';
import { NimAuth, extractJson, nimAvailable, nimChat } from './nim';
import { cleanHeadline } from './resume';

function lastName(full: string): string {
  const cleaned = full.replace(/,.*$/, '').trim();
  const parts = cleaned.split(/\s+/);
  return parts[parts.length - 1] ?? cleaned;
}

function firstItem(items: string[], fallback = ''): string {
  return items.find((i) => i.length > 10) ?? items[0] ?? fallback;
}

const STOPWORDS = new Set([
  'and', 'the', 'for', 'with', 'from', 'that', 'this', 'into', 'across', 'using', 'their', 'a', 'an', 'of', 'in', 'on',
  'by', 'to', 'at', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'my', 'our', 'i', 'we', 'it', 'its',
]);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9+]+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/**
 * Pick the candidate's entry that best matches this researcher's work, so a
 * protein-ML lab hears about their protein-ML project rather than whatever
 * happens to sit first on the resume.
 */
function mostRelevant(entries: string[], researcher: ResearcherProfile): string {
  if (entries.length === 0) return '';
  const target = new Set(tokens([...researcher.researchAreas, researcher.bio ?? '', researcher.department].join(' ')));
  let best = entries[0];
  let bestScore = -1;
  for (const entry of entries) {
    const words = new Set(tokens(entry));
    let score = 0;
    for (const w of words) if (target.has(w)) score++;
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }
  return best;
}

/**
 * Resume entries carry "City, ST" and date ranges that read as a record, not a
 * sentence. Keep the organization and role, drop the filing metadata.
 */
function tidyEntry(entry: string): string {
  const idx = entry.indexOf(':');
  if (idx === -1) return entry;
  const head = cleanHeadline(entry.slice(0, idx)).replace(/\s*\|\s*/g, ', ');
  const detail = entry.slice(idx + 1).trim();
  return head ? `${head}, ${detail.charAt(0).toLowerCase()}${detail.slice(1)}` : detail;
}

/** Join a clause onto a sentence without doubling terminal punctuation. */
function sentence(text: string): string {
  const trimmed = text.trim().replace(/[.\s]+$/, '');
  return trimmed ? `${trimmed}.` : '';
}

/** The draft already introduces the sender by name; avoid saying it twice. */
function stripLeadingName(summary: string, name: string): string {
  const first = name.split(/\s+/)[0];
  if (!first) return summary;
  const re = new RegExp(`^${name}\\s+|^${first}\\s+(is|studies|works|has|built)\\b`, 'i');
  const stripped = summary.replace(re, (m) => (m.trim().toLowerCase() === name.toLowerCase() ? '' : m.replace(new RegExp(`^${first}\\s+`, 'i'), '')));
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

export function templateDraft(researcher: ResearcherProfile, user: UserProfile): GeneratedDraft {
  const areas = researcher.researchAreas.slice(0, 2).join(' and ') || 'your research';
  const subject = `Prospective researcher interested in ${areas} (${user.name})`;

  const whoIAm = stripLeadingName(user.aiSummary || firstItem(user.education, 'I am an aspiring researcher.'), user.name);
  const experience = mostRelevant([...user.experience, ...user.projects], researcher);
  const interests = user.researchInterests.slice(0, 2).join(' and ');
  const dept = researcher.department.split(',')[0].trim();
  const deptPhrase = /^(the\s+)?(department|school|institute|graduate school|center)\b/i.test(dept)
    ? `the ${dept.replace(/^the\s+/i, '')}`
    : dept;

  const paragraphs = [
    `Dear Professor ${lastName(researcher.name)},`,
    `My name is ${user.name}. ${sentence(whoIAm)}`,
    `I came across your work in ${deptPhrase} at ${researcher.school}, and your research on ${areas} closely matches what I want to work on.${interests ? ` I have been exploring ${interests.toLowerCase()}.` : ''}${researcher.bio ? ` I was particularly interested to read about your group's focus: ${researcher.bio}` : ''}`,
    experience
      ? `Some relevant background: ${sentence(tidyEntry(experience))}${user.skills.length ? ` I work primarily with ${user.skills.slice(0, 5).join(', ')}.` : ''}`
      : '',
    `I would be grateful for the chance to briefly speak about opportunities to contribute to your group. Even 15 minutes would mean a lot. My resume is summarized above, and I am happy to share more.`,
    `Thank you for your time,\n${user.name}${user.email ? `\n${user.email}` : ''}`,
  ].filter(Boolean);

  return { subject, body: paragraphs.join('\n\n'), generator: 'template' };
}

export async function generateDraft(
  researcher: ResearcherProfile,
  user: UserProfile,
  nimAuth?: NimAuth
): Promise<GeneratedDraft> {
  if (!nimAvailable(nimAuth)) return templateDraft(researcher, user);
  try {
    const reply = await nimChat(
      [
        {
          role: 'system',
          content:
            'You write short, specific cold emails from a student to a professor about research opportunities. 120-180 words, warm but not sycophantic, no placeholder brackets, mention 1-2 concrete overlaps between the student background and the professor research. Never use em-dashes or en-dashes anywhere; use periods, commas, or colons instead. Reply ONLY with JSON: {"subject": string, "body": string}. The body must end with a signature using the student name.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            professor: {
              name: researcher.name,
              title: researcher.title,
              school: researcher.school,
              department: researcher.department,
              researchAreas: researcher.researchAreas,
              bio: researcher.bio,
            },
            student: {
              name: user.name,
              email: user.email,
              summary: user.aiSummary,
              education: user.education.slice(0, 3),
              experience: user.experience.slice(0, 5),
              projects: user.projects.slice(0, 4),
              skills: user.skills.slice(0, 10),
              researchInterests: user.researchInterests,
              awards: (user.awards ?? []).slice(0, 5),
            },
          }),
        },
      ],
      { temperature: 0.6, maxTokens: 600 },
      nimAuth
    );
    const parsed = extractJson<{ subject: string; body: string }>(reply);
    if (parsed.subject && parsed.body) return { subject: parsed.subject, body: parsed.body, generator: 'nim' };
    return templateDraft(researcher, user);
  } catch {
    return templateDraft(researcher, user);
  }
}
