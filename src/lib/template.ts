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
  // Ordinary English that a paper abstract and a resume bullet both contain.
  // Left in, a convex optimization lab matched a meeting-recorder side project
  // on "present", "under", "second", and "flows", which is noise scoring as
  // topical overlap and is how the wrong experience reached the opening line.
  'present', 'presents', 'presented', 'time', 'times', 'under', 'over', 'second', 'seconds', 'first', 'data',
  'running', 'run', 'runs', 'improve', 'improves', 'improved', 'flow', 'flows', 'result', 'results', 'approach',
  'approaches', 'problem', 'problems', 'show', 'shows', 'shown', 'high', 'higher', 'low', 'lower', 'large',
  'larger', 'small', 'smaller', 'number', 'numbers', 'set', 'sets', 'given', 'case', 'cases', 'general', 'better',
  'best', 'more', 'most', 'also', 'well', 'within', 'between', 'each', 'per', 'via', 'level', 'levels', 'state',
  'states', 'value', 'values', 'term', 'terms', 'order', 'orders', 'form', 'forms', 'part', 'parts', 'way', 'ways',
  'type', 'types', 'key', 'main', 'many', 'much', 'several', 'various', 'different', 'same', 'common', 'single',
  'multiple', 'full', 'real', 'current', 'currently', 'recent', 'recently', 'prior', 'past', 'made', 'make',
  'makes', 'making', 'take', 'takes', 'provide', 'provides', 'provided', 'allow', 'allows', 'allowed', 'enable',
  'enables', 'enabled', 'support', 'supports', 'help', 'helps', 'need', 'needs', 'require', 'required', 'end',
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
function researcherText(researcher: ResearcherProfile, works?: ResearcherWorks | null): string {
  const sources = [...researcher.researchAreas, researcher.bio ?? '', researcher.department];
  for (const pub of works?.publications ?? []) {
    sources.push(pub.title);
    // The opening of an abstract names the methods and materials, which is
    // where a student's own vocabulary usually meets a lab's.
    if (pub.abstract) sources.push(pub.abstract.slice(0, 400));
  }
  sources.push(...(works?.topics ?? []));
  return sources.join(' ');
}

function researcherTerms(researcher: ResearcherProfile, works?: ResearcherWorks | null): Set<string> {
  return new Set(tokens(researcherText(researcher, works)));
}

/**
 * Coarse field labels, matched on both sides.
 *
 * Word overlap alone is too literal to see that "protein-ligand docking for
 * Hsp90" belongs next to a single-cell genomics lab: they share no words at
 * all, so a computational biology professor was being sent the sender's
 * venture capital internship, which shares no words either but happened to sit
 * higher in the resume. Recognising both as biology fixes the ordering without
 * pretending the two are the same thing.
 */
const DOMAINS: { name: string; pattern: RegExp }[] = [
  {
    name: 'biology',
    pattern:
      /\b(?:bio\w*|genom\w*|genetic\w*|protein\w*|ligand\w*|molecul\w*|cell\w*|rna|dna|sequenc\w*|transcript\w*|drug\w*|pharma\w*|clinical|disease\w*|cancer|tumou?r\w*|oncolog\w*|docking|epitope\w*|omics|immun\w*|microb\w*|enzym\w*|inhibitor\w*|compound\w*|chemistr\w*|screening|assay\w*|patient\w*|health)\b/i,
  },
  {
    name: 'neuroscience',
    pattern: /\b(?:neuro\w*|brain|cortex|cortical|synap\w*|neuron\w*|eeg|fmri|cognit\w*)\b/i,
  },
  {
    name: 'machine learning',
    pattern:
      /\b(?:machine learning|deep learning|neural network\w*|transformer\w*|classif\w*|embedding\w*|gnn|cnn|llm\w*|pytorch|tensorflow|supervised|unsupervised|reinforcement learning|generative)\b/i,
  },
  {
    name: 'vision',
    pattern: /\b(?:computer vision|segmentation|object detection|imaging|image\w*|visual|video|mri|ct scan\w*|microscopy)\b/i,
  },
  {
    // Kept apart from vision so that drone and manipulator work lands next to a
    // robotics lab rather than a radiology one, even though both talk about
    // images.
    name: 'robotics',
    pattern:
      /\b(?:robot\w*|uav|drone\w*|autonomous|slam|manipulat\w*|navigation|lidar|odometry|kinematic\w*|actuat\w*|locomotion|control system\w*)\b/i,
  },
  {
    name: 'statistics',
    // Deliberately no bare "inference": in a resume it usually means running a
    // model, not statistical inference, and it was pulling a meeting-recorder
    // side project to the top for a lab that works on convex optimization.
    pattern: /\b(?:statistic\w*|probabilist\w*|bayesian|estimation|estimator\w*|causal|randomi\w*|sampling|variance|hypothesis test\w*)\b/i,
  },
  {
    name: 'systems',
    pattern: /\b(?:compiler\w*|distributed|hardware|processor\w*|operating system\w*|database\w*|architecture)\b/i,
  },
  {
    name: 'optimization',
    pattern: /\b(?:optimi\w*|convex|gradient|linear program\w*|complexity|combinatorial|approximation algorithm\w*)\b/i,
  },
  {
    name: 'business',
    pattern: /\b(?:venture|startup\w*|investor\w*|investment\w*|market\w*|portfolio|business|financ\w*|trading|revenue|fundrais\w*)\b/i,
  },
];

