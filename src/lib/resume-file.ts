import { readStore, writeStore } from './store';

// The uploaded resume is kept so it can ride along as an email attachment.
// Stored per user, base64 encoded, under its own key so the user record stays
// small.

export interface StoredResume {
  fileName: string;
  contentType: string;
  base64: string;
  size: number;
  updatedAt: string;
}

/** Gmail and most providers cap attachments well above this; keep it sane. */
export const MAX_RESUME_BYTES = 5 * 1024 * 1024;

function keyFor(userId: string): string {
  return `resume:${userId}`;
}

export async function saveResumeFile(
  userId: string,
  file: { fileName: string; contentType: string; buffer: Buffer }
): Promise<void> {
  if (file.buffer.byteLength > MAX_RESUME_BYTES) return; // silently skip oversize attachments
  const stored: StoredResume = {
    fileName: file.fileName,
    contentType: file.contentType || 'application/pdf',
    base64: file.buffer.toString('base64'),
    size: file.buffer.byteLength,
    updatedAt: new Date().toISOString(),
  };
  await writeStore(keyFor(userId), stored);
}

export async function getResumeFile(userId: string): Promise<StoredResume | null> {
  const stored = await readStore<StoredResume | null>(keyFor(userId), null);
  return stored && stored.base64 ? stored : null;
}

/** Metadata only, for UI that should not download the whole file. */
export async function getResumeFileInfo(
  userId: string
): Promise<{ fileName: string; size: number; updatedAt: string } | null> {
  const stored = await getResumeFile(userId);
  if (!stored) return null;
  return { fileName: stored.fileName, size: stored.size, updatedAt: stored.updatedAt };
}
