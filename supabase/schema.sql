-- Sloan storage schema. Run once in the Supabase SQL editor for the project,
-- then set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the app's environment.
--
-- Records are stored one row per entity ("user:<id>", "outbox:<id>",
-- "waitlist:<id>"), never one row per collection: a collection row has to be
-- rewritten wholesale, so two concurrent writers each save a copy missing the
-- other's entry.
--
-- The table name is historical and predates the rename to Sloan. Keeping it
-- avoids a migration on existing deployments. To rename it, run
--   alter table public.labreach_kv rename to sloan_kv;
-- and set SUPABASE_TABLE=sloan_kv in the environment.
--
-- RLS is enabled with no policies: only the service role key (server-side)
-- can touch this table.

create table if not exists public.labreach_kv (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.labreach_kv enable row level security;
