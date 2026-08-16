import { NextRequest, NextResponse } from 'next/server';
import { getDraft } from '@/lib/drafts';
import { getProfile } from '@/lib/profiles';
import { getRules } from '@/lib/preferences';
import { getPublications } from '@/lib/publications';
import { focusFromWorks, generateDraft } from '@/lib/template';
import { getResumeFileInfo } from '@/lib/resume-file';
import { getCurrentUserId, getNimAuth, getUserProfile } from '@/lib/user';
import { FocusPaper, Publication, ResearcherWorks } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_NOTES = 1200;
const MAX_URL = 500;

/** Compare two links ignoring scheme, host casing, and trailing slashes. */
function sameLink(a: string | null | undefined, b: string): boolean {
  if (!a) return false;
  const strip = (url: string) => url.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return strip(a) === strip(b);
}

/**
 * The paper the draft should react to. A link the sender pastes is matched
 * against the researcher's known work first, so the draft gets a real title
 * and abstract to work from rather than a bare URL.
 */
function resolveFocus(
  works: ResearcherWorks,
  user: Parameters<typeof focusFromWorks>[1],
  paperUrl: string,
  paperNotes: string
): FocusPaper | null {
  if (!paperUrl && !paperNotes) return focusFromWorks(works, user);

  const matched: Publication | undefined = paperUrl
    ? works.publications.find(
        (p) =>
          sameLink(p.url, paperUrl) ||
          sameLink(p.pdfUrl, paperUrl) ||
          (p.doi ? paperUrl.toLowerCase().includes(p.doi.toLowerCase()) : false)
      )
    : undefined;

  if (matched) {
    return {
      title: matched.title,
      url: paperUrl || matched.url,
      venue: matched.venue,
      year: matched.year,
      abstract: matched.abstract,
      notes: paperNotes || null,
      source: 'manual',
    };
  }

  // An unrecognised link with no notes tells the draft nothing it can use.
  if (!paperNotes) return focusFromWorks(works, user);

  return { title: null, url: paperUrl || null, venue: null, year: null, abstract: null, notes: paperNotes, source: 'manual' };
}

export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });

  const user = await getUserProfile(userId);
  if (!user) return NextResponse.json({ error: 'Complete onboarding first: upload your resume.' }, { status: 400 });

  const body = await req.json();
  const researcher = await getProfile(body.researcherId);
  if (!researcher) return NextResponse.json({ error: 'Unknown researcher' }, { status: 404 });

  const paperUrl = typeof body.paperUrl === 'string' ? body.paperUrl.trim().slice(0, MAX_URL) : '';
  const paperNotes = typeof body.paperNotes === 'string' ? body.paperNotes.trim().slice(0, MAX_NOTES) : '';
  if (paperUrl && !/^https?:\/\//i.test(paperUrl)) {
    return NextResponse.json({ error: 'Paper link must start with http:// or https://' }, { status: 400 });
  }

  // The draft reacts to one of their papers, so their publication record is
  // fetched (from cache, usually) before writing anything.
  const works = await getPublications(researcher);
  const focus = resolveFocus(works, user, paperUrl, paperNotes);
  // Instructions the sender gave the AI on earlier drafts apply to this one.
  const rules = await getRules(userId);

  // An email already in progress is the one to reopen. Writing a new draft
  // over the top would throw away every edit the sender made last time they
  // were on this screen, which is the whole point of saving it. Asking for a
  // different paper, or pressing regenerate, is an explicit request for new
  // text and skips this.
  const saved = paperUrl || paperNotes || body.regenerate ? null : await getDraft(userId, researcher.id);
  const draft = saved
    ? { subject: saved.subject, body: saved.body, generator: 'saved' as const }
    : await generateDraft(researcher, user, await getNimAuth(userId), works, focus, rules);

  return NextResponse.json({
    draft,
    // The rest of the saved state: who it was going to and what was attached.
    saved,
    researcher,
    resume: await getResumeFileInfo(userId),
    works,
    // Listed on the compose screen so the sender can see what is steering the
    // draft and drop anything that should no longer apply.
    rules,
    // Surfaced so the compose screen can show which paper the draft leans on
    // and link straight to it.
    focusPaper: focus,
  });
}
