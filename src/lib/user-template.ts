import { readStore, writeStore, deleteStore } from './store';
import { TrackId } from './types';
import { TRACK_IDS, isTrackId } from './tracks';

// The sender's own cold email, kept and reused.
//
// preferences.ts already holds the corrections the sender types while editing
// a draft ("keep it shorter", "do not open with a compliment"). This is the
// other half: the actual email they have written and want every draft to be
// shaped like. A rule describes a preference; a template shows it.
//
// Templates are per track, because that is the unit the sender proves and arms
// in tracks.ts. The email that works on a robotics lab is not the email that
// works on a genomics lab, and pretending one template covers both is how a
// track gets armed on evidence that does not apply to it. A template with no
// track set is the default, used by any track without its own.

export type TemplateMode = 'skeleton' | 'reference';

export interface EmailTemplate {
  /** The sender's text, exactly as they pasted it. */
  text: string;
  /**
   * skeleton: follow this structure closely, swapping in the specifics.
   * reference: match the voice and length, but write it fresh.
   */
  mode: TemplateMode;
  /** Which track this template is for. Null means it is the default. */
  trackId: TrackId | null;
  updatedAt: string;
}

/** Long enough for a real email with room to spare, short enough not to crowd
 *  the professor's own details out of the prompt. */
export const MAX_TEMPLATE_LENGTH = 6000;

function templateKey(userId: string, trackId: TrackId | null): string {
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(userId)) throw new Error('Unsupported user id');
  return trackId ? `template:${userId}:${trackId}` : `template:${userId}:default`;
}

export async function getTemplate(userId: string, trackId: TrackId | null): Promise<EmailTemplate | null> {
  try {
    const stored = await readStore<EmailTemplate | null>(templateKey(userId, trackId), null);
    return stored?.text?.trim() ? stored : null;
  } catch {
    return null;
  }
}

/**
 * The template a draft for this track should use: the track's own if it has
 * one, otherwise the default. Returns null when the sender has supplied
 * neither, in which case the built-in shape in template.ts applies.
 */
export async function resolveTemplate(userId: string, trackId: TrackId): Promise<EmailTemplate | null> {
  return (await getTemplate(userId, trackId)) ?? (await getTemplate(userId, null));
}

export async function saveTemplate(
  userId: string,
  trackId: TrackId | null,
  text: string,
  mode: TemplateMode
): Promise<EmailTemplate | null> {
  const cleaned = text.replace(/\r\n/g, '\n').trim().slice(0, MAX_TEMPLATE_LENGTH);
  if (!cleaned) {
    await deleteStore(templateKey(userId, trackId)).catch(() => {});
    return null;
  }
  const template: EmailTemplate = {
    text: cleaned,
    mode: mode === 'skeleton' ? 'skeleton' : 'reference',
    trackId,
    updatedAt: new Date().toISOString(),
  };
  await writeStore(templateKey(userId, trackId), template);
  return template;
}

export async function deleteTemplate(userId: string, trackId: TrackId | null): Promise<void> {
  await deleteStore(templateKey(userId, trackId)).catch(() => {});
}

/** Every template the sender has, for the settings screen. */
export async function listTemplates(userId: string): Promise<Record<string, EmailTemplate | null>> {
  const out: Record<string, EmailTemplate | null> = { default: await getTemplate(userId, null) };
  for (const id of TRACK_IDS) out[id] = await getTemplate(userId, id);
  return out;
}

export function parseTrackParam(value: unknown): TrackId | null {
  if (value === null || value === undefined || value === '' || value === 'default') return null;
  if (isTrackId(value)) return value;
  throw new Error('Unknown track');
}

/**
 * The template as a prompt block, in the same shape rulesPrompt() uses.
 *
 * The factual guardrail is restated here and deliberately outranks the
 * template. A pasted template will contain the specifics of whoever it was
 * originally written to, and without this the model happily carries "your
 * recent Nature paper on protein folding" over to a professor who has never
 * written one.
 */
export function templatePrompt(template: EmailTemplate | null): string {
  if (!template) return '';

  const instruction =
    template.mode === 'skeleton'
      ? [
          'Follow this template closely. Keep its structure, its order of ideas, its paragraph',
          'breaks and its sign-off. Replace every specific detail with the details of the professor',
          'and student supplied above.',
        ].join(' ')
      : [
          'Use this as a reference for voice, length and register. Do not copy its sentences.',
          'Write a fresh email that sounds like the same person wrote it.',
        ].join(' ');

  return [
    "The sender has supplied their own cold email as a template.",
    instruction,
    '',
    'Any name, paper, lab, metric or date inside the template belongs to the email it was',
    'originally written for. Never carry those over. Where the template states a fact, substitute',
    'the corresponding fact from the data supplied above, and if there is none, drop the sentence',
    'rather than inventing a replacement.',
    '',
    '--- TEMPLATE START ---',
    template.text,
    '--- TEMPLATE END ---',
  ].join('\n');
}
