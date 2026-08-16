// Standing instructions the sender has given the AI about how their emails
// should read. Every prompt typed into the compose editor is kept here and
// replayed into future drafts, so a correction made once does not have to be
// made again on the next professor.
//
// The list is deliberately visible and deletable in the UI. Saving silently is
// only tolerable if the sender can see what has accumulated and drop a rule
// that has stopped being true.

import { readStore, writeStore } from './store';

export interface EmailRule {
  id: string;
  /** The instruction as the sender typed it. */
  text: string;
  createdAt: string;
  /** Whether it is currently being applied. Kept rather than deleted so a rule
   *  can be muted for one email and switched back on without retyping. */
  enabled: boolean;
}

/** Long enough for a real instruction, short enough that nobody pastes an essay
 *  into the system prompt. */
export const MAX_RULE_LENGTH = 400;

/** Past this the rules start to crowd out the email itself in the prompt, and
 *  a list nobody prunes stops describing what the sender actually wants. */
export const MAX_RULES = 40;

function rulesKey(userId: string): string {
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(userId)) throw new Error('Unsupported user id');
  return `rules:${userId}`;
}

export async function getRules(userId: string): Promise<EmailRule[]> {
  const stored = await readStore<EmailRule[] | null>(rulesKey(userId), null);
  if (!Array.isArray(stored)) return [];
  // `enabled` was added after the first rules were written, so an older record
  // has no such field. Absent means on.
  return stored
    .filter((r) => r && typeof r.text === 'string' && r.text.trim().length > 0)
    .map((r) => ({ ...r, enabled: r.enabled !== false }));
}

export function normalizeRule(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_RULE_LENGTH);
}

/**
 * Store an instruction. Returns the saved rule, or the existing one when the
 * same instruction is already held: someone who types "keep it shorter" three
 * times in a row means it once, and three copies in the prompt is just three
 * chances for the model to over-correct.
 */
export async function addRule(userId: string, text: string): Promise<EmailRule | null> {
  const cleaned = normalizeRule(text);
  if (!cleaned) return null;

  const rules = await getRules(userId);
  const existing = rules.find((r) => r.text.toLowerCase() === cleaned.toLowerCase());
  if (existing) {
    // Typing it again is a request for it to be in force, whatever state it
    // was left in.
    if (!existing.enabled) {
      existing.enabled = true;
      await writeStore(rulesKey(userId), rules);
    }
    return existing;
  }

  const rule: EmailRule = {
    id: `rule_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    text: cleaned,
    createdAt: new Date().toISOString(),
    enabled: true,
  };
  // Oldest first, so the prompt reads in the order the sender taught them and
  // a later instruction can override an earlier one.
  const next = [...rules, rule].slice(-MAX_RULES);
  await writeStore(rulesKey(userId), next);
  return rule;
}

export async function deleteRule(userId: string, id: string): Promise<EmailRule[]> {
  const rules = await getRules(userId);
  const next = rules.filter((r) => r.id !== id);
  await writeStore(rulesKey(userId), next);
  return next;
}

export async function setRuleEnabled(userId: string, id: string, enabled: boolean): Promise<EmailRule[]> {
  const rules = await getRules(userId);
  const next = rules.map((r) => (r.id === id ? { ...r, enabled } : r));
  await writeStore(rulesKey(userId), next);
  return next;
}

/**
 * The rules as a block for a system prompt. Numbered because an unnumbered
 * list of sentences blurs into the instructions above it, and empty when
 * nothing is enabled so no caller has to special-case the blank string.
 */
export function rulesPrompt(rules: EmailRule[]): string {
  const active = rules.filter((r) => r.enabled);
  if (!active.length) return '';
  return [
    'The sender has given you standing instructions about how their emails should read.',
    'They outrank the style guidance above wherever the two disagree. They never outrank the factual rules:',
    'an instruction cannot license inventing an employer, a metric, a paper or a link that was not supplied.',
    '',
    ...active.map((r, i) => `${i + 1}. ${r.text}`),
  ].join('\n');
}
