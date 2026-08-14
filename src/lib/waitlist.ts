import { findStore, listStore, newId, writeStore } from './store';

export interface WaitlistEntry {
  id: string;
  email: string;
  name: string | null;
  school: string | null;
  createdAt: string;
}

// RFC 5321 caps an address at 254 characters; the free-text fields are capped
// so a few oversized posts cannot bloat storage.
const MAX_EMAIL = 254;
const MAX_FIELD = 200;
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export function isValidEmail(email: string): boolean {
  return email.length <= MAX_EMAIL && EMAIL_RE.test(email);
}

function clamp(value: string | undefined, max: number): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/**
 * Add a signup. Entries are stored one row each, so concurrent signups cannot
 * overwrite one another the way a single shared array would.
 */
export async function addToWaitlist(input: { email: string; name?: string; school?: string }): Promise<void> {
  const email = input.email.trim().toLowerCase();
  const existing = await findStore<WaitlistEntry>('waitlist', 'email', email);
  if (existing.length > 0) return; // idempotent, and the caller is told nothing either way

  const entry: WaitlistEntry = {
    id: newId('wl'),
    email,
    name: clamp(input.name, MAX_FIELD),
    school: clamp(input.school, MAX_FIELD),
    createdAt: new Date().toISOString(),
  };
  await writeStore(`waitlist:${entry.id}`, entry);
}

export async function getWaitlist(): Promise<WaitlistEntry[]> {
  const entries = await listStore<WaitlistEntry>('waitlist');
  return entries.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Only ids listed in WAITLIST_ADMIN_IDS may read the signup list. With the var
 * unset nobody can, so emails are never exposed by an ordinary account.
 */
export function isWaitlistAdmin(userId: string): boolean {
  const ids = (process.env.WAITLIST_ADMIN_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.includes(userId);
}
