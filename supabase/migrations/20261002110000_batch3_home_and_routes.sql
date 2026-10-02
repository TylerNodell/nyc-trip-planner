-- Already applied to project jkehxprjvrivlzkgkvgw.
-- Trip-wide settings (home base). Read-only to visitors; kept out of the public repo.
create table public.trip_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.trip_settings enable row level security;
create policy "public read" on public.trip_settings for select to anon, authenticated using (true);
revoke all on public.trip_settings from anon, authenticated;
grant select on public.trip_settings to anon, authenticated;

-- The home row is inserted separately so the address stays out of this public repo:
-- insert into public.trip_settings (key, value) values ('home', jsonb_build_object('name','Home','address','…','lat',…,'lng',…));

-- Exact travel times from Google Routes, computed on request per day.
-- sig = the day's stop order + coordinates when computed; if the day changes, the stored legs are stale.
create table public.day_routes (
  day date primary key,
  sig text not null,
  legs jsonb not null,
  computed_at timestamptz not null default now(),
  computed_by text not null default ''
);
alter table public.day_routes enable row level security;
create policy "public read" on public.day_routes for select to anon, authenticated using (true);
revoke all on public.day_routes from anon, authenticated;
grant select on public.day_routes to anon, authenticated;

alter publication supabase_realtime add table public.day_routes;

select value from public.trip_settings where key='home';
