import { GeneratedDraft, Publication, ResearcherProfile, ResearcherWorks, UserProfile } from './types';
import { NimAuth, extractJson, nimAvailable, nimChat } from './nim';
import { pickRelevantPublication, publicationContext } from './publications';
import { cleanHeadline, deriveDegree, deriveGradYear, deriveSchool, deriveStanding, trimToWord } from './resume';

// The draft follows the structure of a cold email that actually got a reply:
//
//   1. Who I am, then my two most relevant experiences, strongest first.
//   2. Your work specifically, naming a paper of yours.
//   3. "In the past, I have worked on the following related projects:" + bullets.
//   4. Tools I know, adaptability, "Please let me know if there is a fit".
//   5. Offer to elaborate, thanks, signature block.
//
// Nothing in here invents a fact. Every sentence is assembled from the
// sender's own profile or from publication metadata we fetched for the
// recipient, so an unedited draft is still true.

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

/**
 * Terms describing this researcher's work, used to rank the sender's entries.
 * Paper titles are the sharpest signal available: a department blurb says
 * "computational biology", a title says "single-cell RNA sequencing".
 */
function researcherTerms(researcher: ResearcherProfile, works?: ResearcherWorks | null): Set<string> {
  const sources = [...researcher.researchAreas, researcher.bio ?? '', researcher.department];
  for (const pub of works?.publications ?? []) {
    sources.push(pub.title);
    // The opening of an abstract names the methods and materials, which is
    // where a student's own vocabulary usually meets a lab's.
    if (pub.abstract) sources.push(pub.abstract.slice(0, 400));
  }
  sources.push(...(works?.topics ?? []));
  return new Set(tokens(sources.join(' ')));
}

/** Split "Organization, Role: what they did" into its two halves. */
function splitEntry(entry: string): { head: string; detail: string } {
  const idx = entry.indexOf(':');
  if (idx === -1) return { head: cleanHeadline(entry), detail: '' };
  return { head: cleanHeadline(entry.slice(0, idx)).replace(/\s*\|\s*/g, ', '), detail: entry.slice(idx + 1).trim() };
}

/** Job-title nouns that mark where an organization ends and a role begins. */
const ROLE_NOUN =
  /\b(?:Intern|Internship|Researcher|Assistant|Associate|Analyst|Engineer|Scientist|Developer|Fellow|Consultant|Manager|Lead|Founder|Volunteer|Tutor|Trainee|Apprentice)\b/;

/** Words that belong to an organization's name, never to a job title. */
const ORG_NOUN =
  /^(?:University|Universities|Institute|Institutes|Laboratory|Lab|Labs|School|College|Center|Centre|Hospital|Ventures|Inc\.?|LLC|Ltd\.?|Corp\.?|Company|Group|Department|Foundation|Partners|Cancer|Medicine|Medical|Health|Systems|Technologies|Sciences|Studies)$/i;

/**
 * Separate "Carnegie Mellon University, Robotics Institute Machine Learning
 * Research Intern" into the place and the job. A resume header runs the two
 * together, and "At Carnegie Mellon University, Robotics Institute Machine
 * Learning Research Intern, I..." is not a sentence a person would write.
 */
function splitOrgRole(head: string): { org: string; role: string } {
  const cleaned = head
    // "Utpata Ventures India / Remote" names a location and an arrangement,
    // and both sit between the employer and the job title.
    .replace(/\s+[A-Z][a-zA-Z.]*\s*[/,]\s*(?:Remote|Hybrid|On-?site)\b/g, '')
    // Work-arrangement tags are neither the place nor the job.
    .replace(/\s*[/,]\s*(?:Remote|Hybrid|On-?site)\b/gi, '')
    .replace(/\s*\(\s*(?:Remote|Hybrid|On-?site)\s*\)/gi, '')
    .trim();

  const match = ROLE_NOUN.exec(cleaned);
  if (!match) return { org: cleaned.replace(/[\s,/|-]+$/, ''), role: '' };

  // Walk back from the role noun over the capitalized words that qualify it
  // ("Machine Learning Research"), stopping at any word that names a company.
  const before = cleaned.slice(0, match.index).trimEnd();
  const words = before.split(/\s+/);
  let cut = words.length;
  while (cut > 0) {
    const word = words[cut - 1];
    if (/[,|]$/.test(word) || !/^[A-Z]/.test(word) || ORG_NOUN.test(word)) break;
    cut--;
  }

  const org = words.slice(0, cut).join(' ').replace(/[\s,/|-]+$/, '');
  const role = [...words.slice(cut), cleaned.slice(match.index)]
    .join(' ')
    // A trailing dash usually introduces a description of the employer, not
    // the job: "Venture Capital Intern - Indian Deep-Tech Venture Firm".
    .split(/\s+-\s+/)[0]
    .replace(/^(?:Remote|Hybrid|On-?site)\s+/i, '')
    .replace(/[\s,/|-]+$/, '')
    .trim();

  // A role with no organization left in front of it is not a split worth making.
  return org ? { org, role } : { org: cleaned.replace(/[\s,/|-]+$/, ''), role: '' };
}

