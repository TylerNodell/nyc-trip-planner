-- Already applied to project jkehxprjvrivlzkgkvgw. Kept here for reference / re-creating elsewhere.
create table public.places (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  category text not null check (category in ('attraction','restaurant','other')),
  type text not null default '' check (char_length(type) <= 100),
  neighborhood text not null default '' check (char_length(neighborhood) <= 100),
  address text not null default '' check (char_length(address) <= 300),
  google_place_id text check (char_length(google_place_id) <= 300),
  maps_url text check (maps_url is null or (maps_url like 'https://%' and char_length(maps_url) <= 500)),
  rating numeric(2,1) check (rating is null or rating between 0 and 5),
  rating_count integer check (rating_count is null or rating_count >= 0),
  reaction text not null default '' check (reaction in ('','up','down')),
  created_at timestamptz not null default now()
);

create unique index places_google_place_id_key on public.places (google_place_id) where google_place_id is not null;

alter table public.places enable row level security;

create policy "public read"   on public.places for select to anon, authenticated using (true);
create policy "public insert" on public.places for insert to anon, authenticated with check (true);
create policy "public update" on public.places for update to anon, authenticated using (true) with check (true);
create policy "public delete" on public.places for delete to anon, authenticated using (true);

revoke all on public.places from anon, authenticated;
grant select, delete on public.places to anon, authenticated;
grant insert (name, category, type, neighborhood, address, google_place_id, maps_url, rating, rating_count) on public.places to anon, authenticated;
grant update (reaction) on public.places to anon, authenticated;

create function public.places_row_cap() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.places) >= 500 then
    raise exception 'Trip list is full (500 places max)';
  end if;
  return new;
end $$;
revoke execute on function public.places_row_cap() from public, anon, authenticated;

create trigger places_row_cap before insert on public.places
  for each row execute function public.places_row_cap();

alter publication supabase_realtime add table public.places;
