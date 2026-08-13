import type { Metadata } from "next";
import Link from "next/link";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { clerkConfigured, getCurrentUserId } from "@/lib/user";
import { ClerkProvider } from "@clerk/nextjs";
import AuthControls from "@/components/auth-controls";
import AppNav from "@/components/app-nav";
import { getOutbox } from "@/lib/send";

export const metadata: Metadata = {
  title: "LabReach",
  description:
    "Real AI and CS faculty from five top universities. Upload your resume, review a personalized draft, send from your own Gmail.",
};

/** Marketing chrome: 57px header, centred links, pill auth controls. */
function PublicHeader({ withClerk }: { withClerk: boolean }) {
  return (
    <header className="sticky top-0 z-40 h-[57px] border-b border-[#e5e5e5] bg-[#fdfcfc]/95 backdrop-blur-sm">
      {/* Three columns so the links sit centred in the bar, as the reference
          stages them, independent of logo or button width. */}
      <div className="container-page grid h-full grid-cols-[1fr_auto_1fr] items-center gap-6">
        <Link href="/" className="flex items-center gap-2 text-[15px] font-medium tracking-tight">
          <LabReachMark />
          LabReach
        </Link>
        <nav className="hidden items-center gap-6 text-sm md:flex">
          <a href="#how" className="text-black transition-colors hover:text-[#777169]">
            How it works
          </a>
          <a href="#directory" className="text-black transition-colors hover:text-[#777169]">
            Directory
          </a>
          <a href="#access" className="text-black transition-colors hover:text-[#777169]">
            Access
          </a>
        </nav>
        <div className="col-start-3 flex justify-end">
          {withClerk ? (
            <AuthControls />
          ) : (
            <span className="inline-flex h-9 items-center rounded-full border border-[#e5e5e5] bg-white px-3 text-[13px] text-[#777169]">
              Demo mode
            </span>
          )}
        </div>
      </div>
    </header>
  );
}

/** Signed-in chrome: slim top bar plus the left rail from the reference. */
async function AppShell({ children, withClerk }: { children: React.ReactNode; withClerk: boolean }) {
  const userId = await getCurrentUserId();
  const sent = userId ? (await getOutbox(userId)).length : 0;
  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-40 h-[57px] shrink-0 border-b border-[#e5e5e5] bg-[#fdfcfc]/95 backdrop-blur-sm">
        <div className="mx-auto flex h-full max-w-[1400px] items-center gap-4 px-4">
          <Link href="/dashboard" className="flex items-center gap-2 text-[15px] font-medium tracking-tight">
            <LabReachMark />
            LabReach
          </Link>
          <div className="ml-auto">{withClerk ? <AuthControls /> : null}</div>
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-[1400px] flex-1 px-4">
        <aside className="hidden w-[220px] shrink-0 border-r border-[#e5e5e5] md:block">
          <div className="sticky top-[57px]">
            <AppNav sentCount={sent} />
          </div>
        </aside>
        <main className="min-w-0 flex-1 pb-16">{children}</main>
      </div>
    </div>
  );
}

function LabReachMark() {
  return (
    <span className="flex h-6 w-6 items-center justify-center rounded-md bg-black text-[11px] font-medium text-[#fdfcfc]">
      L
    </span>
  );
}

async function Shell({ children, withClerk }: { children: React.ReactNode; withClerk: boolean }) {
  // Clerk gates the app, so a resolved user id means the in-app chrome.
  const signedIn = withClerk ? Boolean(await getCurrentUserId()) : true;
  return (
    <html lang="en" className={`${GeistMono.variable} h-full`}>
      <body className="min-h-full">
        {signedIn ? (
          <AppShell withClerk={withClerk}>{children}</AppShell>
        ) : (
          <div className="flex min-h-full flex-col">
            <PublicHeader withClerk={withClerk} />
            <main className="flex-1">{children}</main>
            <footer className="border-t border-[#e5e5e5] py-8">
              <div className="container-page flex flex-wrap items-center justify-between gap-3 text-[13px] text-[#777169]">
                <span>Profiles come from public university directories. Emails only where a department publishes them.</span>
                <span>Send few, personal emails.</span>
              </div>
            </footer>
          </div>
        )}
      </body>
    </html>
  );
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const withClerk = clerkConfigured();
  if (withClerk) {
    return (
      <ClerkProvider>
        <Shell withClerk>{children}</Shell>
      </ClerkProvider>
    );
  }
  return <Shell withClerk={false}>{children}</Shell>;
}
