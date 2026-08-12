import { NextRequest, NextResponse } from 'next/server';
import { parseResumePdf, parseResumeText, summarize } from '@/lib/resume';
import { getCurrentUserId, getNimAuth, saveUserProfile } from '@/lib/user';
import { UserProfile } from '@/lib/types';

export const dynamic = 'force-dynamic';

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
    return NextResponse.json({ error: 'Resume looks empty. Upload a PDF or paste at least a few lines of text.' }, { status: 400 });
  }

  const parsed = parseResumeText(rawText);
  const { summary, generator } = await summarize(parsed, await getNimAuth(userId));
  const profile: UserProfile = {
    ...parsed,
    id: userId,
    aiSummary: summary,
    updatedAt: new Date().toISOString(),
  };
  await saveUserProfile(profile);
  return NextResponse.json({ profile, summaryGenerator: generator });
}
