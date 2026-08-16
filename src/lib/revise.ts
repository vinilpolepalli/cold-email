// Editing a draft in place from a typed instruction. The compose screen sends
// either the whole body or a highlighted passage; this returns the rewritten
// text and nothing else, so the caller can splice it back exactly where it came
// from.

import { NimAuth, nimChat } from './nim';
import { EmailRule, rulesPrompt } from './preferences';
import { ResearcherProfile, UserProfile } from './types';

export interface ReviseRequest {
  instruction: string;
  /** The full body, always, so the model can keep a passage consistent with the
   *  rest of the email even when it is only rewriting one paragraph. */
  body: string;
  subject: string;
  /** The highlighted passage, or null to rewrite the whole body. */
  selection: string | null;
  researcher: ResearcherProfile;
  user: UserProfile;
  rules: EmailRule[];
}

export interface ReviseResult {
  /** Replacement for the selection, or for the whole body when none was sent. */
  text: string;
  /** Only set when the instruction was about the subject line. */
  subject: string | null;
}

const SHARED_RULES = [
  'Use only facts that appear in the email you were given or in the sender profile below.',
  'Never invent an employer, a metric, a publication, a date or a link. If the instruction asks for a fact you were not given, write the sentence without that fact rather than inventing one.',
  'Keep every URL exactly as it appears. Do not shorten, relabel or reformat a link.',
  'Plain text only. No markdown, no bold, no headers.',
  'Never use em-dashes or en-dashes. Use commas or periods.',
  'Keep the sender\'s voice: first person, plain, specific, no salesmanship.',
].join('\n');

// Deliberately not JSON. The thing being returned is a multi-paragraph email,
// and asking a model to escape every newline into a JSON string is a reliable
// way to get back something that will not parse. Markers also cannot be echoed
// back as a schema: a model that copies the format instruction verbatim still
// produces a parsable envelope, where copying {"text": string} does not.
const START = '%%%REVISED%%%';
const END = '%%%END%%%';

const FORMAT = `Reply in exactly this form and nothing else:

SUBJECT: NONE
${START}
the revised text, written out in full
${END}

Write the actual revised text on the lines between the markers. Never reply with a placeholder, a description of what should go there, or anything in angle brackets. Replace NONE with a new subject line only if the instruction was about the subject. No commentary before or after the markers, no quotes, no code fences.`;

const WHOLE_SYSTEM = `You are editing a cold email a student is sending to a professor. The student has told you what to change. Apply that change to the whole email and return the complete revised email.

${SHARED_RULES}
Preserve the parts the instruction does not touch. This is an edit, not a rewrite: if the instruction is about one paragraph, the other paragraphs should come back unchanged.
Keep the greeting and the signature block intact unless the instruction is about them.
Put the complete revised email body between the markers. Give a SUBJECT only if the instruction was about the subject line, otherwise write NONE.

${FORMAT}`;

const SELECTION_SYSTEM = `You are editing one passage of a cold email a student is sending to a professor. You are given the whole email for context and the exact passage the student highlighted. Apply their instruction to the highlighted passage ONLY.

${SHARED_RULES}
Between the markers put a replacement for the highlighted passage and nothing else: no surrounding sentences, no explanation. It is spliced back into the email exactly where the highlighted passage was, so it must read continuously with the text on either side.
Match the shape of what you replace. A replacement for one sentence is a sentence; a replacement for a bullet keeps the leading "- ".
Always write NONE for SUBJECT.

${FORMAT}`;

/** A lone "<the text>" style stand-in rather than anything to put in an email. */
const PLACEHOLDER = /^<[^>\n]{0,120}>$/;

/**
 * Whether the model wrote something or just handed the instructions back.
 *
 * The general test is whether the fragment appears verbatim in the prompt it
 * was given: a real edit is derived from the email, which lives in the user
 * message, so anything short enough to quote and found word for word in the
 * system prompt is the template coming back rather than an answer. This is
 * what catches the "<the text>" that got spliced into a real draft, and it
 * keeps catching the next variant without needing to name it.
 */
function usable(text: string, system: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 2) return false;
  if (PLACEHOLDER.test(trimmed)) return false;
  if (trimmed.includes(START) || trimmed.includes(END)) return false;
  if (trimmed.length < 200 && system.includes(trimmed)) return false;
  return true;
}

