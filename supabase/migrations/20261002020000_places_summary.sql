-- Already applied to project jkehxprjvrivlzkgkvgw.
alter table public.places
  add column summary text not null default '' check (char_length(summary) <= 1000),
  add column summary_ai boolean not null default false;

grant insert (summary, summary_ai) on public.places to anon, authenticated;
