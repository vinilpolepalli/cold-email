"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// In-app sidebar, matching the reference's dashboard chrome: a tiny uppercase
// section label, icon+label rows, a count badge, then a divided lower group.

const PRIMARY = [
  { href: "/dashboard", label: "Dashboard", icon: SquaresIcon },
  { href: "/researchers", label: "Researchers", icon: SearchIcon },
  { href: "/outbox", label: "Outbox", icon: MailIcon },
  { href: "/scrape", label: "Scraper", icon: SpiderIcon },
];

const SECONDARY = [
  { href: "/onboarding", label: "Profile", icon: UserIcon },
  { href: "/settings", label: "Settings", icon: GearIcon },
];

function Row({
  href,
  label,
  Icon,
  active,
  badge,
}: {
  href: string;
  label: string;
  Icon: (p: { className?: string }) => React.ReactElement;
  active: boolean;
  badge?: number;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
        active ? "bg-[#f5f3f1] font-medium text-black" : "text-[#777169] hover:bg-[#f5f3f1] hover:text-black"
      }`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="flex-1 truncate">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="rounded-full bg-[#e5e5e5] px-1.5 py-0.5 font-mono text-[10px] leading-none text-black">
          {badge}
        </span>
      )}
    </Link>
  );
}

export default function AppNav({ sentCount = 0, isAdmin = false }: { sentCount?: number; isAdmin?: boolean }) {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav className="flex h-full flex-col gap-1 p-3">
      <p className="eyebrow px-3 pt-2 pb-1">Workspace</p>
      {PRIMARY.map((item) => (
        <Row
          key={item.href}
          href={item.href}
          label={item.label}
          Icon={item.icon}
          active={isActive(item.href)}
          badge={item.href === "/outbox" ? sentCount : undefined}
        />
      ))}
      <div className="my-2 h-px bg-[#e5e5e5]" />
      {SECONDARY.map((item) => (
        <Row key={item.href} href={item.href} label={item.label} Icon={item.icon} active={isActive(item.href)} />
      ))}
      {/* Only whoever runs the site can read the signups, so only they see the
          link to them. */}
      {isAdmin && (
        <Row href="/waitlist" label="Waitlist" Icon={ListIcon} active={isActive("/waitlist")} />
      )}
    </nav>
  );
}

// Inline 1.5px-stroke icons keep the set visually consistent and avoid pulling
// a whole icon library into the client bundle for six glyphs.
const S = { fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" } as const;

function ListIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...S}>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <circle cx="3.5" cy="6" r="1" />
      <circle cx="3.5" cy="12" r="1" />
      <circle cx="3.5" cy="18" r="1" />
    </svg>
  );
}

function SquaresIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...S}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...S}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function MailIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...S}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3.5 7 8.5 6 8.5-6" />
    </svg>
  );
}

function SpiderIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...S}>
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 3v5M12 16v5M3 12h5M16 12h5M6 6l3 3M18 6l-3 3M6 18l3-3M18 18l-3-3" />
    </svg>
  );
}

function UserIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...S}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </svg>
  );
}

function GearIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...S}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" />
    </svg>
  );
}
