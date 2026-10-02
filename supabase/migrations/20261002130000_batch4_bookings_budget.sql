-- Already applied to project jkehxprjvrivlzkgkvgw.
-- ===== Bookings + costs on scheduled items =====
alter table public.schedule_items
  add column booking_status text not null default '' check (booking_status in ('','needed','booked')),
  add column confirmation text not null default '' check (char_length(confirmation) <= 120),
  add column booking_url text check (booking_url is null or (booking_url ~* '^https?://' and char_length(booking_url) <= 500)),
  add column cost numeric(10,2) check (cost is null or (cost >= 0 and cost <= 100000)),
  add column cost_per text not null default 'person' check (cost_per in ('person','group'));
grant insert (booking_status, confirmation, booking_url, cost, cost_per) on public.schedule_items to anon, authenticated;
grant update (booking_status, confirmation, booking_url, cost, cost_per) on public.schedule_items to anon, authenticated;

-- Places that need a reservation (carried onto schedule items when scheduled)
alter table public.places add column needs_booking boolean not null default false;
grant insert (needs_booking) on public.places to anon, authenticated;
grant update (needs_booking) on public.places to anon, authenticated;

-- ===== Group size for splitting costs (the only setting visitors can change) =====
insert into public.trip_settings (key, value) values ('party', '{"size": null}'::jsonb) on conflict (key) do nothing;
create policy "party size editable" on public.trip_settings for update to anon, authenticated
  using (key = 'party')
  with check (key = 'party' and (value->'size' = 'null'::jsonb or
    (jsonb_typeof(value->'size') = 'number' and (value->>'size')::numeric between 1 and 50 and (value->>'size')::numeric = floor((value->>'size')::numeric))));
grant update (value, updated_at) on public.trip_settings to anon, authenticated;
alter publication supabase_realtime add table public.trip_settings;

-- ===== Activity feed: bookings, costs, reservation flags =====
create function public.money_label(c numeric, per text) returns text language sql immutable set search_path = '' as $$
  select case when c is null then 'no cost'
              else '$' || trim(to_char(c, 'FM999,999,990.00')) || case when per = 'group' then ' total' else ' per person' end end
$$;

create or replace function public.schedule_activity() returns trigger
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
    if new.booking_status is distinct from old.booking_status then
      if new.booking_status = 'booked' then
        perform public.log_activity(new.updated_by, 'booked', new.name, case when new.confirmation <> '' then '(confirmation ' || new.confirmation || ')' else '' end);
      elsif new.booking_status = 'needed' then
        perform public.log_activity(new.updated_by, 'flagged', new.name, 'as needing a booking');
      else
        perform public.log_activity(new.updated_by, 'cleared the booking for', new.name, '');
      end if;
    elsif new.confirmation is distinct from old.confirmation and new.confirmation <> '' then
      perform public.log_activity(new.updated_by, 'added a confirmation number to', new.name, '');
    end if;
    if new.cost is distinct from old.cost or (new.cost is not null and new.cost_per is distinct from old.cost_per) then
      perform public.log_activity(new.updated_by, 'set the cost of', new.name, 'to ' || public.money_label(new.cost, new.cost_per));
    end if;
  end if;
  return null;
end $$;

create or replace function public.places_activity() returns trigger
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
    if new.needs_booking is distinct from old.needs_booking then
      perform public.log_activity(new.updated_by, case when new.needs_booking then 'flagged' else 'unflagged' end, new.name,
        case when new.needs_booking then 'as needing a reservation' else '(no reservation needed)' end);
    end if;
  end if;
  return null;
end $$;
