-- fired when a user corrects a contract's box sizes; source data for contract-overrides.json
create table if not exists public.box_size_reports (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  client_id uuid not null,
  app_version text not null,
  mission_id text not null,
  title text not null,
  generator text,
  contract_name text,
  data_source text not null,
  kind text not null,
  max_box_size int not null,
  report jsonb not null
);

alter table public.box_size_reports enable row level security;

-- anon inserts only, no read-back with the publishable key
create policy "anon can insert box size reports"
  on public.box_size_reports for insert
  to anon
  with check (true);

-- which contracts get corrected, and to what
create view public.box_report_overview as
select
  coalesce(nullif(contract_name, ''), title) as contract,
  generator,
  kind,
  max_box_size,
  count(*) as reports,
  count(distinct client_id) as users,
  max(created_at) as last_seen
from public.box_size_reports
group by 1, 2, 3, 4
order by reports desc;
