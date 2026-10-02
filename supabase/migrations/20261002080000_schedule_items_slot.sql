-- Already applied to project jkehxprjvrivlzkgkvgw.
-- Optional part of day / meal instead of an exact time.
alter table public.schedule_items
  add column slot text not null default ''
    check (slot in ('','morning','afternoon','evening','night','breakfast','brunch','lunch','dinner','dessert','snack')),
  add constraint schedule_items_slot_or_time check (slot = '' or start_time is null);

grant insert (slot) on public.schedule_items to anon, authenticated;
grant update (slot) on public.schedule_items to anon, authenticated;
