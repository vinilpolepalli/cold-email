import { NextRequest, NextResponse } from 'next/server';
import { TRACKS, canArm, canAutoSend, countByTrack, getTrackStates, isTrackId, setAutonomous } from '@/lib/tracks';
import { getAllProfiles } from '@/lib/profiles';
import { isCampaignSchool } from '@/lib/schools';
import { getCurrentUserId } from '@/lib/user';

export const dynamic = 'force-dynamic';

/** Each track, how many professors are in it, and where its gate stands. */
export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });

  const [states, profiles] = await Promise.all([getTrackStates(userId), getAllProfiles()]);
  // Counted over the campaign schools only, since that is the population the
  // routines will ever draw from.
  const counts = countByTrack(profiles.filter((p) => isCampaignSchool(p.school)));
  const withEmail = countByTrack(profiles.filter((p) => isCampaignSchool(p.school) && Boolean(p.email)));

  return NextResponse.json({
    tracks: TRACKS.map((track) => ({
      id: track.id,
      label: track.label,
      blurb: track.blurb,
      professors: counts[track.id],
      reachable: withEmail[track.id],
      state: states[track.id],
      canArm: canArm(states[track.id]),
      autoSending: canAutoSend(states[track.id]),
    })),
  });
}

/** Arm or disarm autonomous sending for one track. */
export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  if (!isTrackId(body?.trackId)) return NextResponse.json({ error: 'Unknown track' }, { status: 400 });

  try {
    const state = await setAutonomous(userId, body.trackId, body.autonomous === true);
    return NextResponse.json({ state });
  } catch (err) {
    // setAutonomous refuses to arm a track that has not been proven yet, and
    // its message says how many more reviewed sends it needs.
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
