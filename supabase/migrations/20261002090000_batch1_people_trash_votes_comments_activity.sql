-- Already applied to project jkehxprjvrivlzkgkvgw.
-- ===== Who did it + soft delete =====
alter table public.places
  add column created_by text not null default '' check (char_length(created_by) <= 40),
  add column updated_by text not null default '' check (char_length(updated_by) <= 40),
  add column description_by text not null default '' check (char_length(description_by) <= 40),
  add column deleted_at timestamptz;
alter table public.schedule_items
  add column created_by text not null default '' check (char_length(created_by) <= 40),
  add column updated_by text not null default '' check (char_length(updated_by) <= 40),
  add column deleted_at timestamptz;

grant insert (created_by, updated_by) on public.places to anon, authenticated;
grant update (updated_by, description_by, deleted_at) on public.places to anon, authenticated;
grant insert (created_by, updated_by) on public.schedule_items to anon, authenticated;
grant update (updated_by, deleted_at) on public.schedule_items to anon, authenticated;

-- A trashed place shouldn't block adding it again.
drop index public.places_google_place_id_key;
create unique index places_google_place_id_key on public.places (google_place_id)
  where google_place_id is not null and deleted_at is null;

-- Caps count live rows only.
create or replace function public.places_row_cap() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.places where deleted_at is null) >= 500 then
    raise exception 'Trip list is full (500 places max)';
  end if;
  return new;
end $$;
create or replace function public.schedule_items_row_cap() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.schedule_items where deleted_at is null) >= 1000 then
    raise exception 'Schedule is full (1000 items max)';
  end if;
  return new;
end $$;

-- ===== Per-person votes =====
create table public.votes (
  place_id uuid not null references public.places(id) on delete cascade,
  voter_id text not null check (char_length(voter_id) between 6 and 64),
  voter_name text not null default '' check (char_length(voter_name) <= 40),
  value smallint not null check (value in (-1, 1)),
  updated_at timestamptz not null default now(),
  primary key (place_id, voter_id)
);
alter table public.votes enable row level security;
create policy "public read"   on public.votes for select to anon, authenticated using (true);
create policy "public insert" on public.votes for insert to anon, authenticated with check (true);
create policy "public update" on public.votes for update to anon, authenticated using (true) with check (true);
create policy "public delete" on public.votes for delete to anon, authenticated using (true);
revoke all on public.votes from anon, authenticated;
grant select, insert, delete on public.votes to anon, authenticated;
grant update (place_id, voter_id, voter_name, value, updated_at) on public.votes to anon, authenticated;

-- Carry over the old shared reactions as "earlier" votes.
insert into public.votes (place_id, voter_id, voter_name, value)
select id, 'legacy', 'Earlier vote', case reaction when 'up' then 1 else -1 end
from public.places where reaction in ('up','down');

-- ===== Comments =====
create table public.comments (
  id uuid primary key default gen_random_uuid(),
  place_id uuid references public.places(id) on delete cascade,
  schedule_item_id uuid references public.schedule_items(id) on delete cascade,
  author_id text not null check (char_length(author_id) between 6 and 64),
  author_name text not null default '' check (char_length(author_name) <= 40),
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now(),
  check ((place_id is null) <> (schedule_item_id is null))
);
create index comments_place_idx on public.comments (place_id);
create index comments_item_idx on public.comments (schedule_item_id);
alter table public.comments enable row level security;
create policy "public read"   on public.comments for select to anon, authenticated using (true);
create policy "public insert" on public.comments for insert to anon, authenticated with check (true);
create policy "public delete" on public.comments for delete to anon, authenticated using (true);
revoke all on public.comments from anon, authenticated;
grant select, delete on public.comments to anon, authenticated;
grant insert (place_id, schedule_item_id, author_id, author_name, body) on public.comments to anon, authenticated;

create function public.comments_row_cap() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.comments) >= 3000 then raise exception 'Too many comments'; end if;
  return new;
end $$;
revoke execute on function public.comments_row_cap() from public, anon, authenticated;
create trigger comments_row_cap before insert on public.comments for each row execute function public.comments_row_cap();

