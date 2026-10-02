-- Already applied to project jkehxprjvrivlzkgkvgw.
-- Upserts (insert … on conflict do update) need update rights on every column sent.
grant update (device_id) on public.people to anon, authenticated;
