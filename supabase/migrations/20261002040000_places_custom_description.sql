-- Already applied to project jkehxprjvrivlzkgkvgw.
-- Custom description written by the group; shown instead of Google's summary when set.
alter table public.places
  add column description text not null default '' check (char_length(description) <= 500);

-- Visitors can now move a place between sections and edit its description (plus reactions, as before).
grant update (category, description) on public.places to anon, authenticated;