function domainsOf(text: string): Set<string> {
  const found = new Set<string>();
  for (const domain of DOMAINS) if (domain.pattern.test(text)) found.add(domain.name);
  return found;
}

/** Links the sender pasted alongside an entry, kept whole wherever text is cut. */
const URL_RE = /https?:\/\/\S+/g;
// How long the evidence list runs, and how much of it is reserved for entries
// carrying a link. A professor can check a link; the rest is assertion.
const MAX_BULLETS = 5;
const MAX_LINKED_BULLETS = 3;
// Separate, and deliberately not global: `test` on a /g regex advances
// lastIndex between calls, so the same pattern used for both would skip
// entries depending on what was checked before it.
const HAS_URL = /https?:\/\//;

/**
 * The colon that separates a heading from its description, ignoring the one
 * inside a URL.
 *
 * "MSK research I worked on https://hsp90-dashboard.vercel.app/" used to split
 * at the colon in "https:", so the heading became "...worked on https" and the
 * bullet rendered the link as "https: //hsp90-dashboard.vercel.app/" — a dead
 * link in the one part of the email a professor is most likely to click.
 */
function headBoundary(entry: string): number {
  return entry.replace(URL_RE, (match) => ' '.repeat(match.length)).indexOf(':');
}

function splitEntry(entry: string): { head: string; detail: string } {
  const idx = headBoundary(entry);
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

  // "Research Intern, Chiosis Lab, Memorial Sloan Kettering Cancer Center"
  // names the job first and the employer after a comma. Nothing handled it, so
  // the whole string was treated as the organisation and the opener read "At
  // Research Intern, Chiosis Lab, Memorial Sloan Kettering Cancer Center, I
  // created...". The second half must not itself look like a job title, or an
  // "Organisation, Role" header would be read backwards.
  const commaFirst = cleaned.match(/^([^,]{3,60}),\s*(.+)$/);
  if (commaFirst && ROLE_NOUN.test(commaFirst[1]) && !ROLE_NOUN.test(commaFirst[2])) {
    return { org: commaFirst[2].replace(/[\s,/|-]+$/, ''), role: commaFirst[1].trim() };
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

  // A heading that is only a job title has no organisation to name. Returning
  // it as one produced "At Genomics Intern, I ...", the same shape of mistake
  // as "At Research Intern, Chiosis Lab, ...".
  if (!org) return { org: '', role: cleaned.replace(/[\s,/|-]+$/, '') };
  return { org, role };
}

/** "As a research intern at MIT, I ..." with the right article. */
function placeClause(head: string): string {
  const { org, role } = splitOrgRole(head);
  const article = (word: string) => (/^[aeiou]/i.test(word) ? 'an' : 'a');
  if (!org) return role ? `as ${article(role)} ${role}` : '';
  if (!role) return `at ${org}`;
  return `as ${article(role)} ${role} at ${org}`;
}

/**
 * Every abbreviation a run of capitalised words could be written as, so that a
 * sender who typed "MSK" can be matched to the resume line that spells out
 * "Memorial Sloan Kettering Cancer Center".
 */
function initialisms(text: string): Set<string> {
  const found = new Set<string>();
  for (const run of text.match(/(?:\b[A-Z][a-zA-Z]*\s+){1,7}\b[A-Z][a-zA-Z]*/g) ?? []) {
    const letters = run.split(/\s+/).map((w) => w[0].toLowerCase());
    for (let start = 0; start < letters.length; start++) {
      for (let end = start + 2; end <= letters.length; end++) {
        found.add(letters.slice(start, end).join(''));
      }
    }
  }
  return found;
}

/**
 * Restore the capitals on terms people type in lower case. Someone who writes
 * "agentic ai" in a form still means AI, and an email to a professor that says
 * "agentic ai" reads as careless in exactly the wrong place.
 */
/**
 * Trim whatever the cut left hanging. Stopping at a whole word still leaves
 * the thing that word was qualifying: a trailing preposition ("matrix
 * completion with", "language model estimation for") or a hyphenated adjective
 * ("domain-adaptive end-to-end") both read as unfinished. Repeated, because
 * trimming one can expose another.
 */
function dropDanglingWords(text: string): string {
  let cut = text;
  for (let i = 0; i < 4; i++) {
    const trimmed = cut.replace(
      /\s+(?:[A-Za-z]+(?:-[A-Za-z]+)+|with|for|of|in|on|and|to|by|using|from|at|via|through|under|during|across|between|among|without|into|over|after|before|toward|towards)$/i,
      ''
    );
    if (trimmed === cut || trimmed.length < 12) break;
    cut = trimmed;
  }
  return cut;
}

/** A resume description that opens with something the sender did. */
const ACTION_VERB =
  /^(?:built|created|developed|designed|implemented|led|wrote|trained|improved|delivered|achieved|shipped|launched|automated|analy[sz]ed|integrated|reduced|increased|scaled|deployed|published|ran|won|founded|organi[sz]ed|maintained|refactored|migrated|benchmarked|evaluated|assembled|screened|curated)\b/i;

const ACRONYMS = [
  'AI', 'ML', 'LLM', 'LLMs', 'NLP', 'RL', 'GNN', 'GNNs', 'CNN', 'CNNs', 'RNN', 'ASR', 'CV', 'HPC', 'GPU', 'API',
  'DNA', 'RNA', 'MRI', 'EEG', 'fMRI', 'NGS', 'QSAR', 'PDE', 'ODE', 'SLAM', 'UAV', 'IoT', 'AR', 'VR',
];
function fixAcronyms(text: string): string {
  let out = text;
  for (const acronym of ACRONYMS) {
    out = out.replace(new RegExp(`\\b${acronym}\\b`, 'gi'), acronym);
  }
  return out;
}

/**
 * "a, b and c" rather than "a, b, c". A bare comma list reads as a fragment
 * mid-sentence: "exploring computational biology, drug discovery, machine
 * learning, which is what draws me" has no verb between the last item and the
 * clause that follows it.
 */
function listPhrase(items: string[]): string {
  const clean = items.map((i) => i.trim()).filter(Boolean);
  if (clean.length < 2) return clean[0] ?? '';
  return `${clean.slice(0, -1).join(', ')} and ${clean[clean.length - 1]}`;
}

function sentence(text: string): string {
  const trimmed = text.trim().replace(/[.\s]+$/, '');
  return trimmed ? `${trimmed}.` : '';
}

function lowerFirst(text: string): string {
  const t = text.trim();
  if (!t) return t;
  // Only a plain capitalised word may be lowered to sit mid-sentence. An
  // acronym (DNA), a CamelCase name (MethylMix, PyTorch), and the pronoun "I"
  // are spelled that way on purpose, and lowering them misspells them. Paper
  // and tool names carry internal capitals constantly in this field, so this
  // is the common case rather than an edge one.
  const [firstWord] = t.split(/\s/, 1);
  if (firstWord === 'I' || /[A-Z]/.test(firstWord.slice(1))) return t;
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
  // A bullet that drops the heading — because the one above already carried it
  // — starts on the description, which was written to follow a colon and so
  // begins in lower case.
  const standalone = `- ${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
  if (!head || !detail) return standalone;
  return head === previousHead ? standalone : `- ${prettyHead(head)}: ${lowerFirst(trimmed)}`;
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
  // Long enough for an ordinary title to survive whole. At 70 the cut landed
  // inside "Internal Language Model Estimation for Domain-Adaptive End-to-End
  // Speech Recognition", leaving "for domain-adaptive end-to-end" hanging.
  const cut = trimToWord(topic, 100);
  const phrase = sentenceCase(dropDanglingWords(cut));
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
 * Turn a directory bio, written about the professor, into something that can be
 * said to them. "His lab focuses on biomedical data fusion" quoted verbatim
 * becomes "your group's focus: His lab focuses on...", which talks about the
 * reader in the third person while addressing them.
 *
 * Only the possessives are rewritten, because they are the ones where the verb
 * still agrees afterwards: "his lab focuses" and "your lab focuses" are both
 * fine, while "he works" would have to become "you work". A bio still leading
 * with a bare pronoun is returned empty rather than mangled, and the caller
 * says something simpler instead.
 */
function bioAddressedToThem(bio: string): string {
  const rewritten = bio
    .replace(/\b(?:his|her|their)\b/gi, (m) => (m[0] === m[0].toUpperCase() ? 'Your' : 'your'))
    .replace(/\bDr\.?\s+[A-Z][a-zA-Z-]*(?:'s)?\b/g, 'your')
    .trim();
  return /\b(?:he|she|they)\s+\w/i.test(rewritten) ? '' : rewritten;
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

  const reaction = `I went through ${where}, and the part I keep coming back to is that ${lowerFirst(sentence(condense(claim)))}`;

  // What the sender would add. Only their own stated interests can name a
  // direction; naming the lab's own area back at them is circular, and naming
  // an unrelated skill invents a connection. Better to say nothing.
  const overlaps = (term: string) => {
    const paperTerms = new Set(tokens(`${paper.title ?? ''} ${paper.abstract ?? ''} ${paper.notes ?? ''}`));
    return tokens(term).some((t) => paperTerms.has(t));
  };
  const interest = user.researchInterests.map((i) => fixAcronyms(i.trim())).find((i) => i && overlaps(i));
  const skill = user.skills.map((s) => fixAcronyms(s.trim())).find((s) => s.includes(' ') && overlaps(s));

  // Where the sender would take it, and there is always somewhere.
  //
  // This used to be dropped whenever no interest and no multi-word skill
  // happened to share a word with the abstract, which is most of the time: a
  // sender whose skills are "Python, TypeScript, C++" got a paragraph that
  // admired the paper and proposed nothing. Naming a specific follow-up is the
  // part that reads as someone who thought about the work rather than skimmed
  // it, so the fallbacks narrow rather than disappear — the last one still
  // names this paper's own subject and the sender's own field.
  const ownField = [...domainsOf(`${user.experience.join(' ')} ${user.projects.join(' ')}`)].find(
    (d) => d !== 'business'
  );
  const next = interest
    ? `The follow-up I would want to run is ${lowerFirst(interest)} on top of that${
        skill ? `, starting from the ${lowerFirst(skill)} work I have already done` : ''
      }, and I would be curious whether the same result holds once that is in the loop.`
    : skill
      ? `The follow-up I would want to run is bringing ${lowerFirst(skill)} to it and seeing whether the same result survives that change.`
      : topic
        ? // The full title is too long to sit inside a sentence a second time,
          // having already been named at the top of the paragraph.
          `The follow-up I would want to run is how far ${lowerFirst(dropDanglingWords(trimToWord(topic, 48)).replace(/[\s,;:-]+$/, ''))} carries outside the setting you tested it in${
            ownField ? `, ${ownField} in particular, which is where my own work has been` : ''
          }.`
        : '';
  return [reaction, next].filter(Boolean).join(' ');
}

/**
 * Cut an abstract sentence down to the clause that carries the point.
 *
 * Abstracts pile qualifications onto one sentence, and quoting the whole thing
 * produced a 60-word bullet of somebody else's prose in the middle of the
 * email. Two sentences of understanding is what earns a reply; a paragraph of
 * their own abstract read back to them is what gets skimmed. Cuts at a clause
 * boundary so the result is still a sentence.
 */
function condense(text: string, limit = 190): string {
  const clean = text.trim();
  if (clean.length <= limit) return clean;

  // Prefer a comma or a joining word late in the allowance, so the sentence
  // ends on a complete thought rather than mid-phrase.
  const window = clean.slice(0, limit);
  const boundary = Math.max(
    window.lastIndexOf(', '),
    window.lastIndexOf(' including '),
    window.lastIndexOf(' with '),
    window.lastIndexOf(' which '),
    window.lastIndexOf(' that '),
    window.lastIndexOf(' and ')
  );
  if (boundary > limit * 0.45) return clean.slice(0, boundary).replace(/[\s,;:]+$/, '');
  return trimToWord(clean, limit).replace(/[\s,;:]+$/, '');
}


/** "You show that X" reads badly after "You also"; drop the repeated subject. */

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

function subjectLine(researcher: ResearcherProfile): string {
  // Always the plain form. An earlier version led with the paper's own title
  // when it was short enough, which produced subjects like "Your work on
  // one-for-all" that read as a fragment out of context.
  const area = researcher.researchAreas[0] ? sentenceCase(researcher.researchAreas[0]) : '';
  const candidates = [
    area ? `Interested in your ${area} work` : '',
    area ? `Interested in your ${area}` : '',
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
  const subject = subjectLine(researcher);

  const target = researcherTerms(researcher, works);
  const targetDomains = domainsOf(researcherText(researcher, works));
  const institution = institutionOf(user);

  // Rank everything the sender has done against this researcher's work. Shared
  // words come first; a shared field is worth about three of them, which is
  // what lets a docking project outrank a venture internship for a
  // computational biology lab when neither shares a word with the lab's own.
  const rank = (entry: string): number => {
    const entryDomains = domainsOf(entry);
    const shared = [...entryDomains].filter((d) => targetDomains.has(d)).length;
    // When nothing matches at all, a research project still opens a letter to
    // a professor better than a commercial one. Worth a single point, so it
    // only decides ties and never outranks a real overlap.
    const researchy = [...entryDomains].some((d) => d !== 'business') ? 1 : 0;
    return relevanceScore(entry, target) + shared * 3 + researchy;
  };

  const scored = [...user.experience, ...user.projects]
    .map((entry) => ({ entry, score: rank(entry) }))
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
    !paper && researcher.bio && bioAddressedToThem(researcher.bio)
      ? `I was glad to read about your group's focus: ${sentence(bioAddressedToThem(researcher.bio))}`
      : null,
  ]
    .filter(Boolean)
    .join(' ');

  // Publications carry links, so they lead the list when present. Only entries
  // that actually overlap this researcher's work earn a bullet: padding the
  // list with unrelated work (a finance internship for a biology lab) reads
  // worse than a short list.
  const spoken = new Set([primary?.entry].filter(Boolean) as string[]);

  // A link the sender pasted is labelled in a few words — "MSK research that I
  // worked on" — while the resume says what was actually built. The link is
  // why the bullet is worth reading, but the sentence beside it should be the
  // resume's, so each link is matched back to the entry it describes and that
  // entry's own wording is used.
  const resumeEntries = [...user.experience, ...user.projects];
  const describedBy = (label: string): string => {
    // The link itself carries words the label leaves out: a project at
    // hsp90-dashboard.vercel.app names the target its resume line also names.
    const url = label.match(URL_RE)?.[0] ?? '';
    const labelTerms = new Set([...tokens(label.replace(URL_RE, ' ')), ...tokens(url.replace(/^https?:\/\//, ''))]);
    if (!labelTerms.size) return '';
    let best = '';
    // One shared word is a coincidence; two is a description.
    let bestOverlap = 1;
    for (const entry of resumeEntries) {
      const entryTerms = new Set(tokens(entry));
      // Senders abbreviate the places they worked. "MSK research" and
      // "Memorial Sloan Kettering Cancer Center" share no word at all, so
      // without this the link never finds the experience it belongs to.
      const shorthand = [...initialisms(entry)].filter((i) => labelTerms.has(i)).length * 2;
      const overlap = [...entryTerms].filter((t) => labelTerms.has(t)).length + shorthand;
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        best = entry;
      }
    }
    return best;
  };

  // Everything competes on one scale. Publications used to be prepended
  // unconditionally, so a computational biology lab was shown whichever links
  // the sender happened to add — computer vision first — while the docking
  // work sat at the bottom or fell off the end of the list entirely.
  const linked: { text: string; score: number }[] = [];
  const plain: { text: string; score: number }[] = [];
  const consumed = new Set<string>();
  for (const entry of [...user.publications, ...(user.awards ?? [])]) {
    const url = entry.match(URL_RE)?.[0];
    if (!url) continue;
    const described = describedBy(entry);
    if (described) consumed.add(described);
    // The opening paragraph already narrates one experience in full. When the
    // link belongs to that one, the bullet restates its heading immediately
    // below, so only the description is kept and the link is what the line
    // adds.
    const restated = described && spoken.has(described);
    const source = restated ? splitEntry(described).detail || described : described;
    let body = (source || entry.replace(URL_RE, '')).trim().replace(/[\s,;:-]+$/, '');
    // Without its heading the description is a sentence fragment starting mid
    // clause ("created a reproducible..."), so it gets a capital to stand on
    // its own as a list item.
    if (restated && body) body = body.charAt(0).toUpperCase() + body.slice(1);
    // Ranked on the resume's words as well as the label's: the handful of words
    // typed next to a link rarely name the field the work belongs to.
    linked.push({ text: `${body} ${url}`.trim(), score: rank(`${body} ${entry}`) });
  }
  // A publication without a link is still evidence, and dropping it because it
  // has no URL would lose "3rd author on a genomics paper" entirely.
  for (const entry of user.publications) {
    if (HAS_URL.test(entry)) continue;
    if (entry.trim()) plain.push({ text: entry, score: rank(entry) });
  }
  for (const { entry, score } of scored) {
    if (spoken.has(entry) || consumed.has(entry)) continue;
    plain.push({ text: entry, score });
  }

  // Something a professor can open is the strongest thing in a cold email, so
  // a linked entry is never dropped for scoring zero the way an unlinked one
  // is — it only has to compete on where it sits in the list.
  //
  // With nothing overlapping, the strongest remaining work still carries the
  // email. An empty evidence section is worse than an adjacent one, and the
  // paragraph after it says plainly that the fit is indirect.
  const overlapping = plain.filter((b) => b.score > 0);
  const byScore = (a: { score: number }, b: { score: number }) => b.score - a.score;
  // Linked entries are seated before the list is filled, not merely allowed to
  // compete for a seat. Ranking them together and then cutting at four dropped
  // every link whenever the sender had four resume entries that scored higher,
  // which is the whole reason for putting a link there.
  const seated = linked.sort(byScore).slice(0, MAX_LINKED_BULLETS);
  const filler = (overlapping.length ? overlapping : plain).sort(byScore);
  const bulletSource = [...seated, ...filler.slice(0, Math.max(0, MAX_BULLETS - seated.length))]
    .sort(byScore)
    .map((b) => b.text)
    .filter((entry) => entry.trim().length > 0);
  let previousHead = '';
  const bulletLines = bulletSource.map((entry) => {
    const line = toBullet(entry, previousHead);
    previousHead = splitEntry(entry).head;
    return line;
  });
  const bullets = bulletLines.length
    ? `In the past, I have worked on the following related projects:\n${bulletLines.join('\n')}`
    : '';

  // Interests are put in the order this researcher would care about, not the
  // order they were typed. Leading a speech recognition lab with "computational
  // biology" reads as a list the sender pastes into every email; leading with
  // the one that overlaps reads as someone who picked this lab.
  const rankedInterests = user.researchInterests
    .map((i) => fixAcronyms(i.trim()))
    .filter(Boolean)
    .map((i) => ({ i, score: rank(i) }))
    .sort((a, b) => b.score - a.score);
  // `rank` hands every research-flavoured phrase a point so it outranks a
  // finance internship, which is right for ordering bullets and wrong here: a
  // point that every interest earns is not evidence of overlap with this lab.
  // Claiming one where there is none is the exact thing this sentence is
  // supposed to prove the sender did not do.
  const shared = rankedInterests
    .filter(({ i }) => relevanceScore(i, target) > 0 || [...domainsOf(i)].some((d) => targetDomains.has(d)))
    .map((r) => r.i);
  const context = rankedInterests.length
    ? shared.length
      // Deliberately not "the part I keep coming back to" again: when there is
      // a focus paper that phrase is already three paragraphs up, and the echo
      // makes both sentences read as filler.
      ? `What lines up most directly with your lab is ${lowerFirst(listPhrase(shared.slice(0, 2)))}, and that is why I am writing to you specifically rather than casting around.`
      : `More broadly, I have been exploring ${lowerFirst(listPhrase(rankedInterests.slice(0, 3).map((r) => r.i)))}, and your group is the closest I have found to where I want to take that.`
    : '';

  // The reference email owns its weakest link rather than hiding it: adjacent
  // work is named, called adjacent, and turned into an argument about
  // groundwork. That is more convincing than pretending everything fits.
  const orgOf = (entry: string) => splitOrgRole(splitEntry(entry).head).org.replace(/\.$/, '').trim();
  // Somewhere already named in the email is not "work you can also see in my
  // resume", and calling it unrelated after quoting it contradicts the email.
  const alreadyNamed = new Set([...spoken, ...bulletSource].map(orgOf).filter(Boolean));
  const leftover = scored
    // `consumed` entries were rewritten into linked bullets, so their text no
    // longer appears verbatim in bulletSource and they have to be excluded by
    // name rather than by lookup.
    .filter((r) => r.score === 0 && !spoken.has(r.entry) && !consumed.has(r.entry))
    .map((r) => r.entry);

  // A job has an employer to name; a side project has no employer, and calling
  // one "work at Live Dashboard" invents a company the sender never worked for.
  // Employers are named, projects are described.
  const placesLeft: string[] = [];
  const projectsLeft: string[] = [];
  for (const entry of leftover) {
    const { head, detail } = splitEntry(entry);
    const { org, role } = splitOrgRole(head);
    // Having a job title is what makes something a job. "Analyst Intern,
    // QuantFirm" parses into a role and an employer; "Live Dashboard" parses
    // into neither, and calling it a place invents a company.
    const isPlace =
      Boolean(role && org) &&
      !alreadyNamed.has(org) &&
      org.length > 3 &&
      // A resume that lists "GitHub" or "Demo" as a project header is naming a
      // link, not a place worth citing to a professor.
      !/^(?:github|gitlab|demo|link|website|site|paper|slides|video)$/i.test(org);
    if (isPlace) {
      if (!placesLeft.includes(org)) placesLeft.push(org);
      continue;
    }
    const name = cleanHeadline(head).replace(/[\s,;:.-]+$/, '');
    if (!name) continue;
    const what = detail ? trimToWord(detail, 90).replace(/[\s,;:.-]+$/, '') : '';
    // "Live Dashboard, where I a realtime dashboard for tracking runs" is what
    // comes of assuming the description starts with a verb. When it does not,
    // it is an appositive and reads as one.
    projectsLeft.push(
      !what ? name : ACTION_VERB.test(what) ? `${name}, where I ${lowerFirst(what)}` : `${name}, ${lowerFirst(what)}`
    );
  }

  const alsoDid = [
    placesLeft.length ? `work at ${listPhrase(placesLeft.slice(0, 2))}` : '',
    projectsLeft.length ? `projects like ${listPhrase(projectsLeft.slice(0, 2))}` : '',
  ].filter(Boolean);
  const groundwork = alsoDid.length
    ? `I have also done ${listPhrase(alsoDid)}, which you can see in my attached resume. That work is not directly related to your lab's, but it is where I learned to carry a problem from a rough idea to something that runs and can be checked.`
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
        : subjectLine(researcher);
      return { subject, body: parsed.body, generator: 'nim' };
    }
    return templateDraft(researcher, user, works, paper);
  } catch {
    return templateDraft(researcher, user, works, paper);
  }
}
