import { NextResponse } from 'next/server';
import { clerkMiddleware } from '@clerk/nextjs/server';

// Clerk is optional: with keys set, its middleware powers sign-in (and Gmail
// sending via the user's OAuth token). Without keys the app runs in
// single-user demo mode and nothing is gated.
const hasClerk = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);

/**
 * Anyone can look: the landing page and the researcher directory are open, so
 * a shared link shows the actual product rather than a sign-in wall. Published
 * email addresses are still withheld from signed-out visitors, and everything
 * that writes or sends stays behind sign-in.
 *
 * API routes are left to answer for themselves so callers get JSON rather than
 * an HTML redirect.
 */
const PUBLIC_PAGES = new Set(['/', '/researchers']);
const PUBLIC_PREFIXES = ['/researchers/'];

function isPublic(pathname: string): boolean {
  return PUBLIC_PAGES.has(pathname) || PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export default hasClerk
  ? clerkMiddleware(async (auth, req) => {
      const { pathname } = req.nextUrl;
      if (isPublic(pathname) || pathname.startsWith('/api') || pathname.startsWith('/__clerk')) {
        return NextResponse.next();
      }
      const { userId, redirectToSignIn } = await auth();
      // Sign-up is open, so an anonymous visitor is one step from an account
      // rather than someone to turn away. Send them to Clerk and bring them
      // back to the page they were reaching for.
      if (!userId) return redirectToSignIn({ returnBackUrl: req.url });
      return NextResponse.next();
    })
  : () => NextResponse.next();

export const config = {
  matcher: ['/((?!_next|favicon.ico|.*\\.(?:png|jpg|svg|ico|css|js|map)$).*)', '/(api|trpc)(.*)', '/__clerk/:path*'],
};
