-- Already applied to project jkehxprjvrivlzkgkvgw.
-- Broader "area" (NYC community district) above each neighborhood, for grouping nearby places.
alter table public.nyc_neighborhoods add column area text;

create extension if not exists http with schema extensions;
select extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '60000');
update public.nyc_neighborhoods n
set area = trim(regexp_replace(regexp_replace(f->'properties'->>'cdtaname', '^[A-Z]{2}[0-9]+\s+', ''), '\s*\((CD|JIA)[^)]*\)\s*$', ''))
from jsonb_array_elements(
  (select content::jsonb from extensions.http_get('https://data.cityofnewyork.us/resource/9nt8-h7nd.geojson?$limit=1000'))->'features'
) f
where n.code = f->'properties'->>'nta2020';
drop extension http;

update public.nyc_neighborhoods set area = name where area is null or area = '';
alter table public.nyc_neighborhoods alter column area set not null;

alter table public.places
  add column area text not null default '' check (char_length(area) <= 100),
  add column borough text not null default '' check (char_length(borough) <= 50);

create function public.nyc_place_at(p_lat double precision, p_lng double precision)
returns table (neighborhood text, area text, borough text)
language sql stable security definer set search_path = '' as $$
  select n.name, n.area, n.borough from public.nyc_neighborhoods n
  where extensions.st_contains(n.geom, extensions.st_setsrid(extensions.st_point(p_lng, p_lat), 4326))
  limit 1
$$;
revoke execute on function public.nyc_place_at(double precision, double precision) from public, anon, authenticated;

create or replace function public.places_set_neighborhood() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if new.lat is not null and new.lng is not null then
    select * into r from public.nyc_place_at(new.lat, new.lng);
    if found then
      new.neighborhood := r.neighborhood;
      new.area := r.area;
      new.borough := r.borough;
    end if;
  end if;
  return new;
end $$;

update public.places p
set area = r.area, borough = r.borough, neighborhood = r.neighborhood
from public.places p2
cross join lateral public.nyc_place_at(p2.lat, p2.lng) r
where p.id = p2.id and p2.lat is not null;
