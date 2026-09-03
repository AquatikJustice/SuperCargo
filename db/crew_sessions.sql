-- Crew Mode. One row per live crew: the leader owns it and rewrites `payload` on every
-- change, members read it and subscribe for updates. The code IS the secret, so anyone
-- holding it can read, write or end that crew; nothing here identifies a person, and a
-- row only lives as long as the run.

create table if not exists public.crew_sessions (
  code text primary key,
  rev integer not null default 0,     -- bumped per publish; members drop anything not newer
  payload jsonb,                      -- CrewSnapshot: manifest + placed boxes + ship
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists crew_sessions_updated_idx on public.crew_sessions (updated_at);

alter table public.crew_sessions enable row level security;

-- Guessing a live 8-character code is the only way in, so the policies are open by design.
drop policy if exists crew_sessions_rw on public.crew_sessions;
create policy crew_sessions_rw on public.crew_sessions
  for all to anon, authenticated
  using (true) with check (true);

grant select, insert, update, delete on public.crew_sessions to anon, authenticated;

-- Members are pushed UPDATEs on their row; without this they'd have to poll.
alter publication supabase_realtime add table public.crew_sessions;

-- Ending a crew drops its row, but a crash or a force-quit leaves one behind. Run this
-- occasionally, or put it on a schedule, so dead codes stop resolving and can be reissued.
delete from public.crew_sessions where updated_at < now() - interval '24 hours';
