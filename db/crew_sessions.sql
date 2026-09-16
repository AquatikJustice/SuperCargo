-- crew mode, one row per live crew

create table if not exists public.crew_sessions (
  code text primary key,
  rev integer not null default 0,
  payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists crew_sessions_updated_idx on public.crew_sessions (updated_at);

alter table public.crew_sessions enable row level security;

-- the code is the only key
drop policy if exists crew_sessions_rw on public.crew_sessions;
create policy crew_sessions_rw on public.crew_sessions
  for all to anon, authenticated
  using (true) with check (true);

grant select, insert, update, delete on public.crew_sessions to anon, authenticated;

alter publication supabase_realtime add table public.crew_sessions;

-- force-quit leaders leave rows behind
delete from public.crew_sessions where updated_at < now() - interval '24 hours';
