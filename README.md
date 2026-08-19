# Sloan — cold email real researchers

A cold-emailing site for students reaching out to professors. AI scraping agents build a directory of **real AI/CS faculty** (Stanford, Harvard, MIT, Penn/Wharton — including interdisciplinary CS+bio, CS+health, and AI+business labs). You onboard with your resume, review an AI-personalized draft, and send it with one click.

## Access model

**Sign-up is open** — anyone can make an account and use the app.

Signed-out visitors get the landing page at `/` and the researcher directory at `/researchers`, with published email addresses withheld and labelled as such. Everything that writes or sends needs an account: those pages redirect to sign-in and the data APIs answer 401.

Each account brings its own credentials. Emails send from the user's own Gmail via Clerk's Google OAuth token, and AI drafting uses an NVIDIA NIM key the user pastes into Settings — the server holds no shared key for either. With no NIM key the drafts still write, from the deterministic template in `src/lib/template.ts`.

To close sign-up again: Clerk dashboard → Configure → Restrictions → set access mode to Restricted, then allowlist individual addresses.

## Features

- **Researcher directory** (`/researchers`) — real faculty profiles scraped from public university pages by AI agents, stored in `data/profiles.json`. Filter by school, research area, or published-email availability. Emails are included **only when a university page publishes them**.
- **Resume onboarding** (`/onboarding`) — upload a PDF (or paste text). The resume is parsed into education/experience/projects/skills/publications, an AI summary is generated, and every field is editable.
- **Compose** (`/compose`) — a personalized draft is generated from your profile + the researcher's actual research areas and bio. Edit the subject/body/recipient freely, then hit **Send**.
- **Outbox** (`/outbox`) — every send attempt with method and status.
- **Built-in AI scraper** (`/scrape`) — point it at any faculty-directory URL; it crawls profile links and extracts structured profiles, then adds them to the directory. Also available as a CLI: `npm run scrape -- <url> [school]`.
- **Campaign** (`/campaign`) — the autonomous half: a ranked queue aimed at Stanford, then MIT, then Harvard; drafts written overnight and held for review; per-track approval gates; follow-ups that check for a reply first. See [Running a campaign](#running-a-campaign).

## Running a campaign

The campaign turns the directory into a queue that works while you are not looking. It is built around one idea: **autonomy is earned per research area, not granted globally.**

### Research tracks

Every professor is filed under a track from their research areas, title and department:

| Track | What it covers | Reachable in campaign schools |
| --- | --- | --- |
| `cs-core` | Theory, algorithms, systems, ML and NLP foundations | ~156 |
| `cs-bio` | Computational biology, genomics, neuro, health AI | ~165 |
| `cs-robotics` | Robotics, computer vision, control, autonomy | ~57 |
| `cs-other` | Statistics, HCI, social, everything else | ~30 |

A track starts **locked**. You approve two emails in it by hand — from `/campaign` or the ordinary compose screen — and it becomes **ready**. You then *explicitly* arm it, and it becomes **armed**: drafts on that track are sent without waiting for you. Reaching the threshold never arms a track by itself, because "it has sent two emails" is not consent to send two hundred.

### Sending identity

Emails go out from **your university account**, connected once on `/campaign` or `/settings` — deliberately separate from whatever Google account you sign in with. Once a school account is connected it is the *only* mailbox allowed to send: if its grant expires, the send fails loudly rather than falling back to a personal Gmail, because the address a cold email arrives from is part of the email.

Set up requires a Google Cloud OAuth client:

1. Create an OAuth 2.0 Client ID (type: Web application) in Google Cloud Console.
2. Add `https://your-app/api/auth/google/callback` as an authorized redirect URI (`http://localhost:3000/api/auth/google/callback` for local).
3. Enable the Gmail API for the project.
4. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Set `GOOGLE_REDIRECT_URI` too if it must differ from the derived one.
5. Open `/campaign` → **Connect school account**, and pick your `.edu` address.

Step 5 needs the app running somewhere your browser can reach. When it is not — a cloud session, a container with no inbound network, a phone — `scripts/oauth-consent.mjs` does the same round trip without a callback server: it prints a consent URL, you approve on any device and land on an error page, and you paste that URL back for a refresh token. Put the token in `GOOGLE_REFRESH_TOKEN` and `SCHOOL_EMAIL`, which `identityFromEnv()` prefers over anything stored. `scripts/connect-school-account.mjs` does the same thing with a real callback when you do have a browser on the machine.

The requested scopes are `gmail.send` and `gmail.readonly`. Read access exists for one reason: a follow-up checks the thread for a reply before nudging. Decline it and follow-ups are skipped rather than sent blind, unless you turn that off in the send policy.

### Your own template

Paste an email you have actually sent into `/settings` → **Your cold email template**. Every draft is shaped like it. There is one default plus an override per track, since the email that works on a robotics lab is not the one that works on a genomics lab.

Two modes: **skeleton** follows your structure closely; **reference** matches voice and length but writes fresh. Names, papers and numbers inside your template stay behind — they belong to whoever it was originally written to, and are replaced with each professor's real details or dropped.

### The routines

| Routine | Sends? | What it does |
| --- | --- | --- |
| `find-emails` | no | Hunts published addresses for the ~150 directory entries that have none |
| `find-opportunities` | no | Reads lab pages for whether they are recruiting, **or have said not to ask** |
| `build-queue` | no | Ranks the directory and queues the best unqueued professors |
| `write-drafts` | no | Drafts queued professors and schedules them for the next morning |
| `send-due` | **yes** | Sends approved drafts whose time has come |
| `follow-up` | **yes** | Nudges quiet threads, after checking they are actually quiet |
| `daily` | **yes** | The whole chain in order — this is what you schedule |

Rank is `topic match × school weight × recruiting stance`, multiplied rather than added so a lab that has said it is not taking anyone cannot be dragged to the top by a strong topic match alone. School weights are Stanford 1.0, MIT 0.78, Harvard 0.6.

Run any of them from `/campaign`, or headlessly:

```bash
npm run routine -- daily
npm run routine -- send-due --dry-run     # everything except the sending
npm run routine -- write-drafts --limit 3
```

Set `ROUTINE_SECRET` (and `ROUTINE_USER_ID`, so a headless run knows whose queue it is) to allow unattended runs.

### Scheduling it

**Vercel Cron** — `vercel.json` already schedules `daily` at 04:00 UTC on weekdays. Set `CRON_SECRET` in the project and it works; the route accepts GET for exactly this reason.

**Claude Code Routine, or any crontab — no database needed.** `npm run campaign` runs a whole cycle against nothing but the repository:

```bash
npm run campaign                 # the daily chain, then commit the state
npm run campaign -- --dry-run    # everything except sending
npm run campaign -- write-drafts --limit 3
```

It boots the app against `campaign-state/`, runs the routine, shuts the app down, and commits what changed. The container a Routine runs in is thrown away afterwards, so the repository is the memory: the next run clones it and picks up where the last one stopped. That is what `campaign-state/` is for, and why it is committed rather than ignored.

Secrets are the exception. `campaign-state/.gitignore` drops the mailbox token and the API key, and a commit is refused outright if one ever reaches the index. They come from the environment instead:

```bash
SCHOOL_EMAIL=you@school.edu GOOGLE_REFRESH_TOKEN=... npm run campaign
```

Mint that token once with `npm run connect-school` — it opens Google's consent screen, then prints the refresh token and the address it belongs to.

Supabase still works if you want it (`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`), and is the better answer for more than one user. For one person it is a service to run for no benefit.

### Send policy

Defaults, all clamped server-side and editable per user: at most **8 emails a day** and **4 per run**, spaced **25 minutes**, only between **09:00 and 17:00 on weekdays** in your timezone, with follow-ups at **day 5 and day 12** and a hard ceiling of two nudges per thread.

Drafts are always written a night ahead of when they send. That gap is the review window, and it is why an armed track still is not the same as sending the instant a draft exists.

## Architecture

| Concern | How |
| --- | --- |
| Framework | Next.js (App Router, TypeScript, Tailwind) |
| Auth | [Clerk](https://clerk.com) with Google sign-in — **optional**; without keys the app runs in single-user demo mode |
| Email sending | **Your connected school Gmail** when one is attached (terminal — never falls back), otherwise: Gmail API via Clerk's Google token → SMTP (`nodemailer`) → Resend → local demo outbox |
| Automation | Routines in `src/lib/routines/`, each runnable from `/campaign`, `POST/GET /api/routines/<name>`, or `npm run routine -- <name>` |
| AI generation | **NVIDIA NIM, BYOK-first**: each user stores their own key on `/settings` (get one free at build.nvidia.com); `NVIDIA_API_KEY` is an optional server-wide fallback; deterministic template/heuristic engines run with no key at all |
| Storage | `data/profiles.json` (checked-in directory) + a swappable KV layer for user data: **Supabase Postgres** when `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are set (run `supabase/schema.sql` once), JSON files otherwise |

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
3. Optionally add env vars (Clerk keys, `NVIDIA_API_KEY`, SMTP/Resend) in Project Settings → Environment Variables. The app runs fully in demo mode with none set.

Notes for serverless: runtime user data (profiles, outbox) falls back to the instance tmp dir on Vercel, so it's ephemeral per instance; the researcher directory itself is baked into the deployment from `data/profiles.json`. For persistent user accounts in production, set `DATA_DIR` to a mounted volume or configure Supabase.

**A scheduled campaign needs somewhere durable to remember what it has done**, or it re-queues professors it already emailed. Either commit the state (`npm run campaign`, see above) or configure Supabase. Vercel's own tmp dir is not enough.

### Environment variables

| Variable | For |
| --- | --- |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Connecting your school mailbox. Without these, campaign sending is unavailable |
| `GOOGLE_REDIRECT_URI` | Only when the callback URL cannot be derived from the request |
| `ROUTINE_SECRET` | Lets a scheduler run routines without a browser session |
| `ROUTINE_USER_ID` | Whose queue a headless run acts on |
| `CRON_SECRET` | Vercel Cron sends this automatically; accepted in place of `ROUTINE_SECRET` |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Durable storage. Required for scheduled campaigns |
| `EMAIL_TEST_REDIRECT` | Redirects every outgoing email to you. Worth setting on the first live run |

## How the real directory was built

A multi-agent scraping workflow fanned out over public faculty directories — Stanford CS/HAI/Biomedical Data Science, MIT EECS/CSAIL/Jameel Clinic, Harvard SEAS/Kempner/DBMI, Penn CIS and Wharton (OID/Statistics/AI at Wharton) — extracting name, title, department, research areas, a short bio, source URL, and the email **only if published** on an official page. A per-school verification pass re-fetched sampled source pages to confirm the data. Results live in `data/profiles.json`.

Please use this respectfully: send a small number of genuinely personalized emails, not bulk spam.
