import { NextRequest, NextResponse } from 'next/server';
import { aiParseResume, parseResumePdf, parseResumeText, summarize } from '@/lib/resume';
import { getCurrentUserId, getNimAuth, saveUserProfile } from '@/lib/user';
import { UserProfile } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });

  let rawText = '';
  const contentType = req.headers.get('content-type') ?? '';
  try {
    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData();
      const file = form.get('resume');
      if (file instanceof File) {
        const buffer = Buffer.from(await file.arrayBuffer());
        rawText = file.name.toLowerCase().endsWith('.pdf')
          ? await parseResumePdf(buffer)
          : buffer.toString('utf8');
      } else {
        rawText = String(form.get('text') ?? '');
      }
    } else {
      const body = await req.json();
      rawText = String(body.text ?? '');
    }
  } catch (err) {
    return NextResponse.json({ error: `Could not read resume: ${String(err).slice(0, 200)}` }, { status: 400 });
  }

  if (rawText.trim().length < 40) {
    return NextResponse.json(
      { error: 'Resume looks empty. Upload a text-based PDF (not a scan) or paste the text directly.' },
      { status: 400 }
    );
  }

  const nimAuth = await getNimAuth(userId);

  // Prefer LLM extraction (handles any resume layout); fall back to the
  // deterministic parser when no key is set or the model misfires.
  const ai = await aiParseResume(rawText, nimAuth);
  let parser: 'nim' | 'heuristic';
  let summaryGenerator: 'nim' | 'template';
  let parsed;
  let summary: string;

  if (ai) {
    parser = 'nim';
    const { summary: aiSummary, ...fields } = ai;
    parsed = fields;
    if (aiSummary) {
      summary = aiSummary;
      summaryGenerator = 'nim';
    } else {
      const s = await summarize(fields, nimAuth);
      summary = s.summary;
      summaryGenerator = s.generator;
    }
  } else {
    parser = 'heuristic';
    parsed = parseResumeText(rawText);
    const s = await summarize(parsed, nimAuth);
    summary = s.summary;
    summaryGenerator = s.generator;
  }

  const profile: UserProfile = {
    ...parsed,
    id: userId,
    aiSummary: summary,
    updatedAt: new Date().toISOString(),
  };
  await saveUserProfile(profile);
  return NextResponse.json({ profile, parser, summaryGenerator });
}
