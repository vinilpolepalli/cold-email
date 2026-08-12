import type { Metadata } from "next";
import Link from "next/link";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { clerkConfigured } from "@/lib/user";
import { ClerkProvider } from "@clerk/nextjs";
import AuthControls from "@/components/auth-controls";

export const metadata: Metadata = {
  title: "LabReach",
  description:
    "Real AI and CS faculty profiles from Stanford, Harvard, MIT, and Penn. Upload your resume, review a personalized draft, send from your own Gmail.",
};

const NAV = [
  { href: "/researchers", label: "Researchers" },
  { href: "/onboarding", label: "Onboarding" },
  { href: "/outbox", label: "Outbox" },
  { href: "/scrape", label: "Scraper" },
];

function Shell({ children, withClerk }: { children: React.ReactNode; withClerk: boolean }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        <header className="sticky top-0 z-40 h-16 border-b border-zinc-200 bg-zinc-50/90 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-950/90">
          <div className="mx-auto flex h-full max-w-6xl items-center gap-8 px-4">
            <Link href="/" className="text-lg font-semibold tracking-tight">
              Lab<span className="text-orange-700 dark:text-orange-400">Reach</span>
            </Link>
            <nav className="flex gap-5 text-sm text-zinc-600 dark:text-zinc-400">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <div className="ml-auto text-sm">
              {withClerk ? (
                <AuthControls />
              ) : (
                <span
                  className="rounded-lg border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-500 dark:border-zinc-700 dark:text-zinc-400"
                  title="Set NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY to enable Google sign-in and Gmail sending"
                >
                  Demo mode
                </span>
              )}
            </div>
          </div>
        </header>
        <main className="w-full flex-1">{children}</main>
        <footer className="border-t border-zinc-200 py-6 dark:border-zinc-800">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 text-xs text-zinc-500 dark:text-zinc-400">
            <span>Profiles come from public university directories. Emails are stored only when a university page publishes them.</span>
            <span>Send few, personal emails. Not bulk.</span>
          </div>
        </footer>
      </body>
    </html>
  );
}

export default function RootLayout({ children }: LayoutProps<"/">) {
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
