import { FocusPaper, GeneratedDraft, ResearcherProfile, ResearcherWorks, UserProfile } from './types';
import { NimAuth, extractJson, nimAvailable, nimChat } from './nim';
import { pickRelevantPublication } from './publications';
import {
  cleanHeadline,
  deriveDegree,
  deriveGradYear,
  deriveMajor,
  deriveSchool,
  deriveStanding,
  trimToWord,
} from './resume';

// The draft follows the structure of a cold email that actually got a reply:
//
//   1. Who I am, then my two most relevant experiences, strongest first.
//   2. Your work specifically, reacting to something concrete in one of your
//      papers and saying where I would take it.
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
  if (idx !== -1) {
    return { head: cleanHeadline(entry.slice(0, idx)).replace(/\s*\|\s*/g, ', '), detail: entry.slice(idx + 1).trim() };
  }
  // An entry written as prose has no colon: "Research Intern at the Chiosis
  // Lab, built protein-ligand GNN models". The comma before a lowercase word
  // is the same boundary, and without it the sentence loses its subject.
  const prose = entry.match(/^(.{4,110}?),\s+([a-z].*)$/);
  if (prose) return { head: cleanHeadline(prose[1]).replace(/\s*\|\s*/g, ', '), detail: prose[2].trim() };
  return { head: cleanHeadline(entry), detail: '' };
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

  // "Machine Learning Research Intern at Carnegie Mellon University" states the
  // job first. A resume header states the employer first. Both are common.
  const roleFirst = cleaned.match(/^(.{3,70}?)\s+at\s+(?:the\s+)?(.+)$/);
  if (roleFirst && ROLE_NOUN.test(roleFirst[1])) {
    return { org: roleFirst[2].replace(/[\s,/|-]+$/, ''), role: roleFirst[1].trim() };
  }

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

// ── the paragraph that proves the email was written for one person ──────────
//
// A formal citation ("Your paper X (Venue, Year) is the closest thing I have
// found") proves only that someone looked at a title. What earns a reply is a
// specific thing out of the paper plus where the sender would take it, so this
// works from the abstract, or from the sender's own notes when they supply
// them on the compose screen.

/** Sentences where a paper states what it did, in the order they usually appear. */
const CONTRIBUTION = /\b(?:we|our|this (?:paper|work|study)|here we)\b/i;

/**
 * Lowercase a title so it reads inside a sentence, without flattening the
 * acronyms and gene names that carry the meaning: "Single-cell meta-analysis
 * of SARS-CoV-2 entry genes" keeps SARS-CoV-2 and loses only the capital S.
 */
function sentenceCase(text: string): string {
  return text.replace(/[A-Za-z]+/g, (word) => (/^[A-Z][a-z]+$/.test(word) ? word.toLowerCase() : word));
}

/** The subject of a paper, short enough to sit mid-sentence. */
function paperTopic(paper: FocusPaper): string {
  if (!paper.title) return '';
  let topic = paper.title
    .split(':')[0]
    .replace(/^(?:A|An|The)\s+/i, '')
    .trim();
  // Titles pad themselves with a second clause. Cutting there beats cutting
  // mid-phrase at a character count.
  if (topic.length > 60) {
    const conjunction = topic.lastIndexOf(' and ');
    if (conjunction > 20) topic = topic.slice(0, conjunction);
  }
  // Cutting to a whole word still leaves the preposition that word belonged
  // to: "matrix completion with" reads as an unfinished thought.
  const phrase = sentenceCase(
    trimToWord(topic, 70).replace(
      /\s+(?:with|for|of|in|on|and|to|by|using|from|at|via|through|under|during|across|between|among|without|into|over|after|before|toward|towards)$/i,
      ''
    )
  );
  // A title that opens with a list of adjectives needs an article to sit after
  // "paper on": "on simple, fast, and flexible framework" is missing one,
  // while "on single-cell meta-analysis" and "on transfer learning" are not.
  return /^[a-z][a-z-]*,\s/.test(phrase) ? `the ${phrase}` : phrase;
}

/** Rewrite a paper's own voice into the reader's: "we show" becomes "you show". */
function toSecondPerson(text: string): string {
  return text
    .replace(/\bWe\b/g, 'You')
    .replace(/\bwe\b/g, 'you')
    .replace(/\bOur\b/g, 'Your')
    .replace(/\bour\b/g, 'your')
    .replace(/\bours\b/g, 'yours')
    .replace(/\bus\b/g, 'you');
}

/**
 * The one sentence of an abstract that says what the authors actually did.
 * Ranked on contribution markers first, then overlap with the title, because
 * abstracts open with background that says nothing specific about the work.
 */
