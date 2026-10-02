-- Already applied to project jkehxprjvrivlzkgkvgw. Kept here for reference / re-creating elsewhere.
create table public.schedule_items (
  id uuid primary key default gen_random_uuid(),
  place_id uuid references public.places(id) on delete set null,
  -- Snapshot of the place so the schedule survives if it's removed from the list
  name text not null check (char_length(name) between 1 and 200),
  category text not null check (category in ('attraction','restaurant','other')),
  neighborhood text not null default '' check (char_length(neighborhood) <= 100),
  address text not null default '' check (char_length(address) <= 300),
  maps_url text check (maps_url is null or (maps_url like 'https://%' and char_length(maps_url) <= 500)),
  day date not null,
  start_time time,
  end_time time,
  note text not null default '' check (char_length(note) <= 300),
  created_at timestamptz not null default now(),
  check (end_time is null or start_time is null or end_time > start_time)
);

create index schedule_items_day_idx on public.schedule_items (day, start_time);
create index schedule_items_place_id_idx on public.schedule_items (place_id);

alter table public.schedule_items enable row level security;

create policy "public read"   on public.schedule_items for select to anon, authenticated using (true);
create policy "public insert" on public.schedule_items for insert to anon, authenticated with check (true);
create policy "public update" on public.schedule_items for update to anon, authenticated using (true) with check (true);
create policy "public delete" on public.schedule_items for delete to anon, authenticated using (true);

revoke all on public.schedule_items from anon, authenticated;
grant select, delete on public.schedule_items to anon, authenticated;
grant insert (place_id, name, category, neighborhood, address, maps_url, day, start_time, end_time, note) on public.schedule_items to anon, authenticated;
grant update (day, start_time, end_time, note) on public.schedule_items to anon, authenticated;

create function public.schedule_items_row_cap() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.schedule_items) >= 1000 then
    raise exception 'Schedule is full (1000 items max)';
  end if;
  return new;
end $$;
revoke execute on function public.schedule_items_row_cap() from public, anon, authenticated;

create trigger schedule_items_row_cap before insert on public.schedule_items
  for each row execute function public.schedule_items_row_cap();

alter publication supabase_realtime add table public.schedule_items;
