-- Already applied to project jkehxprjvrivlzkgkvgw.
-- NYC Neighborhood Tabulation Areas (2020) from NYC Open Data, used to tag places with a real
-- neighborhood from their coordinates (Google usually only returns the borough).
create extension if not exists postgis with schema extensions;

create table public.nyc_neighborhoods (
  code text primary key,
  name text not null,
  borough text not null,
  geom extensions.geometry(MultiPolygon, 4326) not null
);
create index nyc_neighborhoods_geom_idx on public.nyc_neighborhoods using gist (geom);
alter table public.nyc_neighborhoods enable row level security;
revoke all on public.nyc_neighborhoods from anon, authenticated;

alter table public.places
  add column lat double precision check (lat is null or lat between -90 and 90),
  add column lng double precision check (lng is null or lng between -180 and 180);
grant insert (lat, lng) on public.places to anon, authenticated;

create function public.nyc_neighborhood_at(p_lat double precision, p_lng double precision)
returns text language sql stable security definer set search_path = '' as $$
  select n.name from public.nyc_neighborhoods n
  where extensions.st_contains(n.geom, extensions.st_setsrid(extensions.st_point(p_lng, p_lat), 4326))
  limit 1
$$;
revoke execute on function public.nyc_neighborhood_at(double precision, double precision) from public, anon, authenticated;

create function public.places_set_neighborhood() returns trigger
language plpgsql security definer set search_path = '' as $$
declare hood text;
begin
  if new.lat is not null and new.lng is not null then
    hood := public.nyc_neighborhood_at(new.lat, new.lng);
    if hood is not null then new.neighborhood := hood; end if;
  end if;
  return new;
end $$;
revoke execute on function public.places_set_neighborhood() from public, anon, authenticated;

create trigger places_set_neighborhood before insert on public.places
  for each row execute function public.places_set_neighborhood();

-- Seed (run once): pulls the boundaries straight from NYC Open Data.
create extension if not exists http with schema extensions;
select extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '60000');
insert into public.nyc_neighborhoods (code, name, borough, geom)
select f->'properties'->>'nta2020', f->'properties'->>'ntaname', f->'properties'->>'boroname',
       extensions.st_multi(extensions.st_setsrid(extensions.st_geomfromgeojson(f->>'geometry'), 4326))
from jsonb_array_elements(
  (select content::jsonb from extensions.http_get('https://data.cityofnewyork.us/resource/9nt8-h7nd.geojson?$limit=1000'))->'features'
) f
on conflict (code) do nothing;
drop extension http;