function keyClaim(abstract: string, title: string): string {
  const titleTerms = new Set(tokens(title));
  const sentences = abstract
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 40 && s.length < 320);
  if (!sentences.length) return '';

  let best = '';
  let bestScore = -1;
  sentences.forEach((sentence, index) => {
    const overlap = [...new Set(tokens(sentence))].filter((t) => titleTerms.has(t)).length;
    // Later sentences describe results; the first is almost always framing.
    const score = (CONTRIBUTION.test(sentence) ? 6 : 0) + overlap + Math.min(2, index);
    if (score > bestScore) {
      bestScore = score;
      best = sentence;
    }
  });
  return cleanAbstractSentence(best);
}

/**
 * An abstract sentence, rewritten for a reader of an email rather than of the
 * paper: second person, and without the framing clause that only makes sense
 * inside the abstract.
 */
function cleanAbstractSentence(sentenceText: string): string {
  return toSecondPerson(sentenceText.replace(/\s+/g, ' '))
    .replace(
      /^(?:in this (?:work|paper|study|article),?\s*|here,?\s*|to this end,?\s*|in particular,?\s*|specifically,?\s*)/i,
      ''
    )
    .trim();
}

/**
 * Two sentences: something specific from the paper, then what the sender would
 * do next with it. Falls back to naming the paper plainly when there is no
 * abstract and the sender has not written notes, since inventing a reaction to
 * a paper nobody has read is exactly what this is meant to avoid.
 */
function paperInsight(paper: FocusPaper, user: UserProfile, researcher: ResearcherProfile): string {
  const topic = paperTopic(paper);
  const where = topic
    ? `your ${paper.year ? `${paper.year} ` : ''}paper on ${topic}`
    : 'your recent work';

  const claim = paper.notes?.trim() || (paper.abstract ? keyClaim(paper.abstract, paper.title ?? '') : '');
  const aspect = sharedTopic(paper, user, researcher);

  if (!claim) {
    // Nothing concrete to react to. Say what drew us to it and stop.
    return aspect
      ? `I went through ${where}, and it is the closest thing I have found to the ${aspect} work I want to do.`
      : `I went through ${where}, and it is the closest thing I have found to what I want to work on.`;
  }

  const reaction = `I went through ${where}, and the part I keep coming back to is that ${lowerFirst(sentence(claim))}`;
  // A second detail from the abstract, so the paragraph reads as someone who
  // got past the first paragraph of it. Skipped when the abstract has nothing
  // further to say, rather than padded.
  const secondClaim = paper.abstract ? supportingClaim(paper.abstract, paper.title ?? '', claim) : '';
  const detail = secondClaim ? `You also ${lowerFirst(sentence(stripLeadingSubject(secondClaim)))}` : '';

  // What the sender would add. Only their own stated interests can name a
  // direction; naming the lab's own area back at them is circular, and naming
  // an unrelated skill invents a connection. Better to say nothing.
  const overlaps = (term: string) => {
    const paperTerms = new Set(tokens(`${paper.title ?? ''} ${paper.abstract ?? ''} ${paper.notes ?? ''}`));
    return tokens(term).some((t) => paperTerms.has(t));
  };
  const interest = user.researchInterests.map((i) => i.trim()).find((i) => i && overlaps(i));
  const skill = user.skills.map((s) => s.trim()).find((s) => s.includes(' ') && overlaps(s));
  // Where the sender would take it. An overlapping interest names the
  // direction; failing that, a method they actually know is a concrete thing
  // to offer. A bare language is not: "Python is where my work has been" says
  // nothing to someone who works on matrix completion, so it is left out.
  const next = interest
    ? `The direction I would want to take that is ${lowerFirst(interest)}${
        skill ? `, starting from the ${lowerFirst(skill)} work I have already done` : ''
      }.`
    : skill
      ? `What I would want to try from there is bringing ${lowerFirst(skill)} to it.`
      : '';
  return [reaction, detail, next].filter(Boolean).join(' ');
}

/**
 * A second sentence from the abstract, distinct from the one already quoted.
 * Prefers the sentences that report a result or name a limitation, which are
 * the ones worth reacting to.
 */
const RESULT_MARKER =
  /\b(?:we\s+(?:find|show|observe|identify|demonstrate|report|derive|develop|propose|present|introduce|extend|apply|achieve|train|build|evaluate)|our\s+(?:method|approach|model|results?|framework)|results?\s+(?:show|suggest|indicate)|however|remains?|limitation|challenge|future work|unclear|open question|yet to)\b/i;

