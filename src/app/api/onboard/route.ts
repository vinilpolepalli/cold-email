import { NextRequest, NextResponse } from 'next/server';
import { parseResumePdf, parseResumeText, templateSummary } from '@/lib/resume';
import { looksLikeMemoryExport, parseMemoryExport } from '@/lib/memory-import';
import { getCurrentUserId, getUserProfile, saveUserProfile } from '@/lib/user';
import { saveResumeFile } from '@/lib/resume-file';
import { UserProfile } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Upload is deliberately the fast half of onboarding. It extracts the text,
// stores the file, and answers with a deterministic parse. The LLM pass runs
// afterwards through /api/onboard/enhance, so the user is editing their
// profile within a couple of seconds instead of watching a spinner for a
// minute while a model streams.

export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });

  let rawText = '';
  let resumeWarning: string | null = null;
  // Where the text came from. A LinkedIn profile saved to PDF is laid out like
  // a resume and parses the same way; an assistant's memory export is not.
  let source: 'resume' | 'memory' | 'linkedin' = 'resume';
  const contentType = req.headers.get('content-type') ?? '';
  try {
    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData();
      if (form.get('source') === 'linkedin') source = 'linkedin';
      const file = form.get('resume');
      if (file instanceof File) {
        const buffer = Buffer.from(await file.arrayBuffer());
        const isPdf = file.name.toLowerCase().endsWith('.pdf');
        // Text extraction and the file write are independent, and the write
        // is a few hundred KB over the network. Overlapping them takes the
        // slower of the two rather than their sum.
        const [text, saved] = await Promise.all([
          isPdf ? parseResumePdf(buffer) : Promise.resolve(buffer.toString('utf8')),
          // Keep the original file so it can be attached to outgoing emails.
          saveResumeFile(userId, {
            fileName: file.name,
            contentType: file.type || 'application/pdf',
            buffer,
          }),
        ]);
        rawText = text;
        if (!saved.saved) {
          // The parse still succeeds; the caller is told the attachment was
          // rejected rather than being left thinking an old file is current.
          resumeWarning = `That file is over ${saved.limitMb} MB, so it will not be attached to emails. The text was still parsed.`;
        }
      } else {
        rawText = String(form.get('text') ?? '');
      }
    } else {
      const body = await req.json();
      rawText = String(body.text ?? '');
      if (body.source === 'memory' || body.source === 'linkedin') source = body.source;
    }
  } catch (err) {
    return NextResponse.json({ error: `Could not read resume: ${String(err).slice(0, 200)}` }, { status: 400 });
  }

  if (rawText.trim().length < 40) {
    return NextResponse.json(
      {
        error:
          source === 'memory'
            ? 'That export looks empty. Paste everything your assistant returned, including the headings.'
            : 'Resume looks empty. Upload a text-based PDF (not a scan) or paste the text directly.',
      },
      { status: 400 }
    );
  }

  // A pasted export is accepted from any tab: people paste it into the resume
  // box, and refusing it there would be pedantry.
  const asMemory = source === 'memory' || looksLikeMemoryExport(rawText);
  const parsed = asMemory ? parseMemoryExport(rawText) : parseResumeText(rawText);
  const candidate: UserProfile = {
    ...parsed,
    id: userId,
    aiSummary: templateSummary(parsed),
    updatedAt: new Date().toISOString(),
  };

  // A returning user's saved profile is never overwritten here: they may have
  // spent time correcting it, and the new file might be a small edit. The
  // client shows what changed and merges section by section.
  const existing = await getUserProfile(userId);
  if (existing) {
    return NextResponse.json({
      profile: existing,
      candidate,
      isNew: false,
      parser: 'heuristic',
      source: asMemory ? 'memory' : source,
      rawText: parsed.rawResumeText,
      resumeWarning,
    });
  }

  await saveUserProfile(candidate);
  return NextResponse.json({
    profile: candidate,
    candidate,
    isNew: true,
    parser: 'heuristic',
    source: asMemory ? 'memory' : source,
    rawText: parsed.rawResumeText,
    resumeWarning,
  });
}
