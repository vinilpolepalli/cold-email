import { deleteStore, readStore, writeStore } from './store';

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

export type SaveResumeResult = { saved: true } | { saved: false; reason: 'too-large'; limitMb: number };

function keyFor(userId: string): string {
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(userId)) throw new Error('Unsupported user id');
  return `resume:${userId}`;
}

export async function saveResumeFile(
  userId: string,
  file: { fileName: string; contentType: string; buffer: Buffer }
): Promise<SaveResumeResult> {
  if (file.buffer.byteLength > MAX_RESUME_BYTES) {
    // Drop any previous file too. Silently keeping the old one means the next
    // send quietly attaches a stale resume the user thinks they replaced.
    await deleteStore(keyFor(userId));
    return { saved: false, reason: 'too-large', limitMb: MAX_RESUME_BYTES / (1024 * 1024) };
  }
  const stored: StoredResume = {
    // Strip path separators and quotes: this string ends up in a MIME
    // Content-Disposition parameter.
    fileName: file.fileName.replace(/[\\/"\r\n]/g, '_').slice(0, 120) || 'resume.pdf',
    contentType: /^[\w.+-]+\/[\w.+-]+$/.test(file.contentType) ? file.contentType : 'application/pdf',
    base64: file.buffer.toString('base64'),
    size: file.buffer.byteLength,
    updatedAt: new Date().toISOString(),
  };
  await writeStore(keyFor(userId), stored);
  return { saved: true };
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
