-- Already applied to project jkehxprjvrivlzkgkvgw.
-- New "location" section for streets, neighborhoods, and other areas.
alter table public.places drop constraint places_category_check;
alter table public.places add constraint places_category_check
  check (category in ('attraction','restaurant','location','other'));

alter table public.schedule_items drop constraint schedule_items_category_check;
alter table public.schedule_items add constraint schedule_items_category_check
  check (category in ('attraction','restaurant','location','other'));

-- Existing "Other" places became Locations (custom schedule items like flights stay "other").
update public.places set category = 'location' where category = 'other';
update public.schedule_items set category = 'location' where category = 'other' and place_id is not null;
