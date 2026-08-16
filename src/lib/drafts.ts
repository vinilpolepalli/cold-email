// Work in progress on the compose screen, kept per researcher so leaving the
// page and coming back does not throw away edits. One record per (user,
// researcher) pair, overwritten in place: this is the current state of one
// email, not a history of it.

import { readStore, writeStore, deleteStore } from './store';

export interface SavedDraft {
  researcherId: string;
  subject: string;
  body: string;
  to: string;
  cc: string[];
  attachResume: boolean;
  updatedAt: string;
}

/** Bounds that stop a runaway client from writing an unbounded record. */
const MAX_BODY = 20_000;
const MAX_LINE = 500;
const MAX_CC = 20;

function draftKey(userId: string, researcherId: string): string {
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(userId)) throw new Error('Unsupported user id');
  // Researcher ids come from the scraper and are already slug-shaped, but this
  // string becomes a storage key, so it is checked rather than trusted.
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,120}$/.test(researcherId)) throw new Error('Unsupported researcher id');
  return `draft:${userId}:${researcherId}`;
}

export async function getDraft(userId: string, researcherId: string): Promise<SavedDraft | null> {
  try {
    return await readStore<SavedDraft | null>(draftKey(userId, researcherId), null);
  } catch {
    // An id that cannot form a key has no saved draft, which is the answer the
    // caller needs. Composing should not fail over it.
    return null;
  }
}

export async function saveDraft(
  userId: string,
  researcherId: string,
  draft: Omit<SavedDraft, 'researcherId' | 'updatedAt'>
): Promise<SavedDraft> {
  const record: SavedDraft = {
    researcherId,
    subject: draft.subject.slice(0, MAX_LINE),
    body: draft.body.slice(0, MAX_BODY),
    to: draft.to.slice(0, MAX_LINE),
    cc: draft.cc.filter((c) => typeof c === 'string' && c.trim()).slice(0, MAX_CC).map((c) => c.trim().slice(0, MAX_LINE)),
    attachResume: Boolean(draft.attachResume),
    updatedAt: new Date().toISOString(),
  };
  await writeStore(draftKey(userId, researcherId), record);
  return record;
}

/** Called once the email has actually gone out or been queued, so the compose
 *  screen does not reopen on a draft that has already been sent. */
export async function discardDraft(userId: string, researcherId: string): Promise<void> {
  try {
    await deleteStore(draftKey(userId, researcherId));
  } catch {
    // Nothing saved, or an id that cannot form a key. Either way there is
    // nothing to clean up and the send has already succeeded.
  }
}