function supportingClaim(abstract: string, title: string, already: string): string {
  const titleTerms = new Set(tokens(title));
  // Compare the cleaned forms. The quoted claim has already had its framing
  // clause removed, so matching raw abstract text against it lets the same
  // sentence through twice.
  const fingerprint = (text: string) => cleanAbstractSentence(text).toLowerCase().slice(0, 60);
  const taken = fingerprint(already);

  const sentences = abstract
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 45 && s.length < 300 && fingerprint(s) !== taken);
  if (!sentences.length) return '';

  let best = '';
  let bestScore = 0;
  for (const candidate of sentences) {
    const overlap = [...new Set(tokens(candidate))].filter((t) => titleTerms.has(t)).length;
    const score = (RESULT_MARKER.test(candidate) ? 5 : 0) + overlap;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  // Only worth a sentence if it actually reports something.
  return bestScore >= 5 ? cleanAbstractSentence(best) : '';
}

/** "You show that X" reads badly after "You also"; drop the repeated subject. */
function stripLeadingSubject(text: string): string {
  return text.replace(/^(?:you|your team)\s+/i, '').trim();
}

/**
 * The topic the sender and the paper share, for the sentence above. Stated
 * interests come first, then the lab's own area labels, and only multi-word
 * skills after that: "the Python side of it" is not a research topic.
 */
function sharedTopic(
  paper: { title: string | null; abstract: string | null; notes?: string | null },
  user: UserProfile,
  researcher: ResearcherProfile
): string {
  const paperTerms = new Set(tokens(`${paper.title ?? ''} ${paper.abstract ?? ''} ${paper.notes ?? ''}`));
  const overlaps = (term: string) => tokens(term).some((t) => paperTerms.has(t));
  const candidates = [
    ...user.researchInterests,
    ...researcher.researchAreas,
    ...user.skills.filter((s) => s.trim().includes(' ')),
  ];
  const hit = candidates.find((term) => term.trim() && overlaps(term));
  return hit ? lowerFirst(hit.trim()) : '';
}

/** The auto-picked paper, in the shape the paragraph builder wants. */
export function focusFromWorks(works: ResearcherWorks, user: UserProfile): FocusPaper | null {
  const pub = pickRelevantPublication(works, [...user.researchInterests, ...user.skills, user.aiSummary]);
  if (!pub) return null;
  return {
    title: pub.title,
    url: pub.pdfUrl ?? pub.url,
    venue: pub.venue,
    year: pub.year,
    abstract: pub.abstract,
    notes: null,
    source: 'matched',
  };
}

/**
 * Subject lines. Short and specific beats complete: the sender's name is
 * already in the From header, and a subject that runs past the preview pane
 * gets truncated exactly where the personalization was.
 */
const MAX_SUBJECT = 52;

function subjectLine(researcher: ResearcherProfile, paper: FocusPaper | null): string {
  const topic = paper ? paperTopic(paper) : '';
  // The paper's own subject is more specific than a department tag, so it wins
  // when it is short enough to survive the preview pane.
  const candidates = [
    topic && topic.length <= 34 ? `Your work on ${topic}` : '',
    researcher.researchAreas[0] ? `Interested in your ${sentenceCase(researcher.researchAreas[0])} work` : '',
    researcher.researchAreas[0] ? `Interested in your ${sentenceCase(researcher.researchAreas[0])}` : '',
    'Interested in joining your lab',
  ];
  return candidates.find((c) => c && c.length <= MAX_SUBJECT) ?? 'Interested in joining your lab';
}

