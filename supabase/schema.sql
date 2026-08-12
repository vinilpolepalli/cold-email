-- LabReach storage schema. Run once in the Supabase SQL editor (or via the
-- Supabase MCP) for the project, then set SUPABASE_URL and
-- SUPABASE_SERVICE_ROLE_KEY in the app's environment.
--
-- The app uses a single key-value table through PostgREST. RLS is enabled
-- with no policies: only the service role key (server-side) can touch it.

create table if not exists public.labreach_kv (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.labreach_kv enable row level security;