/**
 * Pull the reply out of the envelope. Tolerant on purpose: a model that drops
 * the closing marker, or answers with the bare replacement and no markers at
 * all, has still done the work, and throwing that away to be strict about
 * punctuation would fail an edit that is sitting right there. Tolerant of
 * formatting only, though. Content that is visibly not an edit is refused, so
 * the retry gets a chance rather than the draft getting a placeholder in it.
 */
function unwrap(reply: string, system: string): { text: string; subject: string | null } | null {
  const subjectLine = reply.match(/^\s*SUBJECT:\s*(.+)$/m)?.[1]?.trim() ?? '';
  const subject =
    subjectLine && !/^none$/i.test(subjectLine) && !PLACEHOLDER.test(subjectLine) && !system.includes(subjectLine)
      ? subjectLine
      : null;

  const from = reply.indexOf(START);
  let text = '';
  if (from !== -1) {
    const after = from + START.length;
    const to = reply.indexOf(END, after);
    text = reply.slice(after, to === -1 ? undefined : to);
  } else if (!/\{\s*"text"/.test(reply)) {
    // No markers and no half-written JSON envelope: treat the whole reply as
    // the answer, minus the subject line if it wrote one.
    text = reply.replace(/^\s*SUBJECT:.*$/m, '');
  }

  // Only the padding around the block is dropped. Indentation inside it is the
  // sender's bullet list.
  text = text.replace(/^[\r\n]+/, '').replace(/\s+$/, '');
  return usable(text, system) ? { text, subject } : null;
}

/** The model gets a strict budget: a rewritten email is about the length of the
 *  one it was given, and a reply longer than this is a runaway, not an edit. */
const MAX_TOKENS = 1400;

export async function reviseEmail(req: ReviseRequest, nimAuth?: NimAuth): Promise<ReviseResult> {
  const selecting = req.selection !== null && req.selection.trim().length > 0;
  const standing = rulesPrompt(req.rules);

  const system = [selecting ? SELECTION_SYSTEM : WHOLE_SYSTEM, standing].filter(Boolean).join('\n\n');

  const payload = {
    instruction: req.instruction,
    email: { subject: req.subject, body: req.body },
    highlightedPassage: selecting ? req.selection : null,
    professor: {
      name: req.researcher.name,
      title: req.researcher.title,
      school: req.researcher.school,
      department: req.researcher.department,
      researchAreas: req.researcher.researchAreas,
    },
    // Supplied so an instruction like "mention my fencing award" can be carried
    // out from the record rather than imagined.
    sender: {
      name: req.user.name,
      standing: req.user.standing || undefined,
      school: req.user.school || undefined,
      major: req.user.major || undefined,
      experience: req.user.experience.slice(0, 8),
      projects: req.user.projects.slice(0, 6),
      publications: req.user.publications.slice(0, 6),
      skills: req.user.skills.slice(0, 12),
      researchInterests: req.user.researchInterests,
      awards: (req.user.awards ?? []).slice(0, 6),
    },
  };

  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: system },
    { role: 'user', content: JSON.stringify(payload) },
  ];

  // Low temperature: this is an edit to a draft the sender already accepted
  // most of, and creativity here shows up as paragraphs they did not ask to
  // have touched.
  const reply = await nimChat(messages, { temperature: 0.3, maxTokens: MAX_TOKENS }, nimAuth);
  let parsed = unwrap(reply, system);

  if (!parsed) {
    // One corrective round. Smaller models answer the first time by repeating
    // the format instruction back; shown their own reply they generally do the
    // work instead.
    parsed = unwrap(
      await nimChat(
        [
          ...messages,
          { role: 'assistant', content: reply.slice(0, 2000) },
          {
            role: 'user',
            content: `That reply did not contain the revised text. You repeated the format description instead of using it. Write out the actual edited words between ${START} and ${END}, starting your reply with SUBJECT:`,
          },
        ],
        { temperature: 0.2, maxTokens: MAX_TOKENS },
        nimAuth
      ),
      system
    );
  }

  if (!parsed) throw new Error('the model did not return an edit. Try rewording the instruction.');

  const subject =
    parsed.subject && parsed.subject !== req.subject ? parsed.subject.slice(0, 200) : null;

  return { text: parsed.text, subject };
}
