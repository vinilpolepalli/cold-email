# LabReach — cold email real researchers

A cold-emailing site for students reaching out to professors. AI scraping agents build a directory of **real AI/CS faculty** (Stanford, Harvard, MIT, Penn/Wharton — including interdisciplinary CS+bio, CS+health, and AI+business labs). You onboard with your resume, review an AI-personalized draft, and send it with one click.

## Features

- **Researcher directory** (`/researchers`) — real faculty profiles scraped from public university pages by AI agents, stored in `data/profiles.json`. Filter by school, research area, or published-email availability. Emails are included **only when a university page publishes them**.
- **Resume onboarding** (`/onboarding`) — upload a PDF (or paste text). The resume is parsed into education/experience/projects/skills/publications, an AI summary is generated, and every field is editable.
- **Compose** (`/compose`) — a personalized draft is generated from your profile + the researcher's actual research areas and bio. Edit the subject/body/recipient freely, then hit **Send**.
- **Outbox** (`/outbox`) — every send attempt with method and status.
- **Built-in AI scraper** (`/scrape`) — point it at any faculty-directory URL; it crawls profile links and extracts structured profiles, then adds them to the directory. Also available as a CLI: `npm run scrape -- <url> [school]`.

## Architecture

| Concern | How |
| --- | --- |
| Framework | Next.js (App Router, TypeScript, Tailwind) |
| Auth | [Clerk](https://clerk.com) with Google sign-in — **optional**; without keys the app runs in single-user demo mode |
| Email sending | Tried in order: **Gmail API with the signed-in user's Google OAuth token (via Clerk)** → SMTP (`nodemailer`) → Resend → local demo outbox |
| AI generation | **NVIDIA NIM** (OpenAI-compatible, `NVIDIA_API_KEY`) for resume summaries, email drafts, and scraper extraction; deterministic template/heuristic fallbacks when unset |
| Storage | `data/profiles.json` (checked-in directory) + `.data/` JSON files (users, outbox, runtime-scraped profiles; gitignored) |

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in what you have — everything is optional
npm run dev                  # http://localhost:3000
```

### Enabling real email sending (Clerk + Gmail)

1. Create a Clerk app, set `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` + `CLERK_SECRET_KEY`.
2. In Clerk → SSO connections → Google: use **custom credentials** (your own Google Cloud OAuth client) and add the scope `https://www.googleapis.com/auth/gmail.send`.
3. Sign in with Google in the app. Sends now go out from the signed-in user's own Gmail via the Gmail API.

No Clerk? Set `SMTP_*` (e.g. a Gmail app password) or `RESEND_API_KEY` instead. With nothing configured, sends land in the demo outbox.

**Safety valve:** set `EMAIL_TEST_REDIRECT=you@example.com` to redirect *every* outgoing email to yourself while testing.

### Testing the scraper against the bundled mock university

The repo ships a fictional university site (Averton Institute of Technology) as a scraper test fixture:

```bash
npm run mock:university      # serves http://localhost:4001
npm run dev                  # in another terminal
npm run scrape -- http://localhost:4001/ "Averton Tech"
```

The agent crawls the directory, extracts all three fictional professors (names, titles, research interests, emails), and adds them to `/researchers`.

## Deploying to Vercel

The app is Vercel-ready out of the box:

1. Push this repo to GitHub (already done if you're reading this on GitHub).
2. Go to [vercel.com/new](https://vercel.com/new), import the repo, keep the detected Next.js defaults, and deploy.
3. Optionally add env vars from `.env.example` (Clerk keys, `NVIDIA_API_KEY`, SMTP/Resend) in Project Settings → Environment Variables. The app runs fully in demo mode with none set.

Notes for serverless: runtime user data (profiles, outbox) falls back to the instance tmp dir on Vercel, so it's ephemeral per instance; the researcher directory itself is baked into the deployment from `data/profiles.json`. For persistent user accounts in production, set `DATA_DIR` to a mounted volume or replace `src/lib/store.ts` with a database.

## How the real directory was built

A multi-agent scraping workflow fanned out over public faculty directories — Stanford CS/HAI/Biomedical Data Science, MIT EECS/CSAIL/Jameel Clinic, Harvard SEAS/Kempner/DBMI, Penn CIS and Wharton (OID/Statistics/AI at Wharton) — extracting name, title, department, research areas, a short bio, source URL, and the email **only if published** on an official page. A per-school verification pass re-fetched sampled source pages to confirm the data. Results live in `data/profiles.json`.

Please use this respectfully: send a small number of genuinely personalized emails, not bulk spam.
