import { NextRequest, NextResponse } from 'next/server';
import { addScrapedProfiles } from '@/lib/profiles';
import { scrapeUniversity } from '@/lib/scraper';
import { getCurrentUserId } from '@/lib/user';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });

  const { url, school, maxPages, save } = await req.json();
  if (!url || !/^https?:\/\//.test(url)) {
    return NextResponse.json({ error: 'Provide a full http(s) faculty-directory URL' }, { status: 400 });
  }

  try {
    const result = await scrapeUniversity(url, { school, maxPages });
    let added = 0;
    if (save !== false && result.profiles.length > 0) {
      added = addScrapedProfiles(result.profiles);
    }
    return NextResponse.json({ ...result, added });
  } catch (err) {
    return NextResponse.json({ error: `Scrape failed: ${String(err).slice(0, 300)}` }, { status: 502 });
  }
}