-- ===== Activity feed (written only by triggers) =====
create table public.activity (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor text not null default '',
  verb text not null,
  subject text not null default '',
  detail text not null default ''
);
alter table public.activity enable row level security;
create policy "public read" on public.activity for select to anon, authenticated using (true);
revoke all on public.activity from anon, authenticated;
grant select on public.activity to anon, authenticated;

create function public.cat_label(c text) returns text language sql immutable set search_path = '' as $$
  select case c when 'attraction' then 'Attractions' when 'restaurant' then 'Restaurants'
                when 'location' then 'Locations' else 'Other' end
$$;
create function public.when_label(st time, sl text) returns text language sql immutable set search_path = '' as $$
  select case when st is not null then trim(to_char(st, 'FMHH12:MI AM'))
              when sl <> '' then initcap(sl) else 'Anytime' end
$$;

create function public.log_activity(p_actor text, p_verb text, p_subject text, p_detail text) returns void
language sql security definer set search_path = '' as $$
  insert into public.activity (actor, verb, subject, detail)
  values (coalesce(nullif(p_actor,''),'Someone'), p_verb, coalesce(p_subject,''), coalesce(p_detail,''));
$$;

create function public.places_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_activity(new.created_by, 'added', new.name, 'to ' || public.cat_label(new.category));
  elsif tg_op = 'UPDATE' then
    if old.deleted_at is null and new.deleted_at is not null then
      perform public.log_activity(new.updated_by, 'removed', new.name, '');
    elsif old.deleted_at is not null and new.deleted_at is null then
      perform public.log_activity(new.updated_by, 'restored', new.name, '');
    end if;
    if new.category is distinct from old.category then
      perform public.log_activity(new.updated_by, 'moved', new.name, 'to ' || public.cat_label(new.category));
    end if;
    if new.description is distinct from old.description then
      if new.description = '' then
        perform public.log_activity(new.updated_by, 'reset the description of', new.name, '');
      else
        perform public.log_activity(new.updated_by, 'described', new.name, '“' || left(new.description, 80) || '”');
      end if;
    end if;
  end if;
  return null;
end $$;
create trigger places_activity after insert or update on public.places
  for each row execute function public.places_activity();

create function public.schedule_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_activity(new.created_by, 'scheduled', new.name,
      'for ' || to_char(new.day, 'Dy Mon FMDD') || ' (' || public.when_label(new.start_time, new.slot) || ')');
  elsif tg_op = 'UPDATE' then
    if old.deleted_at is null and new.deleted_at is not null then
      perform public.log_activity(new.updated_by, 'took off the schedule', new.name, 'from ' || to_char(new.day, 'Dy Mon FMDD'));
      return null;
    elsif old.deleted_at is not null and new.deleted_at is null then
      perform public.log_activity(new.updated_by, 'put back on the schedule', new.name, 'for ' || to_char(new.day, 'Dy Mon FMDD'));
      return null;
    end if;
    if new.day is distinct from old.day then
      perform public.log_activity(new.updated_by, 'moved', new.name, 'to ' || to_char(new.day, 'Dy Mon FMDD'));
    end if;
    if new.start_time is distinct from old.start_time or new.slot is distinct from old.slot then
      perform public.log_activity(new.updated_by, 'changed the time of', new.name, 'to ' || public.when_label(new.start_time, new.slot));
    end if;
    if new.note is distinct from old.note and new.note <> '' then
      perform public.log_activity(new.updated_by, 'added a note to', new.name, '“' || left(new.note, 80) || '”');
    end if;
  end if;
  return null;
end $$;
create trigger schedule_activity after insert or update on public.schedule_items
  for each row execute function public.schedule_activity();

create function public.comments_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare subj text;
begin
  if new.place_id is not null then select name into subj from public.places where id = new.place_id;
  else select name into subj from public.schedule_items where id = new.schedule_item_id; end if;
  perform public.log_activity(new.author_name, 'commented on', subj, '“' || left(new.body, 80) || '”');
  return null;
end $$;
create trigger comments_activity after insert on public.comments
  for each row execute function public.comments_activity();

revoke execute on function public.log_activity(text,text,text,text) from public, anon, authenticated;
revoke execute on function public.places_activity() from public, anon, authenticated;
revoke execute on function public.schedule_activity() from public, anon, authenticated;
revoke execute on function public.comments_activity() from public, anon, authenticated;

alter publication supabase_realtime add table public.votes, public.comments, public.activity;
