-- Already applied to project jkehxprjvrivlzkgkvgw.
alter table public.places drop constraint places_category_check;
alter table public.places add constraint places_category_check
  check (category in ('attraction','restaurant','location','shopping','other'));
alter table public.schedule_items drop constraint schedule_items_category_check;
alter table public.schedule_items add constraint schedule_items_category_check
  check (category in ('attraction','restaurant','location','shopping','other'));

create or replace function public.cat_label(c text) returns text language sql immutable set search_path = '' as $$
  select case c when 'attraction' then 'Attractions' when 'restaurant' then 'Restaurants'
                when 'location' then 'Locations' when 'shopping' then 'Shopping' else 'Other' end
$$;

-- Zabar's (grocery store) was filed under Other.
update public.places set category = 'shopping', updated_by = 'Claude'
where deleted_at is null and category = 'other' and type ilike '%store%';
update public.schedule_items s set category = 'shopping'
from public.places p where s.place_id = p.id and p.category = 'shopping' and s.category <> 'shopping';
