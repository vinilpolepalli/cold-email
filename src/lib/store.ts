import fs from 'fs';
import path from 'path';

// Simple JSON-file persistence. User data and the outbox live in .data/
// (gitignored); the researcher directory lives in data/profiles.json
// (checked in, produced by the scraping agents).

const DATA_DIR = path.join(process.cwd(), '.data');

function fileFor(name: string): string {
  return path.join(DATA_DIR, `${name}.json`);
}

export function readStore<T>(name: string, fallback: T): T {
  try {
    const raw = fs.readFileSync(fileFor(name), 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeStore<T>(name: string, value: T): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = fileFor(name) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, fileFor(name));
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
