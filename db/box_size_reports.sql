-- one row per finished contract whose box sizes were hand-corrected; source data for contract-overrides.json
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
  status text not null,
  max_box_size int not null,
  report jsonb not null
);

alter table public.box_size_reports enable row level security;

-- role-agnostic: the sb_publishable key does not authenticate as anon, a TO clause never matches
create policy "clients can insert box size reports"
  on public.box_size_reports for insert
  with check (true);

-- which contracts get corrected, and how often
-- security_invoker so the view can't bypass RLS: publishable key inserts but never reads back
create view public.box_report_overview with (security_invoker = on) as
select
  coalesce(nullif(contract_name, ''), title) as contract,
  generator,
  status,
  max_box_size,
  count(*) as reports,
  count(distinct client_id) as users,
  max(created_at) as last_seen
from public.box_size_reports
group by 1, 2, 3, 4
order by reports desc;

-- per-commodity corrections, ready to turn into override entries
create view public.box_report_corrections with (security_invoker = on) as
select
  coalesce(nullif(r.contract_name, ''), r.title) as contract,
  r.generator,
  obj->>'commodity' as commodity,
  (obj->>'scuAmount')::int as scu,
  obj->'originalBoxes' as before,
  obj->'boxes' as after,
  r.status,
  count(*) over (partition by r.contract_name, obj->>'commodity', obj->'boxes') as agreement,
  r.client_id,
  r.created_at
from public.box_size_reports r
cross join lateral jsonb_array_elements(r.report->'objectives') obj
where obj ? 'originalBoxes';
