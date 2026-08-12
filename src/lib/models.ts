// Model catalogue for the BYOK NIM settings page.
//
// The list is fetched live from the NVIDIA NIM catalogue so users always see
// what is actually on offer, then filtered down to models that make sense for
// writing emails. Embedding, reranking, vision, safety-guard, and speciality
// models are excluded: picking one would silently break draft generation.

export const RECOMMENDED_MODEL = 'z-ai/glm-5.2';

/** Fallback list used when the catalogue cannot be reached. */
export const FALLBACK_MODELS = [
  RECOMMENDED_MODEL,
  'meta/llama-3.3-70b-instruct',
  'nvidia/llama-3.3-nemotron-super-49b-v1.5',
  'openai/gpt-oss-120b',
  'mistralai/mistral-large-2-instruct',
  'moonshotai/kimi-k2.6',
  'deepseek-ai/deepseek-v4-flash-0731',
  'google/gemma-4-31b-it',
];

/** Substrings marking a model as unsuitable for chat-style drafting. */
const EXCLUDE = [
  'embed', 'bge-', 'arctic', 'rerank', 'retriever', 'nvclip', 'guard', 'safety', 'topic-control',
  'reward', 'parse', 'translate', 'vision', '-vl-', 'vila', 'neva', 'kosmos', 'deplot', 'fuyu',
  'video', 'diffusion', 'clip', 'code', 'starcoder', 'calibration', 'omni',
];

/** Models built for prose but worth flagging as speciality picks. */
const SPECIALITY = ['palmyra-med', 'palmyra-fin', 'palmyra-creative', 'chatqa'];

export interface ModelOption {
  id: string;
  label: string;
  recommended: boolean;
  speciality: boolean;
}

function prettify(id: string): string {
  const [vendor, name] = id.includes('/') ? id.split('/') : ['', id];
  const pretty = (name ?? id)
    .replace(/-/g, ' ')
    .replace(/\b(instruct|it)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  const vendorLabel = vendor ? `${vendor.replace(/^z-ai$/, 'Z.ai').replace(/^nv-mistralai$/, 'Mistral')} ` : '';
  return `${vendorLabel}${pretty}`.replace(/\s+/g, ' ').trim();
}

export function toOptions(ids: string[]): ModelOption[] {
  const usable = ids.filter((id) => {
    const lower = id.toLowerCase();
    return !EXCLUDE.some((term) => lower.includes(term));
  });

  const options = usable.map((id) => ({
    id,
    label: prettify(id),
    recommended: id === RECOMMENDED_MODEL,
    speciality: SPECIALITY.some((term) => id.toLowerCase().includes(term)),
  }));

  // Recommended first, then general models, then speciality ones, alphabetical
  // within each group so the list is stable between loads.
  return options.sort((a, b) => {
    if (a.recommended !== b.recommended) return a.recommended ? -1 : 1;
    if (a.speciality !== b.speciality) return a.speciality ? 1 : -1;
    return a.id.localeCompare(b.id);
  });
}

/**
 * Fetch the catalogue. The endpoint is public, but the user's key is sent when
 * present so the response reflects anything specific to their account.
 */
export async function listModels(apiKey?: string | null): Promise<ModelOption[]> {
  const base = process.env.NIM_BASE_URL ?? 'https://integrate.api.nvidia.com/v1';
  try {
    const res = await fetch(`${base}/models`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { data?: { id?: string }[] };
    const ids = (data.data ?? []).map((m) => m.id).filter((id): id is string => Boolean(id));
    if (ids.length === 0) throw new Error('empty catalogue');
    return toOptions(ids);
  } catch {
    return toOptions(FALLBACK_MODELS);
  }
}
