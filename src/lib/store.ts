import fs from 'fs';
import os from 'os';
import path from 'path';

// Key-value persistence with two backends:
//  - Supabase (PostgREST) when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are
//    set: durable, multi-instance safe. Table: public.labreach_kv
//    (see supabase/schema.sql). The service role key stays server-side.
//  - JSON files otherwise: .data/ locally, tmp dir on Vercel (ephemeral).
// User data and the outbox live here; the researcher directory lives in
// data/profiles.json (checked in, produced by the scraping agents).

const DATA_DIR =
  process.env.DATA_DIR ??
  (process.env.VERCEL ? path.join(os.tmpdir(), 'labreach-data') : path.join(process.cwd(), '.data'));

const TABLE = 'labreach_kv';

function supabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function sbFetch(pathname: string, init?: RequestInit, timeoutMs = 10000): Promise<Response> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return fetch(`${process.env.SUPABASE_URL}/rest/v1/${pathname}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
}

function fileFor(name: string): string {
  return path.join(DATA_DIR, `${name}.json`);
}

function readFile<T>(name: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(fileFor(name), 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export async function readStore<T>(name: string, fallback: T): Promise<T> {
  if (supabaseConfigured()) {
    try {
      const res = await sbFetch(`${TABLE}?key=eq.${encodeURIComponent(name)}&select=value`);
      if (res.ok) {
        const rows = (await res.json()) as { value: T }[];
        if (rows[0]) return rows[0].value;
      }
    } catch {
      // reads should not take the app down
    }
    // Nothing in Postgres: a previous write may have degraded to the file
    // fallback, so check there before giving up.
    return readFile(name, fallback);
  }
  return readFile(name, fallback);
}

export async function writeStore<T>(name: string, value: T): Promise<void> {
  if (supabaseConfigured()) {
    const payload = JSON.stringify([{ key: name, value, updated_at: new Date().toISOString() }]);
    // Larger rows (a base64 resume runs a few hundred KB) need a longer window,
    // and the edge occasionally resets a connection, so retry once.
    const timeoutMs = payload.length > 100_000 ? 25_000 : 10_000;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await sbFetch(
          TABLE,
          { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: payload },
          timeoutMs
        );
        if (res.ok) return;
        if (attempt === 1) {
          console.warn(
            `Supabase write failed (${res.status}): ${(await res.text()).slice(0, 200)} — ` +
              'falling back to file storage. If this is PGRST205, run supabase/schema.sql once.'
          );
        }
      } catch (err) {
        if (attempt === 1) {
          console.warn(`Supabase unreachable, falling back to file storage: ${String(err).slice(0, 150)}`);
        }
      }
    }
    // fall through: degraded (ephemeral on Vercel) but the app keeps working
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = fileFor(name) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, fileFor(name));
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
