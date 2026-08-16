// Editing a draft in place from a typed instruction. The compose screen sends
// either the whole body or a highlighted passage; this returns the rewritten
// text and nothing else, so the caller can splice it back exactly where it came
// from.

import { NimAuth, extractJson, nimChat } from './nim';
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

const WHOLE_SYSTEM = `You are editing a cold email a student is sending to a professor. The student has told you what to change. Apply that change to the whole email and return the complete revised email.

${SHARED_RULES}
Preserve the parts the instruction does not touch. This is an edit, not a rewrite: if the instruction is about one paragraph, the other paragraphs should come back unchanged.
Keep the greeting and the signature block intact unless the instruction is about them.

Reply ONLY with JSON: {"text": string, "subject": string or null}. "text" is the complete revised email body. "subject" is a new subject line ONLY if the instruction was about the subject, otherwise null.`;

const SELECTION_SYSTEM = `You are editing one passage of a cold email a student is sending to a professor. You are given the whole email for context and the exact passage the student highlighted. Apply their instruction to the highlighted passage ONLY.

${SHARED_RULES}
Return a replacement for the highlighted passage and nothing else: no surrounding sentences, no quotation marks around it, no explanation. It will be spliced back into the email exactly where the highlighted passage was, so it must read continuously with the text on either side.
Match the shape of what you replace. A replacement for one sentence is a sentence; a replacement for a bullet keeps the leading "- ".

Reply ONLY with JSON: {"text": string, "subject": null}.`;

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

  const reply = await nimChat(
    [
      { role: 'system', content: system },
      { role: 'user', content: JSON.stringify(payload) },
    ],
    // Low temperature: this is an edit to a draft the sender already accepted
    // most of, and creativity here shows up as paragraphs they did not ask to
    // have touched.
    { temperature: 0.3, maxTokens: MAX_TOKENS },
    nimAuth
  );

  const parsed = extractJson<{ text?: unknown; subject?: unknown }>(reply);
  const text = typeof parsed.text === 'string' ? parsed.text.trim() : '';
  if (!text) throw new Error('The model returned nothing to apply');

  const subject =
    typeof parsed.subject === 'string' && parsed.subject.trim() && parsed.subject.trim() !== req.subject
      ? parsed.subject.trim().slice(0, 200)
      : null;

  return { text, subject };
}
