import { cookies } from 'next/headers';
import { UserProfile } from './types';
import { readStore, writeStore } from './store';

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

export function getUserProfile(userId: string): UserProfile | null {
  const users = readStore<Record<string, UserProfile>>('users', {});
  return users[userId] ?? null;
}

export function saveUserProfile(profile: UserProfile): void {
  const users = readStore<Record<string, UserProfile>>('users', {});
  users[profile.id] = profile;
  writeStore('users', users);
}
