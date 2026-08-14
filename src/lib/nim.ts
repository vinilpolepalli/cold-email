// NVIDIA NIM client — OpenAI-compatible chat completions at integrate.api.nvidia.com.
// BYOK: each user can store their own key on the Settings page; it takes
// precedence over the server-wide NVIDIA_API_KEY env var. Callers fall back
// to the deterministic template engine when neither is present.

import { RECOMMENDED_MODEL } from './models';

const NIM_BASE_URL = process.env.NIM_BASE_URL ?? 'https://integrate.api.nvidia.com/v1';
const DEFAULT_MODEL = RECOMMENDED_MODEL;

export interface NimAuth {
  apiKey?: string | null;
  model?: string | null;
}

function resolveKey(auth?: NimAuth): string | undefined {
  return auth?.apiKey || process.env.NVIDIA_API_KEY || undefined;
}

export function nimAvailable(auth?: NimAuth): boolean {
  return Boolean(resolveKey(auth));
}

/** A cold model on the free tier can idle for a while before its first token. */
const DEFAULT_TIMEOUT_MS = 90_000;

export async function nimChat(
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  opts: { temperature?: number; maxTokens?: number; timeoutMs?: number } = {},
  auth?: NimAuth
): Promise<string> {
  const key = resolveKey(auth);
  if (!key) throw new Error('No NIM API key available');
  let res: Response;
  try {
    res = await fetch(`${NIM_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: auth?.model || process.env.NIM_MODEL || DEFAULT_MODEL,
        messages,
        temperature: opts.temperature ?? 0.5,
        max_tokens: opts.maxTokens ?? 1024,
      }),
      // Without this a hung upstream holds the request until the platform
      // kills the whole function, which reads to the user as the app freezing.
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new Error(`NIM request timed out after ${Math.round((opts.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000)}s`);
    }
    throw err;
  }
  if (!res.ok) {
    throw new Error(`NIM request failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('NIM returned no content');
  return content;
}

/** Extract the first JSON object from an LLM reply that may include prose or code fences. */
export function extractJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object in NIM reply');
  return JSON.parse(candidate.slice(start, end + 1)) as T;
}
