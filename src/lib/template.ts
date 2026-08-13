import { GeneratedDraft, ResearcherProfile, UserProfile } from './types';
import { NimAuth, extractJson, nimAvailable, nimChat } from './nim';
import { cleanHeadline } from './resume';

function lastName(full: string): string {
  const cleaned = full.replace(/,.*$/, '').trim();
  const parts = cleaned.split(/\s+/);
  return parts[parts.length - 1] ?? cleaned;
}

const STOPWORDS = new Set([
  'and', 'the', 'for', 'with', 'from', 'that', 'this', 'into', 'across', 'using', 'their', 'a', 'an', 'of', 'in', 'on',
  'by', 'to', 'at', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'my', 'our', 'i', 'we', 'it', 'its',
  // Generic academic vocabulary. Left in, these match everything: a finance
  // internship scores against a biology lab purely on "research" and
  // "analysis", which is exactly the mismatch the ranking exists to avoid.
  'research', 'researcher', 'work', 'works', 'working', 'study', 'studies', 'analysis', 'analyses', 'method',
  'methods', 'group', 'lab', 'laboratory', 'university', 'college', 'professor', 'department', 'project',
  'projects', 'develop', 'develops', 'developing', 'development', 'build', 'built', 'building', 'new', 'based',
  'focus', 'focuses', 'including', 'through', 'used', 'use', 'uses', 'team', 'intern', 'internship', 'student',
]);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9+]+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

function relevanceScore(entry: string, target: Set<string>): number {
  const words = new Set(tokens(entry));
  let score = 0;
  for (const w of words) if (target.has(w)) score++;
  return score;
}

/** Terms describing this researcher's work, used to rank the sender's entries. */
function researcherTerms(researcher: ResearcherProfile): Set<string> {
  return new Set(tokens([...researcher.researchAreas, researcher.bio ?? '', researcher.department].join(' ')));
}

/** Split "Organization, Role: what they did" into its two halves. */
function splitEntry(entry: string): { head: string; detail: string } {
  const idx = entry.indexOf(':');
  if (idx === -1) return { head: cleanHeadline(entry), detail: '' };
  return { head: cleanHeadline(entry.slice(0, idx)).replace(/\s*\|\s*/g, ', '), detail: entry.slice(idx + 1).trim() };
}

function sentence(text: string): string {
  const trimmed = text.trim().replace(/[.\s]+$/, '');
  return trimmed ? `${trimmed}.` : '';
}

function lowerFirst(text: string): string {
  const t = text.trim();
  if (!t || /^[A-Z]{2,}/.test(t)) return t;
  return t.charAt(0).toLowerCase() + t.slice(1);
}

/** One bullet per project, trimmed so the list stays scannable. */
function toBullet(entry: string): string {
  const { head, detail } = splitEntry(entry);
  const body = detail || entry;
  const trimmed = body.length > 240 ? `${body.slice(0, 237)}...` : body;
  return head && detail ? `- ${head}: ${lowerFirst(trimmed)}` : `- ${trimmed}`;
}

/** Cut to a whole word, dropping a dangling half-parenthetical. */
function trimToWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const trimmed = cut.slice(0, cut.lastIndexOf(' ')).replace(/[\s,;(]+$/, '');
  // Count brackets rather than test for presence: an earlier "(Stern)" must
  // not mask a later unclosed "(Courant".
  const opens = (trimmed.match(/\(/g) ?? []).length;
  const closes = (trimmed.match(/\)/g) ?? []).length;
  return opens > closes ? trimmed.slice(0, trimmed.lastIndexOf('(')).replace(/[\s,;]+$/, '') : trimmed;
}

function institutionOf(user: UserProfile): string {
  const first = user.education[0];
  if (!first) return '';
  return cleanHeadline(first).split(',')[0].trim();
}

/**
 * Signature in the shape a student would actually sign off with:
 *   Name
 *   School | Class of YYYY
 *   Degree line
 */
function signature(user: UserProfile): string {
  const lines = [user.name];
  const institution = institutionOf(user);
  const eduText = user.education.join(' ');
  const gradYear = eduText.match(/\b(?:expected|anticipated|class of)\s+\w*\s*(20\d{2})\b/i)?.[1];
  if (institution) lines.push(gradYear ? `${institution} | Class of ${gradYear}` : institution);

  // Case-sensitive and anchored on a non-letter, so month names like "May"
  // are not mistaken for an "M.A." degree abbreviation.
  const degree = eduText
    .match(/\b((?:B\.?S\.?|B\.?A\.?|A\.?B\.?|M\.?S\.?|M\.?A\.?|Ph\.?D\.?|Sc\.?B\.?)(?![a-z])[^,;:|]{0,90})/)?.[1]
    ?.trim();
  if (degree) lines.push(trimToWord(degree.replace(/\s+/g, ' '), 90));
  if (user.email) lines.push(user.email);
  return lines.join('\n');
}

