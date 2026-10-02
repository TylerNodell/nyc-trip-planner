-- Already applied to project jkehxprjvrivlzkgkvgw.
create table public.seasonal_events (
  id serial primary key,
  sort int not null default 0,
  name text not null,
  query text not null,                 -- what to look up on Google when adding it
  category text not null default 'attraction',
  starts date not null,
  ends date not null,
  confirmed boolean not null default false,   -- false = based on the usual yearly dates
  outdoor boolean not null default false,
  needs_booking boolean not null default false,
  blurb text not null default '',
  tip text not null default '',
  url text
);
alter table public.seasonal_events enable row level security;
create policy "public read" on public.seasonal_events for select to anon, authenticated using (true);
revoke all on public.seasonal_events from anon, authenticated;
grant select on public.seasonal_events to anon, authenticated;

insert into public.seasonal_events (sort, name, query, category, starts, ends, confirmed, outdoor, needs_booking, blurb, tip, url) values
(1,'Rockefeller Center Christmas Tree','Rockefeller Center Christmas Tree','attraction','2026-12-02','2027-01-10',false,true,false,
 'The giant Norway spruce above the rink, lit daily from about 5 AM to midnight.',
 'Least crowded early morning or late night. It usually stays lit all day on Christmas and goes dark early on New Year''s Eve.','https://www.rockefellercenter.com/holidays/'),
(2,'Christmas Spectacular (Radio City Rockettes)','Radio City Music Hall','attraction','2026-11-04','2027-01-04',true,false,true,
 'The Rockettes'' 90-minute holiday show, now with ten numbers.',
 'Tickets from about $50 at the Radio City box office (online adds fees). Holiday-week shows go fast.','https://www.rockettes.com/christmas'),
(3,'The Nutcracker (New York City Ballet)','David H. Koch Theater','attraction','2026-11-27','2027-01-03',true,false,true,
 'Balanchine''s famous Nutcracker at Lincoln Center with the full NYCB orchestra.',
 'Book ahead; shows between Christmas and New Year''s sell out.','https://www.nycballet.com'),
(4,'Winter Village at Bryant Park','Bryant Park Winter Village','location','2026-10-24','2027-01-04',false,true,false,
 '170+ holiday shop kiosks and a free-admission ice rink (skate rental extra).',
 'Rink reservations are smart on weekends and holidays. The shops usually wrap up in early January.','https://bryantpark.org/activities/winter-village'),
(5,'Union Square Holiday Market','Union Square Holiday Market','shopping','2026-11-13','2026-12-24',false,true,false,
 'Big open-air artisan market with 150+ booths.',
 'Usually closes on Christmas Eve, so it fits the first week of the trip.','https://urbanspacenyc.com'),
(6,'Grand Central Holiday Fair','Grand Central Terminal','shopping','2026-11-09','2026-12-24',false,false,false,
 'Indoor crafts fair in Vanderbilt Hall, a good pick for a cold or rainy day.',
 'Usually ends on Christmas Eve.','https://www.grandcentralterminal.com/holiday-fair/'),
(7,'Columbus Circle Holiday Market','Columbus Circle Holiday Market','shopping','2026-12-01','2026-12-31',false,true,false,
 'European-style market at Central Park''s southwest corner.',
 'Pairs well with a Central Park walk or Wollman Rink.','https://urbanspacenyc.com'),
(8,'Macy''s holiday windows & Santaland','Macy''s Herald Square','shopping','2026-11-20','2027-01-03',false,false,false,
 'Animated holiday windows on 34th St and Broadway; Santaland inside.',
 'Santaland needs a free reservation and ends on Christmas Eve; the windows stay up into early January.','https://www.macys.com/social/santaland/'),
(9,'Saks Fifth Avenue windows & light show','Saks Fifth Avenue','attraction','2026-11-23','2027-01-03',false,true,false,
 'A light show plays across the Saks facade every few minutes after dark, right across from the tree.',
 'Combine with the Rockefeller tree and Radio City; all within two blocks.',null),
(10,'Dyker Heights Christmas Lights','Dyker Heights Christmas Lights','attraction','2026-12-01','2027-01-01',false,true,false,
 'A Brooklyn neighborhood famous for over-the-top house light displays.',
 'Best around 5 to 9 PM, roughly 83rd to 86th St between 11th and 13th Aves. It''s a trek from Flushing, so give it an evening.',null),
(11,'Times Square New Year''s Eve ball drop','Times Square','attraction','2026-12-31','2026-12-31',true,true,false,
 'The ball drop at midnight.',
 'Viewing pens fill by early afternoon: no bathrooms, no re-entry, no large bags. Many people watch from a nearby bar instead.','https://www.timessquarenyc.org/times-square-new-years-eve'),
(12,'Midnight Run in Central Park (NYRR)','Naumburg Bandshell Central Park','attraction','2026-12-31','2026-12-31',false,true,true,
 'A 4-mile New Year''s run (or just the party) in Central Park, with fireworks at midnight.',
 'Registration is required to run; watching is free.','https://www.nyrr.org'),
(13,'Prospect Park New Year''s Eve fireworks','Grand Army Plaza Brooklyn','attraction','2026-12-31','2026-12-31',false,true,false,
 'Brooklyn''s midnight fireworks, much calmer than Times Square.',
 'Best views from Prospect Park West or Grand Army Plaza; music usually starts around 10:30 PM.',null),
(14,'NYBG Holiday Train Show','New York Botanical Garden','attraction','2026-11-14','2027-01-18',false,false,true,
 'Model trains running past NYC landmarks made from plant parts, inside the conservatory.',
 'Timed tickets sell out on holiday weeks. It''s in the Bronx.','https://www.nybg.org'),
(15,'Wollman Rink (Central Park)','Wollman Rink','attraction','2026-10-24','2027-03-14',false,true,true,
 'Skating with the Midtown skyline over the trees.',
 'Buy timed tickets online for holiday week.','https://www.wollmanskatingrink.com'),
(16,'The Rink at Rockefeller Center','The Rink at Rockefeller Center','attraction','2026-10-10','2027-03-01',false,true,true,
 'Skate right under the tree.',
 'Pricey with short sessions; book well ahead.','https://www.rockefellercenter.com/attractions/the-rink-at-rockefeller-center/');

-- Places can be tied to an event so the itinerary knows its dates.
alter table public.places add column event_id int references public.seasonal_events(id) on delete set null;
grant insert (event_id) on public.places to anon, authenticated;

update public.places set event_id = (select id from public.seasonal_events where sort = 4) where deleted_at is null and name = 'Bryant Park Winter Village';
update public.places set event_id = (select id from public.seasonal_events where sort = 9) where deleted_at is null and name = 'Saks Fifth Avenue Windows';
select name, event_id from public.places where event_id is not null;