export function templateDraft(
  researcher: ResearcherProfile,
  user: UserProfile,
  works?: ResearcherWorks | null,
  focus?: FocusPaper | null
): GeneratedDraft {
  const areas = researcher.researchAreas.slice(0, 2).join(' and ') || 'your research';
  const standing = standingOf(user);
  const paper = focus ?? (works ? focusFromWorks(works, user) : null);
  const subject = subjectLine(researcher, paper);

  const target = researcherTerms(researcher, works);
  const institution = institutionOf(user);

  // Rank everything the sender has done against this researcher's work. The
  // two strongest carry the opening paragraph; the rest become the bullets.
  const scored = [...user.experience, ...user.projects]
    .map((entry) => ({ entry, score: relevanceScore(entry, target) }))
    .sort((a, b) => b.score - a.score);

  const major = user.major?.trim() || deriveMajor(degreeOf(user));
  const position = [
    standing && institution ? `${standing} at ${institution}` : standing || (institution ? `a student at ${institution}` : ''),
    major ? `studying ${major}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const opening = [position ? `My name is ${user.name} and I am ${position}.` : `My name is ${user.name}.`];

  const narrate = (entry: string, lead: string): string => {
    const { head, detail } = splitEntry(entry);
    const place = head ? placeClause(head) : '';
    if (!place || !detail) return sentence(entry);
    const opener = lead ? `${lead}, ${place}` : `${place.charAt(0).toUpperCase()}${place.slice(1)}`;
    return `${opener}, I ${lowerFirst(sentence(detail))}`;
  };

  // One experience, not two. The opening paragraph is the least interesting
  // part of the email to the person reading it: they can see the rest in the
  // bullets and the attached resume. The sentences saved here go to the
  // paragraph about their own work, which is what earns a reply.
  const primary = scored[0];
  if (primary) opening.push(narrate(primary.entry, ''));
  if (opening.length === 1 && user.aiSummary) opening.push(user.aiSummary);
  const intro = opening.filter(Boolean).join(' ');

  // Paragraph two is the one that has to prove this email was written for this
  // person: their area, then something specific out of a paper of theirs.
  const connection = [
    `I recently came across your work on ${areas}, and was interested in getting involved.`,
    paper ? paperInsight(paper, user, researcher) : null,
    !paper && researcher.bio ? `I was glad to read about your group's focus: ${sentence(researcher.bio)}` : null,
  ]
    .filter(Boolean)
    .join(' ');

  // Publications carry links, so they lead the list when present. Only entries
  // that actually overlap this researcher's work earn a bullet: padding the
  // list with unrelated work (a finance internship for a biology lab) reads
  // worse than a short list.
  const spoken = new Set([primary?.entry].filter(Boolean) as string[]);
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
2. TWO sentences only: the student's name, standing, school and major, then their single most relevant prior experience with a concrete result. Pick it by relevance to this professor's work, not by date. Do NOT list a second experience here; the bullets below cover the rest.
3. The longest paragraph, three or four sentences, showing the student actually read the supplied paper. Name something SPECIFIC from it: the method, the result, the dataset, the limitation. Add a second concrete detail from it. Then say what the student would extend, try next, or apply it to, and how, connected to their own skills. Use the student's own notes about the paper when supplied, in preference to the abstract. NEVER write "Your paper <title> (Venue, Year) is ..." or any other bare citation, and never state a finding that is not in the supplied abstract or notes.
4. The literal line "In the past, I have worked on the following related projects:" followed by 2 to 4 bullets starting with "- ". Each bullet names the project and one concrete outcome. Include any URLs the student supplied, verbatim.
5. One short paragraph on tools the student knows plus adaptability, ending with "Please let me know if there is a fit in your lab."
6. The line "I would be happy to elaborate on my skills and where I think I can best help out."
7. "Thank you!"
8. A signature block after a "--" line: name, school and class year, degree, email.

Subject: at most 50 characters, lowercase except the first word and proper nouns, specific to this professor's topic. No name, no "Prospective researcher", no exclamation marks. "Interested in your single-cell genomics work" is the right shape.

Rules: use ONLY facts supplied about the student and the professor. Never invent employers, papers, metrics, or links. Keep it under 320 words. Plain text, no markdown bold or headers. Never use em-dashes or en-dashes; use periods or commas. Reply ONLY with JSON: {"subject": string, "body": string}.`;

export async function generateDraft(
  researcher: ResearcherProfile,
  user: UserProfile,
  nimAuth?: NimAuth,
  works?: ResearcherWorks | null,
  focus?: FocusPaper | null
): Promise<GeneratedDraft> {
  const paper = focus ?? (works ? focusFromWorks(works, user) : null);
  if (!nimAvailable(nimAuth)) return templateDraft(researcher, user, works, paper);
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
              // The paper is chosen here rather than by the model, so the
              // email reacts to the one closest to the student's own work, or
              // to the one the student pasted in on the compose screen.
              paperTheStudentRead: paper
                ? {
                    title: paper.title,
                    venue: paper.venue,
                    year: paper.year,
                    abstract: paper.abstract,
                    studentNotes: paper.notes,
                  }
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
              major: user.major || undefined,
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
    if (parsed.subject && parsed.body) {
      // Models drift long on subjects however firmly the prompt asks. A
      // subject that overruns the preview pane loses the personalization it
      // was written for, so fall back to the built one rather than truncate.
      const subject = parsed.subject.trim().length <= MAX_SUBJECT + 12
        ? parsed.subject.trim()
        : subjectLine(researcher, paper);
      return { subject, body: parsed.body, generator: 'nim' };
    }
    return templateDraft(researcher, user, works, paper);
  } catch {
    return templateDraft(researcher, user, works, paper);
  }
}