/** "As a research intern at MIT, I ..." with the right article. */
function placeClause(head: string): string {
  const { org, role } = splitOrgRole(head);
  if (!org) return '';
  if (!role) return `at ${org}`;
  return `as ${/^[aeiou]/i.test(role) ? 'an' : 'a'} ${role} at ${org}`;
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

/**
 * One bullet per project, trimmed so the list stays scannable. Consecutive
 * bullets from the same place drop the repeated prefix.
 */
function toBullet(entry: string, previousHead: string): string {
  const { head, detail } = splitEntry(entry);
  const body = detail || entry;
  const trimmed = body.length > 240 ? `${body.slice(0, 237)}...` : body;
  if (!head || !detail) return `- ${trimmed}`;
  return head === previousHead ? `- ${trimmed}` : `- ${prettyHead(head)}: ${lowerFirst(trimmed)}`;
}

/** "Machine Learning Research Intern, Carnegie Mellon University" */
function prettyHead(head: string): string {
  const { org, role } = splitOrgRole(head);
  if (!org) return head;
  return role ? `${role}, ${org}` : org;
}

// The profile fields win when the user has filled them in; otherwise they are
// derived from the education lines, using the same rules the parser applies.

export function institutionOf(user: UserProfile): string {
  return user.school?.trim() || deriveSchool(user.education);
}

function degreeOf(user: UserProfile): string {
  return user.degree?.trim() ? trimToWord(user.degree.trim().replace(/\s+/g, ' '), 90) : deriveDegree(user.education);
}

function gradYearOf(user: UserProfile): string {
  return user.gradYear?.trim() || deriveGradYear(user.education);
}

/**
 * How the sender describes their own position, with the article the opening
 * sentence needs: "an undergraduate", "a PhD student".
 */
export function standingOf(user: UserProfile): string {
  const noun = user.standing?.trim() || deriveStanding(user.education, user.degree ?? '');
  if (!noun) return '';
  return `${/^[aeiou]/i.test(noun) ? 'an' : 'a'} ${noun}`;
}

/**
 * Signature in the shape a student would actually sign off with:
 *   Name
 *   School | Class of YYYY
 *   Degree line
 *   Email
 */
function signature(user: UserProfile): string {
  const lines = [user.name];
  const institution = institutionOf(user);
  const gradYear = gradYearOf(user);
  if (institution) lines.push(gradYear ? `${institution} | Class of ${gradYear}` : institution);
  const degree = degreeOf(user);
  if (degree) lines.push(degree);
  if (user.email) lines.push(user.email);
  return lines.join('\n');
}

/**
 * The sentence that names one of the recipient's papers. Kept to what the
 * metadata supports: a real title, where and when it appeared, and the topic
 * the sender shares with it. No claim about having read it in full.
 */
function paperSentence(pub: Publication, overlap: string): string {
  const context = publicationContext(pub);
  // The title is wrapped in quotes, so any quotes inside it become single.
  const title = pub.title.replace(/"/g, "'");
  const cite = context ? `"${title}" (${context})` : `"${title}"`;
  return overlap
    ? `Your paper ${cite} is the closest thing I have found to what I want to work on, particularly the ${overlap} side of it.`
    : `Your paper ${cite} is the closest thing I have found to what I want to work on.`;
}

/**
 * The topic the sender and the paper share, for the sentence above. Stated
 * interests come first, then the lab's own area labels, and only multi-word
 * skills after that: "the Python side of it" is not a research topic.
 */
function sharedTopic(pub: Publication, user: UserProfile, researcher: ResearcherProfile): string {
  const paperTerms = new Set(tokens(`${pub.title} ${pub.abstract ?? ''}`));
  const overlaps = (term: string) => tokens(term).some((t) => paperTerms.has(t));
  const candidates = [
    ...user.researchInterests,
    ...researcher.researchAreas,
    ...user.skills.filter((s) => s.trim().includes(' ')),
  ];
  const hit = candidates.find((term) => term.trim() && overlaps(term));
  return hit ? lowerFirst(hit.trim()) : '';
}

export function templateDraft(
  researcher: ResearcherProfile,
  user: UserProfile,
  works?: ResearcherWorks | null
): GeneratedDraft {
  const areas = researcher.researchAreas.slice(0, 2).join(' and ') || 'your research';
  const standing = standingOf(user);
  const role = standing.replace(/^an? /, '');
  const subject = role
    ? `${role.charAt(0).toUpperCase()}${role.slice(1)} interested in ${areas} (${user.name})`
    : `Prospective researcher interested in ${areas} (${user.name})`;

  const target = researcherTerms(researcher, works);
  const institution = institutionOf(user);

  // Rank everything the sender has done against this researcher's work. The
  // two strongest carry the opening paragraph; the rest become the bullets.
  const scored = [...user.experience, ...user.projects]
    .map((entry) => ({ entry, score: relevanceScore(entry, target) }))
    .sort((a, b) => b.score - a.score);

  const opening = [`My name is ${user.name}${
    standing && institution ? ` and I am ${standing} at ${institution}` : standing ? ` and I am ${standing}` : institution ? ` and I study at ${institution}` : ''
  }.`];

  const narrate = (entry: string, lead: string): string => {
    const { head, detail } = splitEntry(entry);
    const place = head ? placeClause(head) : '';
    if (!place || !detail) return sentence(entry);
    const opener = lead ? `${lead}, ${place}` : `${place.charAt(0).toUpperCase()}${place.slice(1)}`;
    return `${opener}, I ${lowerFirst(sentence(detail))}`;
  };

  const primary = scored[0];
  // The second experience only earns a place when it relates to this lab and
  // happened somewhere else. Two bullets from one job read as padding, which
  // is exactly what makes a cold email look like a form letter.
  const secondary = primary
    ? scored.slice(1).find((r) => r.score > 0 && splitEntry(r.entry).head !== splitEntry(primary.entry).head)
    : undefined;

  if (primary) opening.push(narrate(primary.entry, ''));
  if (secondary) opening.push(narrate(secondary.entry, 'Earlier'));
  if (opening.length === 1 && user.aiSummary) opening.push(user.aiSummary);
  const intro = opening.filter(Boolean).join(' ');

  // Paragraph two is the one that has to prove this email was written for this
  // person: their area, then a paper of theirs by name.
  const pub = works ? pickRelevantPublication(works, [...user.researchInterests, ...user.skills, user.aiSummary]) : null;
  const connection = [
    `I recently came across your work on ${areas}, and was interested in getting involved.`,
    pub ? paperSentence(pub, sharedTopic(pub, user, researcher)) : null,
    !pub && researcher.bio ? `I was glad to read about your group's focus: ${sentence(researcher.bio)}` : null,
  ]
    .filter(Boolean)
    .join(' ');

  // Publications carry links, so they lead the list when present. Only entries
  // that actually overlap this researcher's work earn a bullet: padding the
  // list with unrelated work (a finance internship for a biology lab) reads
  // worse than a short list.
  const spoken = new Set([primary?.entry, secondary?.entry].filter(Boolean) as string[]);
  const unspoken = scored.filter((r) => !spoken.has(r.entry));
  const overlapping = unspoken.filter((r) => r.score > 0).map((r) => r.entry);
  // With nothing overlapping, the strongest remaining work still carries the
  // email. An empty evidence section is worse than an adjacent one, and the
  // paragraph after it says plainly that the fit is indirect.
  const related = overlapping.length ? overlapping : unspoken.slice(0, 3).map((r) => r.entry);
  // An award or press mention that carries a link belongs in this list too:
  // it is checkable, which is the whole point of the bullets.
  const linkedAwards = (user.awards ?? []).filter((a) => /https?:\/\//.test(a));
  const bulletSource = [...user.publications, ...linkedAwards, ...related]
    .filter((entry) => entry.trim().length > 0)
    .slice(0, 4);
  let previousHead = '';
  const bulletLines = bulletSource.map((entry) => {
    const line = toBullet(entry, previousHead);
    previousHead = splitEntry(entry).head;
    return line;
  });
  const bullets = bulletLines.length
    ? `In the past, I have worked on the following related projects:\n${bulletLines.join('\n')}`
    : '';

  const interests = user.researchInterests.slice(0, 3).join(', ');
  const context = interests
    ? `More broadly, I have been exploring ${lowerFirst(interests)}, which is what draws me to your lab specifically.`
    : '';

  // The reference email owns its weakest link rather than hiding it: adjacent
  // work is named, called adjacent, and turned into an argument about
  // groundwork. That is more convincing than pretending everything fits.
  const orgOf = (entry: string) => splitOrgRole(splitEntry(entry).head).org.replace(/\.$/, '').trim();
  // Somewhere already named in the email is not "work you can also see in my
  // resume", and calling it unrelated after quoting it contradicts the email.
  const alreadyNamed = new Set([...spoken, ...bulletSource].map(orgOf).filter(Boolean));
  const bulleted = new Set(bulletSource);
  const adjacent = [
    ...new Set(
      unspoken
        .filter((r) => r.score === 0 && !bulleted.has(r.entry))
        .map((r) => orgOf(r.entry))
        .filter((org) => !alreadyNamed.has(org))
        // A resume that lists "GitHub" or "Demo" as a project header is
        // naming a link, not a place worth citing to a professor.
        .filter((org) => org.length > 3 && !/^(?:github|gitlab|demo|link|website|site|paper|slides|video)$/i.test(org))
    ),
  ].slice(0, 2);
  const groundwork = adjacent.length
    ? `I also have work at ${adjacent.join(' and ')} that you can see in my attached resume. Those projects are not directly related to your lab's work, but they have given me a foundation in problem solving, computational techniques, and working on a research team.`
    : '';

  const skills = user.skills.length
    ? `I have extensively used ${user.skills.slice(0, 4).join(', ')} in past work, but have a lot of coding experience and am adaptable to whichever libraries your lab utilizes. Please let me know if there is a fit in your lab.`
    : 'Please let me know if there is a fit in your lab.';

  const body = [
    `Hello Professor ${lastName(researcher.name)},`,
    intro,
    connection,
    bullets,
    groundwork,
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
2. One paragraph: the student's name, their standing and school, then their TWO most relevant prior experiences, most relevant first, each with a concrete result. Order by relevance to this professor's work, not by date.
3. One paragraph naming the professor's specific research area, saying the student wants to get involved, and referencing ONE of the professor's actual papers by its exact title, with venue and year in parentheses if supplied. Say what connects it to the student's own interests. Never invent a paper, and never claim to have read something the data does not list.
4. The literal line "In the past, I have worked on the following related projects:" followed by 2 to 4 bullets starting with "- ". Each bullet names the project and one concrete outcome. Include any URLs the student supplied, verbatim.
5. One short paragraph on tools the student knows plus adaptability, ending with "Please let me know if there is a fit in your lab."
6. The line "I would be happy to elaborate on my skills and where I think I can best help out."
7. "Thank you!"
8. A signature block after a "--" line: name, school and class year, degree, email.

Rules: use ONLY facts supplied about the student and the professor. Never invent employers, papers, metrics, or links. Keep it under 320 words. Plain text, no markdown bold or headers. Never use em-dashes or en-dashes; use periods or commas. Reply ONLY with JSON: {"subject": string, "body": string}.`;

export async function generateDraft(
  researcher: ResearcherProfile,
  user: UserProfile,
  nimAuth?: NimAuth,
  works?: ResearcherWorks | null
): Promise<GeneratedDraft> {
  if (!nimAvailable(nimAuth)) return templateDraft(researcher, user, works);
  try {
    const relevant = works ? pickRelevantPublication(works, [...user.researchInterests, ...user.skills, user.aiSummary]) : null;
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
              // The paper to cite is chosen here rather than by the model, so
              // the email names the one closest to the student's own work.
              paperToCite: relevant
                ? { title: relevant.title, venue: relevant.venue, year: relevant.year, abstract: relevant.abstract }
                : null,
              otherPapers: (works?.publications ?? []).slice(0, 5).map((p) => p.title),
            },
            student: {
              name: user.name,
              email: user.email,
              standing: user.standing || undefined,
              school: institutionOf(user) || undefined,
              gradYear: user.gradYear || undefined,
              degree: user.degree || undefined,
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
    return templateDraft(researcher, user, works);
  } catch {
    return templateDraft(researcher, user, works);
  }
}
