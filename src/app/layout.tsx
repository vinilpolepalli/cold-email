import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { clerkConfigured } from "@/lib/user";
import { ClerkProvider } from "@clerk/nextjs";
import AuthControls from "@/components/auth-controls";

export const metadata: Metadata = {
  title: "LabReach — cold email real researchers",
  description:
    "Browse real AI/CS faculty profiles scraped from Stanford, Harvard, MIT, and Penn — then send a personalized cold email built from your resume.",
};

const NAV = [
  { href: "/researchers", label: "Researchers" },
  { href: "/onboarding", label: "Onboarding" },
  { href: "/outbox", label: "Outbox" },
  { href: "/scrape", label: "Scraper" },
];

function Shell({ children, withClerk }: { children: React.ReactNode; withClerk: boolean }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-slate-50 text-slate-900">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
            <Link href="/" className="text-lg font-bold tracking-tight text-indigo-700">
              LabReach
            </Link>
            <nav className="flex gap-4 text-sm text-slate-600">
              {NAV.map((item) => (
                <Link key={item.href} href={item.href} className="hover:text-indigo-700">
                  {item.label}
                </Link>
              ))}
            </nav>
            <div className="ml-auto text-sm">
              {withClerk ? (
                <AuthControls />
              ) : (
                <span
                  className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800"
                  title="Set NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY to enable Google sign-in and real Gmail sending"
                >
                  Demo mode — no sign-in configured
                </span>
              )}
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
        <footer className="border-t border-slate-200 bg-white py-4 text-center text-xs text-slate-400">
          LabReach demo — profiles scraped from public university directories. Be respectful: send few, personalized emails.
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
