-- Anonymous usage snapshots (Settings > Usage Stats).
-- The app inserts one row per launch with the publishable key; RLS lets anon INSERT
-- but nobody read back through the API. One row per launch, so "latest row per client"
-- is that user's current state and distinct client_id is the unique-user count.

create table if not exists public.usage_pings (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  sent_at timestamptz not null default now(),
  app_version text,
  platform text,
  arch text,
  ocr_engine text,
  ships text[],                 -- every ship they've finished a contract with
  ocr_fields_total integer,     -- fields OCR attempted, lifetime
  ocr_fields_edited integer,    -- of those, how many the user had to correct
  ocr_edits jsonb,              -- corrections by kind: {commodity, scu, destination, pickup, reward, boxSize}
  space_delivery_piles boolean,
  contribute_training boolean,
  auto_capture boolean
);

create index if not exists usage_pings_client_idx on public.usage_pings (client_id);
create index if not exists usage_pings_sent_idx on public.usage_pings (sent_at);

alter table public.usage_pings enable row level security;

drop policy if exists usage_pings_insert on public.usage_pings;
create policy usage_pings_insert on public.usage_pings
  for insert to anon, authenticated
  with check (true);

grant insert on public.usage_pings to anon, authenticated;

-- Each client's most recent snapshot. Owner-only (no anon grant).
create or replace view public.usage_latest as
  select distinct on (client_id) *
  from public.usage_pings
  order by client_id, sent_at desc;

-- Headline numbers. OCR accuracy = 1 - corrected/attempted across every user's latest row.
create or replace view public.usage_overview as
select
  count(*)                                                        as unique_users,
  count(*) filter (where sent_at > now() - interval '7 days')     as active_7d,
  count(*) filter (where sent_at > now() - interval '30 days')    as active_30d,
  sum(ocr_fields_total)                                           as ocr_fields_read,
  sum(ocr_fields_edited)                                          as ocr_fields_corrected,
  round(100.0 * (1 - nullif(sum(ocr_fields_edited), 0)::numeric
                     / nullif(sum(ocr_fields_total), 0)), 1)      as ocr_accuracy_pct
from public.usage_latest;

-- Ship popularity: how many users have hauled with each ship.
create or replace view public.usage_ships as
  select ship, count(*) as users
  from public.usage_latest, unnest(ships) as ship
  group by ship
  order by users desc;

-- Preferred OCR engine.
create or replace view public.usage_engines as
  select ocr_engine, count(*) as users
  from public.usage_latest
  group by ocr_engine
  order by users desc;
