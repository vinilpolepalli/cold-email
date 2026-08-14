import fs from 'fs';
import os from 'os';
import path from 'path';

// Key-value persistence with two backends:
//  - Supabase (PostgREST) when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are
//    set: durable and safe across instances. Table: public.sloan_kv
//    (see supabase/schema.sql). The service role key stays server-side.
//  - JSON files when Supabase is not configured: .data/ locally, tmp dir on
//    Vercel (ephemeral).
//
// Records are stored one row per entity ("user:<id>", "outbox:<id>") rather
// than one row per collection. Collection rows require a read-modify-write of
// the whole array, and two overlapping requests each write back a copy missing
// the other's entry, silently dropping data.

const DATA_DIR =
  process.env.DATA_DIR ??
  (process.env.VERCEL ? path.join(os.tmpdir(), 'sloan-data') : path.join(process.cwd(), '.data'));

// The physical table name is historical and predates the rename to Sloan. It
// stays put so an existing deployment keeps working without a migration;
// override with SUPABASE_TABLE if you would rather rename it.
const TABLE = process.env.SUPABASE_TABLE ?? 'labreach_kv';

/** Raised when a configured backend could not be reached or answered badly. */
export class StoreUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoreUnavailableError';
  }
}

export function supabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * Keys become file names, so anything outside this alphabet is rejected. A key
 * derived from user input (a session id, an uploaded name) must never be able
 * to climb out of the data directory with "..".
 */
const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9:_.-]{0,190}$/;

function assertKey(key: string): void {
  if (!KEY_RE.test(key) || key.includes('..')) {
    throw new Error(`Invalid store key: ${JSON.stringify(key.slice(0, 60))}`);
  }
}

function fileFor(key: string): string {
  assertKey(key);
  // ":" is legal on Linux but awkward; map it to "__" for on-disk names.
  const safe = key.replace(/:/g, '__');
  const resolved = path.resolve(DATA_DIR, `${safe}.json`);
  // Belt and braces: even with a validated key, confirm containment.
  if (resolved !== path.join(DATA_DIR, `${safe}.json`)) {
    throw new Error('Refusing to write outside the data directory');
  }
  return resolved;
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

// ── reads ───────────────────────────────────────────────────────────────────

/**
 * Read one record. Throws StoreUnavailableError when the backend is configured
 * but did not definitively answer, so callers never mistake "cannot read" for
 * "does not exist" and write a fallback over live data.
 */
export async function readStore<T>(key: string, fallback: T): Promise<T> {
  assertKey(key);
  if (supabaseConfigured()) {
    let res: Response;
    try {
      res = await sbFetch(`${TABLE}?key=eq.${encodeURIComponent(key)}&select=value`);
    } catch (err) {
      throw new StoreUnavailableError(`Supabase unreachable: ${String(err).slice(0, 150)}`);
    }
    if (!res.ok) {
      throw new StoreUnavailableError(`Supabase read failed (${res.status}): ${(await res.text()).slice(0, 150)}`);
    }
    const rows = (await res.json()) as { value: T }[];
    return rows[0] ? rows[0].value : fallback;
  }
  try {
    return JSON.parse(fs.readFileSync(fileFor(key), 'utf8')) as T;
  } catch {
    return fallback;
  }
}

/** List every record whose key starts with `prefix:`. */
export async function listStore<T>(prefix: string): Promise<T[]> {
  assertKey(prefix);
  if (supabaseConfigured()) {
    let res: Response;
    try {
      res = await sbFetch(`${TABLE}?key=like.${encodeURIComponent(`${prefix}:%`)}&select=value&order=key.asc`);
    } catch (err) {
      throw new StoreUnavailableError(`Supabase unreachable: ${String(err).slice(0, 150)}`);
    }
    if (!res.ok) {
      throw new StoreUnavailableError(`Supabase list failed (${res.status}): ${(await res.text()).slice(0, 150)}`);
    }
    return ((await res.json()) as { value: T }[]).map((r) => r.value);
  }
  try {
    const wanted = `${prefix.replace(/:/g, '__')}__`;
    return fs
      .readdirSync(DATA_DIR)
      .filter((f) => f.startsWith(wanted) && f.endsWith('.json'))
      .sort()
      .map((f) => JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8')) as T);
  } catch {
    return [];
  }
}

/** Find records under `prefix` whose JSON `field` equals `value`. */
export async function findStore<T>(prefix: string, field: string, value: string): Promise<T[]> {
  if (supabaseConfigured()) {
    assertKey(prefix);
    let res: Response;
    try {
      res = await sbFetch(
        `${TABLE}?key=like.${encodeURIComponent(`${prefix}:%`)}&value->>${encodeURIComponent(field)}=eq.${encodeURIComponent(value)}&select=value`
      );
    } catch (err) {
      throw new StoreUnavailableError(`Supabase unreachable: ${String(err).slice(0, 150)}`);
    }
    if (!res.ok) {
      throw new StoreUnavailableError(`Supabase query failed (${res.status}): ${(await res.text()).slice(0, 150)}`);
    }
    return ((await res.json()) as { value: T }[]).map((r) => r.value);
  }
  const all = await listStore<Record<string, unknown>>(prefix);
  return all.filter((r) => r[field] === value) as T[];
}

// ── writes ──────────────────────────────────────────────────────────────────

/**
 * Write one record. Throws on failure rather than degrading silently: a route
 * that answers "saved" after losing the write is worse than an honest error.
 */
export async function writeStore<T>(key: string, value: T): Promise<void> {
  assertKey(key);
  if (supabaseConfigured()) {
    const payload = JSON.stringify([{ key, value, updated_at: new Date().toISOString() }]);
    // A base64 resume runs a few hundred KB and needs a longer window; the
    // edge also resets the occasional connection, so retry once.
    const timeoutMs = payload.length > 100_000 ? 25_000 : 10_000;
    let lastError = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await sbFetch(
          TABLE,
          { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: payload },
          timeoutMs
        );
        if (res.ok) return;
        lastError = `${res.status}: ${(await res.text()).slice(0, 150)}`;
      } catch (err) {
        lastError = String(err).slice(0, 150);
      }
    }
    throw new StoreUnavailableError(`Supabase write failed (${lastError})`);
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const target = fileFor(key);
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, target);
}

export async function deleteStore(key: string): Promise<void> {
  assertKey(key);
  if (supabaseConfigured()) {
    try {
      const res = await sbFetch(`${TABLE}?key=eq.${encodeURIComponent(key)}`, { method: 'DELETE' });
      if (!res.ok) throw new StoreUnavailableError(`Supabase delete failed (${res.status})`);
      return;
    } catch (err) {
      if (err instanceof StoreUnavailableError) throw err;
      throw new StoreUnavailableError(`Supabase unreachable: ${String(err).slice(0, 150)}`);
    }
  }
  try {
    fs.unlinkSync(fileFor(key));
  } catch {
    // already gone
  }
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
