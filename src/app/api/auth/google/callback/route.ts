import { NextRequest, NextResponse } from 'next/server';
import { completeConsent, consumeState } from '@/lib/sender-identity';

export const dynamic = 'force-dynamic';

/**
 * Where Google sends the browser back to. This runs in a popup, so it answers
 * with a small page that reports the outcome to the settings tab and closes
 * itself, rather than redirecting into the app.
 *
 * The user is taken from the state nonce, never from the session: the callback
 * arrives on a plain browser navigation, and binding the mailbox to whoever
 * happens to be signed in at that moment is how the wrong account gets
 * attached.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const error = params.get('error');
  const code = params.get('code');
  const state = params.get('state');

  if (error) return closingPage(false, describeGoogleError(error));
  if (!code || !state) return closingPage(false, 'Google did not return an authorization code.');

  const userId = await consumeState(state);
  if (!userId) {
    return closingPage(false, 'That connection link had already been used or had expired. Start again from Settings.');
  }

  const result = await completeConsent(userId, code, req.nextUrl.origin);
  return result.ok
    ? closingPage(true, `Connected ${result.identity.email}`)
    : closingPage(false, result.error);
}

function describeGoogleError(error: string): string {
  if (error === 'access_denied') return 'Connection cancelled, so no account was attached.';
  return `Google refused the connection (${error.slice(0, 100)}).`;
}

/**
 * A self-closing page. postMessage lets the opener refresh immediately; the
 * text underneath is what the user sees if the popup was blocked from closing
 * or was opened as a normal tab.
 */
function closingPage(ok: boolean, message: string): NextResponse {
  const payload = JSON.stringify({ source: 'sloan-google-oauth', ok, message });
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${ok ? 'Connected' : 'Not connected'}</title>
<style>
 body{font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#faf9f8;color:#1a1a1a;
      display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px}
 .card{max-width:420px;text-align:center;background:#fff;border:1px solid #e5e5e5;border-radius:14px;padding:28px}
 h1{font-size:16px;margin:0 0 8px}p{font-size:14px;line-height:1.5;color:#777169;margin:0}
 .dot{width:8px;height:8px;border-radius:99px;display:inline-block;margin-right:6px;background:${ok ? '#16a34a' : '#dc2626'}}
</style></head>
<body><div class="card">
  <h1><span class="dot"></span>${ok ? 'Account connected' : 'Not connected'}</h1>
  <p>${escapeHtml(message)}</p>
  <p style="margin-top:12px">You can close this window.</p>
</div>
<script>
  try { window.opener && window.opener.postMessage(${payload}, window.location.origin); } catch (e) {}
  setTimeout(function () { window.close(); }, ${ok ? 1200 : 4000});
</script></body></html>`;

  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
