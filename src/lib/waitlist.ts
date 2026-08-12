import { newId, readStore, writeStore } from './store';

export interface WaitlistEntry {
  id: string;
  email: string;
  name: string | null;
  school: string | null;
  createdAt: string;
}

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email);
}

export async function addToWaitlist(input: { email: string; name?: string; school?: string }): Promise<{
  entry: WaitlistEntry;
  alreadyOn: boolean;
  position: number;
}> {
  const entries = await readStore<WaitlistEntry[]>('waitlist', []);
  const email = input.email.trim().toLowerCase();

  const existing = entries.find((e) => e.email === email);
  if (existing) {
    return { entry: existing, alreadyOn: true, position: entries.indexOf(existing) + 1 };
  }

  const entry: WaitlistEntry = {
    id: newId('wl'),
    email,
    name: input.name?.trim() || null,
    school: input.school?.trim() || null,
    createdAt: new Date().toISOString(),
  };
  entries.push(entry);
  await writeStore('waitlist', entries);
  return { entry, alreadyOn: false, position: entries.length };
}

export async function getWaitlist(): Promise<WaitlistEntry[]> {
  return readStore<WaitlistEntry[]>('waitlist', []);
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
