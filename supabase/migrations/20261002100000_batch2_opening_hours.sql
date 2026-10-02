-- Already applied to project jkehxprjvrivlzkgkvgw.
-- Opening hours from Google: weekly periods, display text, and (when fetched within a week of a date) date-specific hours.
alter table public.places
  add column hours jsonb,
  add column hours_text jsonb,
  add column hours_current jsonb,
  add column hours_checked_at timestamptz;

grant insert (hours, hours_text, hours_current, hours_checked_at) on public.places to anon, authenticated;
