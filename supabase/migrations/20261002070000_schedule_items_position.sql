-- Already applied to project jkehxprjvrivlzkgkvgw.
-- Manual order within a day for drag and drop.
alter table public.schedule_items add column position double precision not null default 0;
create index schedule_items_day_position_idx on public.schedule_items (day, position);

grant insert (position) on public.schedule_items to anon, authenticated;
grant update (position) on public.schedule_items to anon, authenticated;
