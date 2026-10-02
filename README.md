# NYC trip list

Live at **https://tylernodell.github.io/nyc-trip-planner/**

A shared trip planner: look up places on Google Maps, sort them into attractions and restaurants, and react with 👍 / 👎. Anyone with the link can add, react, and remove; changes sync live.

The **Itinerary** page (`itinerary.html`) turns the list into a shared schedule: anyone can give a place a day and an optional start/end time and note, move it, or add custom items like flights. Overlapping times are flagged.

- **Front end:** `index.html` and `itinerary.html`, static pages served by GitHub Pages from `main` / root
- **Backend:** Supabase project `nyc-trip-planner` (`jkehxprjvrivlzkgkvgw`):
  - `places` table with row-level security (visitors can add, react, and remove; place details can't be edited after adding; capped at 500 rows)
  - `schedule_items` table (visitors can add, reschedule, and remove; capped at 1000 rows). Each item keeps a copy of the place's name, so it stays on the schedule even if the place is removed from the list.
  - Realtime enabled on both tables
  - Edge Function `place-search`, which calls the Google Places API (New)

## Google Places API key

1. In Google Cloud Console, enable **Places API (New)** on a project with billing.
2. Create an API key restricted to **Places API (New)** only. It's used server-side, so no website restriction is needed.
3. Cap the daily quota for Places API (New) → **Text Search** requests.
4. In Supabase, go to Edge Functions → Secrets and add `GOOGLE_PLACES_API_KEY` with your key.
   CLI alternative: `supabase secrets set GOOGLE_PLACES_API_KEY=... --project-ref jkehxprjvrivlzkgkvgw`

## Notes

- The Supabase anon key in `index.html` is meant to be public. Access is controlled by the row-level security rules in `supabase/migrations/`.
- Since anyone with the link can remove places, share it only with people you trust.
- Lookups pull the place name, type, neighborhood, address, rating, and closed status from Google. Use the Google Maps link on each place to check hours.
