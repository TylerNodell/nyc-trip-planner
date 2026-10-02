-- Already applied to project jkehxprjvrivlzkgkvgw.
-- Which name each device (browser/phone) goes by, so a repeated name can offer to merge.
create table public.people (
  device_id text primary key check (char_length(device_id) between 6 and 64),
  name text not null check (char_length(name) between 1 and 40),
  first_seen timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index people_name_idx on public.people (lower(name));
alter table public.people enable row level security;
create policy "public read" on public.people for select to anon, authenticated using (true);
create policy "public insert" on public.people for insert to anon, authenticated with check (true);
create policy "public update" on public.people for update to anon, authenticated using (true) with check (true);
revoke all on public.people from anon, authenticated;
grant select on public.people to anon, authenticated;
grant insert (device_id, name, updated_at) on public.people to anon, authenticated;
grant update (name, updated_at) on public.people to anon, authenticated;

-- Fold one device into another: its votes and comments become the other device's.
-- If both voted on the same place, the earlier vote (the target's) is kept.
create function public.merge_device(p_from text, p_to text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_from is null or p_to is null or p_from = p_to
     or char_length(p_from) not between 6 and 64 or char_length(p_to) not between 6 and 64 then
    raise exception 'bad device ids';
  end if;
  if not exists (select 1 from public.people where device_id = p_to) then
    raise exception 'unknown device';
  end if;
  update public.votes v set voter_id = p_to
   where v.voter_id = p_from
     and not exists (select 1 from public.votes x where x.place_id = v.place_id and x.voter_id = p_to);
  delete from public.votes where voter_id = p_from;
  update public.comments set author_id = p_to where author_id = p_from;
  delete from public.people where device_id = p_from;
  update public.people set updated_at = now() where device_id = p_to;
end $$;
revoke execute on function public.merge_device(text, text) from public;
grant execute on function public.merge_device(text, text) to anon, authenticated;

-- (Batch 6) a place already on the list can be linked to a seasonal event.
grant update (event_id) on public.places to anon, authenticated;

-- Register names people already use (from votes and comments).
insert into public.people (device_id, name, updated_at)
select distinct on (did) did, nm, at from (
  select voter_id as did, voter_name as nm, updated_at as at from public.votes where voter_id <> 'legacy' and voter_name <> ''
  union all
  select author_id, author_name, created_at from public.comments where author_name <> ''
) s order by did, at desc
on conflict (device_id) do nothing;
select * from public.people;
