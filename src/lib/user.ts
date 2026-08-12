import { cookies } from 'next/headers';
import { UserProfile } from './types';
import { readStore, writeStore } from './store';
import { NimAuth } from './nim';

export function clerkConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);
}

/**
 * Resolve the current user id. With Clerk configured this is the Clerk user id
 * (auth required); otherwise the app runs in demo mode with a single local user.
 */
export async function getCurrentUserId(): Promise<string | null> {
  if (clerkConfigured()) {
    const { auth } = await import('@clerk/nextjs/server');
    const { userId } = await auth();
    return userId;
  }
  const jar = await cookies();
  return jar.get('demo_user')?.value || 'demo-user';
}

export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const users = await readStore<Record<string, UserProfile>>('users', {});
  return users[userId] ?? null;
}

export async function saveUserProfile(profile: UserProfile): Promise<void> {
  const users = await readStore<Record<string, UserProfile>>('users', {});
  users[profile.id] = profile;
  await writeStore('users', users);
}

// ── Per-user settings (BYOK NVIDIA NIM key, model override) ─────────────────

export interface UserSettings {
  nimApiKey: string | null;
  nimModel: string | null;
}

const EMPTY_SETTINGS: UserSettings = { nimApiKey: null, nimModel: null };

export async function getUserSettings(userId: string): Promise<UserSettings> {
  const all = await readStore<Record<string, UserSettings>>('settings', {});
  return { ...EMPTY_SETTINGS, ...all[userId] };
}

export async function saveUserSettings(userId: string, settings: UserSettings): Promise<void> {
  const all = await readStore<Record<string, UserSettings>>('settings', {});
  all[userId] = settings;
  await writeStore('settings', all);
}

/** NIM auth for a user: their own key first, server env key as fallback. */
export async function getNimAuth(userId: string): Promise<NimAuth> {
  const settings = await getUserSettings(userId);
  return { apiKey: settings.nimApiKey, model: settings.nimModel };
}
