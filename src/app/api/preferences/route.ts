import { NextRequest, NextResponse } from 'next/server';
import { addRule, deleteRule, getRules, setRuleEnabled } from '@/lib/preferences';
import { getCurrentUserId } from '@/lib/user';

export const dynamic = 'force-dynamic';

/** The standing instructions the sender has given the AI about their emails. */
export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  return NextResponse.json({ rules: await getRules(userId) });
}

/** Add a rule without editing an email first, from the settings screen. */
export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });

  const body = await req.json();
  const text = typeof body.text === 'string' ? body.text : '';
  const rule = await addRule(userId, text);
  if (!rule) return NextResponse.json({ error: 'Write the instruction first' }, { status: 400 });

  return NextResponse.json({ rule, rules: await getRules(userId) });
}

/** Mute or unmute a rule without losing it. */
export async function PATCH(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });

  const body = await req.json();
  if (typeof body.id !== 'string' || typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: 'Which rule, and on or off?' }, { status: 400 });
  }
  return NextResponse.json({ rules: await setRuleEnabled(userId, body.id, body.enabled) });
}

export async function DELETE(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Which rule?' }, { status: 400 });

  return NextResponse.json({ rules: await deleteRule(userId, id) });
}
