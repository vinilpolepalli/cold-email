# LabReach (cold-email)

Next.js App Router + TypeScript + Tailwind 4. Cold-email site: scraped researcher directory → resume onboarding → AI draft → send.

## Commands

- `npm run dev` / `npm run build` / `npm start` / `npm run lint`
- `npm run mock:university` — fictional Averton Tech site on :4001 (scraper test fixture)
- `npm run scrape -- <url> [school]` — CLI for the in-app scraping agent (app must be running)

## Key paths

- `src/lib/` — all domain logic: `scraper.ts` (agentic directory scraper), `send.ts` (Gmail-via-Clerk → SMTP → Resend → demo-outbox chain), `template.ts` + `nim.ts` (NIM LLM with deterministic fallback), `resume.ts` (PDF/text parsing), `profiles.ts` + `store.ts` (JSON storage)
- `data/profiles.json` — checked-in researcher directory (scraped real faculty)
- `.data/` — runtime user data, gitignored
- `src/app/api/*` — thin route handlers over `src/lib`

## Conventions

- Every external service (Clerk, NIM, SMTP, Resend) is optional; code must degrade gracefully when its env vars are unset. Demo mode = no env at all.
- Researcher emails: only ever store emails published on official university pages; never construct/guess them.
- `pdf-parse` must stay in `serverExternalPackages` (next.config.ts) or its pdfjs worker path breaks.
