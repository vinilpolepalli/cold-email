# Sloan (cold-email)

Next.js App Router + TypeScript + Tailwind 4. Cold-email site: scraped researcher directory → resume onboarding → AI draft → send.

## Commands

- `npm run dev` / `npm run build` / `npm start` / `npm run lint`
- `npm run mock:university` — fictional Averton Tech site on :4001 (scraper test fixture)
- `npm run scrape -- <url> [school]` — CLI for the in-app scraping agent (app must be running)

## Key paths

- `src/lib/` — all domain logic: `scraper.ts` (agentic directory scraper), `send.ts` (Gmail-via-Clerk → SMTP → Resend → demo-outbox chain), `template.ts` + `nim.ts` (NIM LLM with deterministic fallback), `revise.ts` (prompt-driven edits to a draft), `preferences.ts` (standing instructions replayed into every draft), `resume.ts` (PDF/text parsing), `profiles.ts` + `store.ts` (JSON storage)
- `data/profiles.json` — checked-in researcher directory (scraped real faculty)
- `.data/` — runtime user data, gitignored
- `src/app/api/*` — thin route handlers over `src/lib`

## Conventions

- Every external service (Clerk, NIM, SMTP, Resend) is optional; code must degrade gracefully when its env vars are unset. Demo mode = no env at all.
- Researcher emails: only ever store emails published on official university pages; never construct/guess them.
- Drafting an email means putting it in Gmail. A row in `campaign-state/` is queue bookkeeping, not a draft the sender can read — finish the job with the `draft-to-mailbox` action so it lands in the school mailbox with the resume attached. Storing a draft never sends.
- `pdf-parse` must stay in `serverExternalPackages` (next.config.ts) or its pdfjs worker path breaks.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