export function templateDraft(researcher: ResearcherProfile, user: UserProfile): GeneratedDraft {
  const areas = researcher.researchAreas.slice(0, 2).join(' and ') || 'your research';
  const subject = `Prospective researcher interested in ${areas} (${user.name})`;

  const target = researcherTerms(researcher);
  const institution = institutionOf(user);

  // Rank everything the sender has done against this researcher's work. The
  // strongest item carries the intro; the next few become the bullet list.
  const scored = [...user.experience, ...user.projects]
    .map((entry) => ({ entry, score: relevanceScore(entry, target) }))
    .sort((a, b) => b.score - a.score);
  const ranked = scored.map((r) => r.entry);

  const headline = ranked[0];
  const intro = [
    `My name is ${user.name}${institution ? ` and I am a student at ${institution}` : ''}.`,
    headline
      ? (() => {
          const { head, detail } = splitEntry(headline);
          return head && detail ? `Most recently at ${head}, I ${lowerFirst(sentence(detail))}` : sentence(headline);
        })()
      : user.aiSummary,
  ]
    .filter(Boolean)
    .join(' ');

  const connection = `I recently saw your work in ${areas}, and was interested in getting involved.${
    researcher.bio ? ` I was glad to read about your group's focus: ${sentence(researcher.bio)}` : ''
  }`;

  // Publications carry links, so they lead the list when present. Only entries
  // that actually overlap this researcher's work earn a bullet: padding the
  // list with unrelated work (a finance internship for a biology lab) reads
  // worse than a short list.
  const related = scored.slice(1).filter((r) => r.score > 0).map((r) => r.entry);
  const bulletSource = [...user.publications, ...related].slice(0, 4);
  const bullets = bulletSource.length
    ? `In the past, I have worked on the following related projects:\n${bulletSource.map(toBullet).join('\n')}`
    : '';

  const interests = user.researchInterests.slice(0, 3).join(', ');
  const context = interests
    ? `More broadly, I have been exploring ${lowerFirst(interests)}, which is what draws me to your lab specifically.`
    : '';

  const skills = user.skills.length
    ? `I have extensively used ${user.skills.slice(0, 4).join(', ')} in past work, but have a lot of coding experience and am adaptable to whichever libraries your lab utilizes. Please let me know if there is a fit in your lab.`
    : 'Please let me know if there is a fit in your lab.';

  const body = [
    `Hello Professor ${lastName(researcher.name)},`,
    intro,
    connection,
    bullets,
    context,
    skills,
    'I would be happy to elaborate on my skills and where I think I can best help out.',
    'Thank you!',
    `--\n${signature(user)}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  return { subject, body, generator: 'template' };
}

const DRAFT_SYSTEM = `You write cold emails from a student to a professor asking to join their lab. Follow this exact structure, which is proven to get replies:

1. "Hello Professor <LastName)," greeting.
2. One short paragraph: the student's name, where they study, and their single most relevant prior research experience with a concrete result.
3. One short paragraph naming the professor's specific research area and saying the student wants to get involved. Reference the professor's actual work, never generic flattery.
4. The literal line "In the past, I have worked on the following related projects:" followed by 2 to 4 bullets starting with "- ". Each bullet names the project and one concrete outcome. Include any URLs the student supplied, verbatim.
5. One short paragraph on tools the student knows plus adaptability, ending with "Please let me know if there is a fit in your lab."
6. The line "I would be happy to elaborate on my skills and where I think I can best help out."
7. "Thank you!"
8. A signature block after a "--" line: name, school and class year, degree, email.

Rules: use ONLY facts supplied about the student. Never invent employers, papers, metrics, or links. Keep it under 300 words. Plain text, no markdown bold or headers. Never use em-dashes or en-dashes; use periods or commas. Reply ONLY with JSON: {"subject": string, "body": string}.`;

export async function generateDraft(
  researcher: ResearcherProfile,
  user: UserProfile,
  nimAuth?: NimAuth
): Promise<GeneratedDraft> {
  if (!nimAvailable(nimAuth)) return templateDraft(researcher, user);
  try {
    const reply = await nimChat(
      [
        { role: 'system', content: DRAFT_SYSTEM },
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
              experience: user.experience.slice(0, 6),
              projects: user.projects.slice(0, 5),
              publications: user.publications.slice(0, 5),
              skills: user.skills.slice(0, 12),
              researchInterests: user.researchInterests,
              awards: (user.awards ?? []).slice(0, 5),
            },
          }),
        },
      ],
      { temperature: 0.5, maxTokens: 900 },
      nimAuth
    );
    const parsed = extractJson<{ subject: string; body: string }>(reply);
    if (parsed.subject && parsed.body) return { subject: parsed.subject, body: parsed.body, generator: 'nim' };
    return templateDraft(researcher, user);
  } catch {
    return templateDraft(researcher, user);
  }
}
