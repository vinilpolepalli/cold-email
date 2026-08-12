// NVIDIA NIM client — OpenAI-compatible chat completions at integrate.api.nvidia.com.
// Used for resume summarization and email drafting when NVIDIA_API_KEY is set;
// callers fall back to the deterministic template engine when it isn't.

const NIM_BASE_URL = process.env.NIM_BASE_URL ?? 'https://integrate.api.nvidia.com/v1';
const NIM_MODEL = process.env.NIM_MODEL ?? 'meta/llama-3.3-70b-instruct';

export function nimAvailable(): boolean {
  return Boolean(process.env.NVIDIA_API_KEY);
}

export async function nimChat(
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  opts: { temperature?: number; maxTokens?: number } = {}
): Promise<string> {
  const res = await fetch(`${NIM_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: NIM_MODEL,
      messages,
      temperature: opts.temperature ?? 0.5,
      max_tokens: opts.maxTokens ?? 1024,
    }),
  });
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
