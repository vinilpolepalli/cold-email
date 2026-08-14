import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

// Shared primitives measured off the Tsenta reference: 36px pill controls,
// 1px #E5E5E5 lines, 14px cards, tiny uppercase eyebrows.

const BASE_CONTROL =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";

export const buttonStyles = {
  primary: `${BASE_CONTROL} border-[#e5e5e5] bg-black text-[#fdfcfc] hover:bg-[#171717]`,
  secondary: `${BASE_CONTROL} border-[#e5e5e5] bg-white text-black hover:bg-[#f5f3f1]`,
  accent: `${BASE_CONTROL} border-transparent bg-[#ff4704] text-white hover:bg-[#e63e03]`,
  ghost: `${BASE_CONTROL} border-transparent bg-transparent text-[#777169] hover:text-black`,
} as const;

export type ButtonVariant = keyof typeof buttonStyles;

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant }) {
  return <button className={`${buttonStyles[variant]} ${className}`} {...props} />;
}

export function ButtonLink({
  variant = "primary",
  className = "",
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonVariant }) {
  return <Link className={`${buttonStyles[variant]} ${className}`} {...props} />;
}

/** Small bordered pill used for badges and metadata. */
export function Pill({
  children,
  tone = "default",
  className = "",
}: {
  children: ReactNode;
  tone?: "default" | "accent" | "muted" | "solid";
  className?: string;
}) {
  const tones = {
    default: "border-[#e5e5e5] bg-white text-black",
    accent: "border-[#ff4704]/30 bg-[#ff4704]/8 text-[#ff4704]",
    muted: "border-[#e5e5e5] bg-[#f5f3f1] text-[#777169]",
    solid: "border-transparent bg-black text-[#fdfcfc]",
  } as const;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] leading-none ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function Card({
  children,
  className = "",
  dark = false,
}: {
  children: ReactNode;
  className?: string;
  dark?: boolean;
}) {
  return (
    <div
      className={`rounded-[14px] border ${
        dark ? "border-black bg-black text-[#fdfcfc]" : "border-[#e5e5e5] bg-white text-black"
      } ${className}`}
    >
      {children}
    </div>
  );
}

/** The recessed grey panel that sits inside reference cards. */
export function Inset({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-lg bg-[#f5f3f1] p-4 ${className}`}>{children}</div>;
}

export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`eyebrow ${className}`}>{children}</p>;
}

export function SectionHeading({
  eyebrow,
  title,
  body,
  className = "",
}: {
  eyebrow?: string;
  title: string;
  body?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      {eyebrow && <Eyebrow className="mb-3">{eyebrow}</Eyebrow>}
      <h2 className="display-sm max-w-2xl text-balance">{title}</h2>
      {body && <p className="mt-4 max-w-xl text-base leading-6 text-[#777169]">{body}</p>}
    </div>
  );
}

/** Circular match-score ring, as used on the reference's job-match cards. */
export function ScoreRing({ value, size = 44 }: { value: number; size?: number }) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  const stroke = 3;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const dash = (clamped / 100) * circumference;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0" role="img" aria-label={`${clamped}% match`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e5e5e5" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="#15362b"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${dash} ${circumference - dash}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={size * 0.28}
        fontWeight="500"
        fill="#000"
      >
        {clamped}
      </text>
    </svg>
  );
}

/** Numbered progress rail: active step solid, completed rules in accent. */
export function StepRail({ steps, current }: { steps: string[]; current: number }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pb-1">
      {steps.map((label, i) => (
        <div key={label} className="flex shrink-0 items-center gap-3">
          <span
            className={`inline-flex h-9 items-center gap-2 rounded-full border px-4 text-sm ${
              i === current
                ? "border-transparent bg-black text-[#fdfcfc]"
                : i < current
                  ? "border-[#ff4704] bg-white text-black"
                  : "border-[#e5e5e5] bg-white text-[#777169]"
            }`}
          >
            <span className="font-mono text-[11px] opacity-70">{String(i + 1).padStart(2, "0")}</span>
            {label}
          </span>
          {i < steps.length - 1 && (
            <span className={`h-px w-4 sm:w-8 ${i < current ? "bg-[#ff4704]" : "bg-[#e5e5e5]"}`} />
          )}
        </div>
      ))}
    </div>
  );
}
