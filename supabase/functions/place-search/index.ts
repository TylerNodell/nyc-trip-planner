import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Deployed to project jkehxprjvrivlzkgkvgw as "place-search".
// POST { query }    -> place name search (Google Places API (New) Text Search, biased to NYC),
//                      or a pasted Google Maps link (resolved server-side, then matched)
// POST { place_id } -> one place by Google place ID
// POST { refresh: [uuid,...] } -> re-fetch opening hours for places on the list (max 25, skips ones checked in the last 12h)
// POST { routes: { day, sig, by, legs:[{from:[lat,lng], to:[lat,lng], mode:'walk'|'transit'}] } } -> exact travel times via Google Routes, saved per day
// Requires the secret GOOGLE_PLACES_API_KEY.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const FIELDS = [
  "id", "displayName", "formattedAddress", "shortFormattedAddress", "primaryType",
  "primaryTypeDisplayName", "types", "googleMapsUri", "addressComponents", "businessStatus",
  "rating", "userRatingCount", "editorialSummary", "generativeSummary", "location",
  "regularOpeningHours", "currentOpeningHours",
];
const HOURS_MASK = "id,regularOpeningHours,currentOpeningHours";
const SEARCH_MASK = FIELDS.map((f) => "places." + f).join(",");
const DETAILS_MASK = FIELDS.join(",");

const NYC = { latitude: 40.7359, longitude: -73.9911 };

const FOOD = new Set([
  "restaurant", "cafe", "coffee_shop", "bakery", "bar", "pub", "wine_bar", "cocktail_bar",
  "meal_takeaway", "meal_delivery", "food_court", "ice_cream_shop", "dessert_shop", "deli",
  "bagel_shop", "donut_shop", "sandwich_shop", "juice_shop", "tea_house", "confectionery",
  "steak_house", "bar_and_grill", "brewery", "brewpub", "diner", "bistro", "food", "cafeteria",
  "chocolate_shop", "candy_store", "dessert_restaurant", "night_club", "lounge_bar", "sports_bar",
  "cake_shop", "pastry_shop",
]);

const ATTRACTION = new Set([
  "tourist_attraction", "museum", "art_gallery", "park", "national_park", "state_park",
  "amusement_park", "aquarium", "zoo", "historical_landmark", "historical_place", "monument",
  "cultural_landmark", "performing_arts_theater", "concert_hall", "opera_house", "philharmonic_hall",
  "auditorium", "observation_deck", "botanical_garden", "garden", "stadium", "arena", "plaza",
  "event_venue", "movie_theater", "comedy_club", "bowling_alley", "sculpture", "beach", "marina",
  "visitor_center", "cultural_center", "church", "place_of_worship", "synagogue", "mosque",
  "hindu_temple", "buddhist_temple", "landmark", "amphitheatre", "dog_park", "hiking_area",
  "skateboard_park", "water_park", "wildlife_park", "ferris_wheel", "roller_coaster",
  "tour_agency", "planetarium", "library", "market",
]);

// Streets, neighborhoods, and other areas rather than businesses or sights.
const LOCATION = new Set([
  "route", "street_address", "intersection", "neighborhood", "sublocality", "sublocality_level_1",
  "sublocality_level_2", "locality", "colloquial_area", "premise", "subpremise", "postal_code",
  "administrative_area_level_3", "island", "natural_feature",
]);

type Category = "restaurant" | "attraction" | "location";
function classify(t: string | undefined): Category | null {
  if (!t) return null;
  if (FOOD.has(t) || t.endsWith("_restaurant")) return "restaurant";
  if (ATTRACTION.has(t)) return "attraction";
  if (LOCATION.has(t)) return "location";
  return null;
}

function categoryFor(primary: string | undefined, types: string[] = []) {
  return classify(primary) ?? types.map(classify).find(Boolean) ?? "other";
}

type AddrComp = { longText?: string; shortText?: string; types?: string[] };
function neighborhoodFor(comps: AddrComp[] = []) {
  const pick = (type: string) => comps.find((c) => c.types?.includes(type))?.longText;
  return pick("neighborhood") ?? pick("sublocality_level_1") ?? pick("locality") ?? "";
}

// deno-lint-ignore no-explicit-any
function toMatch(p: any) {
  const editorial = p.editorialSummary?.text?.trim();
  const generative = p.generativeSummary?.overview?.text?.trim();
  return {
    google_place_id: p.id,
    name: p.displayName?.text ?? "",
    category: categoryFor(p.primaryType, p.types),
    type: p.primaryTypeDisplayName?.text ?? "",
    neighborhood: neighborhoodFor(p.addressComponents),
    address: p.shortFormattedAddress ?? p.formattedAddress ?? "",
    maps_url: p.googleMapsUri ?? null,
    rating: typeof p.rating === "number" ? p.rating : null,
    rating_count: typeof p.userRatingCount === "number" ? p.userRatingCount : null,
    summary: (editorial || generative || "").slice(0, 1000),
    summary_ai: !editorial && !!generative,
    lat: typeof p.location?.latitude === "number" ? p.location.latitude : null,
    ...hoursOf(p),
    lng: typeof p.location?.longitude === "number" ? p.location.longitude : null,
    closed: p.businessStatus === "CLOSED_PERMANENTLY",
    temporarily_closed: p.businessStatus === "CLOSED_TEMPORARILY",
  };
}

// deno-lint-ignore no-explicit-any
function hoursOf(p: any) {
  const reg = p.regularOpeningHours;
  const cur = p.currentOpeningHours;
  return {
    hours: Array.isArray(reg?.periods) ? reg.periods : null,
    hours_text: Array.isArray(reg?.weekdayDescriptions) ? reg.weekdayDescriptions : null,
    hours_current: Array.isArray(cur?.periods) ? cur.periods : null,
    hours_checked_at: new Date().toISOString(),
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

class GoogleError extends Error {}

type Leg = { from: [number, number]; to: [number, number]; mode: "walk" | "transit" };
// deno-lint-ignore no-explicit-any
async function computeLeg(key: string, l: Leg, triedWalk = false): Promise<any> {
  const res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline",
    },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: l.from[0], longitude: l.from[1] } } },
      destination: { location: { latLng: { latitude: l.to[0], longitude: l.to[1] } } },
      travelMode: l.mode === "walk" ? "WALK" : "TRANSIT",
    }),
  });
  if (!res.ok) {
    console.error("routes error", res.status, await res.text());
    return { ok: false, status: res.status };
  }
  const data = await res.json();
  const r = data.routes?.[0];
  if (!r) {
    if (l.mode !== "walk" && !triedWalk) return computeLeg(key, { ...l, mode: "walk" }, true);
    return { ok: false, status: 0 };
  }
  return {
    ok: true,
    mode: l.mode === "walk" ? "walk" : "transit",
    min: Math.max(1, Math.round(parseInt(String(r.duration), 10) / 60)),
    meters: r.distanceMeters ?? null,
    poly: r.polyline?.encodedPolyline ?? null,
  };
}

async function textSearch(key: string, textQuery: string, center = NYC, radius = 40000) {
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": SEARCH_MASK },
    body: JSON.stringify({
      textQuery,
      pageSize: 3,
      regionCode: "US",
      locationBias: { circle: { center, radius } },
    }),
  });
  if (!res.ok) {
    console.error("Places searchText error", res.status, await res.text());
    throw new GoogleError();
  }
  const data = await res.json();
  return (data.places ?? []).map(toMatch).filter((m: { name: string }) => m.name);
}

async function details(key: string, placeId: string) {
  const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": DETAILS_MASK },
  });
  if (res.status === 404 || res.status === 400) return [];
  if (!res.ok) {
    console.error("Places details error", res.status, await res.text());
    throw new GoogleError();
  }
  const m = toMatch(await res.json());
  return m.name ? [m] : [];
}

// ---------- Google Maps links ----------
const GOOGLE_HOST = /^((www|maps)\.)?google\.[a-z]{2,3}(\.[a-z]{2})?$/;
const SHORT_HOST = /^(maps\.app\.goo\.gl|goo\.gl)$/;
const isGoogle = (u: URL) => GOOGLE_HOST.test(u.hostname) || SHORT_HOST.test(u.hostname);

function looksLikeLink(q: string) {
  return /^https?:\/\//i.test(q) || /^(maps\.app\.goo\.gl|goo\.gl|(www\.|maps\.)?google\.)/i.test(q);
}

function decodePart(s: string) {
  try { return decodeURIComponent(s.replace(/\+/g, " ")); } catch { return s.replace(/\+/g, " "); }
}

type LinkInfo = { placeId?: string; name?: string; lat?: number; lng?: number };

function parseMapsUrl(u: URL): LinkInfo {
  const info: LinkInfo = {};
  const full = decodePart(u.href);
  const pid = u.searchParams.get("query_place_id") || u.searchParams.get("place_id");
  if (pid) info.placeId = pid;
  const place = u.pathname.match(/\/maps\/place\/([^/]+)/);
  if (place) info.name = decodePart(place[1]);
  const pin = full.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) ?? full.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (pin) { info.lat = Number(pin[1]); info.lng = Number(pin[2]); }
  const q = u.searchParams.get("q") || u.searchParams.get("query");
  if (q && !info.name) {
    const ll = q.match(/^\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*$/);
    if (ll) { info.lat ??= Number(ll[1]); info.lng ??= Number(ll[2]); }
    else info.name = q;
  }
  return info;
}

async function resolveLink(raw: string): Promise<LinkInfo | null> {
  let url: URL;
  try { url = new URL(/^https?:\/\//i.test(raw) ? raw : "https://" + raw); } catch { return null; }
  const headers = { "User-Agent": "Mozilla/5.0 (compatible; trip-planner)", "Accept-Language": "en-US,en" };
  for (let hop = 0; hop < 6; hop++) {
    if (!isGoogle(url)) return null;
    const info = parseMapsUrl(url);
    if (info.placeId || info.name) return info;
    // Short links and cid links redirect; follow them by hand so we never leave Google.
    const res = await fetch(url, { redirect: "manual", headers });
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      await res.body?.cancel();
      url = new URL(loc, url);
      continue;
    }
    // Final page with no name in the URL: read the page title.
    if (res.ok) {
      const html = (await res.text()).slice(0, 200_000);
      const t = html.match(/<meta[^>]+(?:property="og:title"|itemprop="name")[^>]+content="([^"]+)"/i)
        ?? html.match(/<meta[^>]+content="([^"]+)"[^>]+(?:property="og:title"|itemprop="name")/i);
      const title = t?.[1]?.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
      if (title && !/^google maps$/i.test(title)) return { ...info, name: title.replace(/\s*[·-]\s*Google Maps$/i, "") };
    } else {
      await res.body?.cancel();
    }
    return Object.keys(info).length ? info : null;
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const key = Deno.env.get("GOOGLE_PLACES_API_KEY");
  if (!key) return json({ error: "missing_key", message: "GOOGLE_PLACES_API_KEY is not set." }, 500);

  // deno-lint-ignore no-explicit-any
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }

  try {
    if (body?.routes && typeof body.routes === "object") {
      const { day, sig, legs, by } = body.routes;
      const okLatLng = (a: unknown) => Array.isArray(a) && a.length === 2 && a.every((n) => typeof n === "number" && isFinite(n));
      if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day) || typeof sig !== "string" || sig.length > 4000 ||
          !Array.isArray(legs) || !legs.length || legs.length > 14 ||
          !legs.every((l: Leg) => okLatLng(l?.from) && okLatLng(l?.to) && (l.mode === "walk" || l.mode === "transit"))) {
        return json({ error: "bad_request" }, 400);
      }
      const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const { data: existing } = await admin.from("day_routes").select("*").eq("day", day).maybeSingle();
      if (existing && existing.sig === sig && Date.now() - new Date(existing.computed_at).getTime() < 10 * 60 * 1000) {
        return json({ legs: existing.legs, cached: true });
      }
      const out = await Promise.all(legs.map((l: Leg) => computeLeg(key, l)));
      if (out.every((o) => !o.ok)) {
        const denied = out.some((o) => o.status === 403);
        return json({ error: denied ? "routes_disabled" : "no_routes" }, 502);
      }
      await admin.from("day_routes").upsert({
        day, sig, legs: out, computed_at: new Date().toISOString(), computed_by: String(by ?? "").slice(0, 40),
      });
      return json({ legs: out });
    }

    if (Array.isArray(body?.refresh)) {
      const ids = body.refresh.filter((x: unknown) => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x as string)).slice(0, 25);
      if (!ids.length) return json({ updated: 0 });
      const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const cutoff = new Date(Date.now() - 12 * 3600 * 1000).toISOString();
      const { data: rows, error } = await admin.from("places")
        .select("id, google_place_id, hours_checked_at")
        .in("id", ids).not("google_place_id", "is", null)
        .or(`hours_checked_at.is.null,hours_checked_at.lt.${cutoff}`);
      if (error) { console.error(error); return json({ error: "server_error" }, 500); }
      let updated = 0;
      await Promise.all((rows ?? []).map(async (r) => {
        const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(r.google_place_id)}`, {
          headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": HOURS_MASK },
        });
        if (!res.ok) { console.error("hours refresh", res.status, await res.text()); return; }
        const h = hoursOf(await res.json());
        const { error: ue } = await admin.from("places").update(h).eq("id", r.id);
        if (!ue) updated++;
      }));
      return json({ updated });
    }

    const placeId = typeof body?.place_id === "string" ? body.place_id.trim() : "";
    if (placeId) {
      if (!/^[A-Za-z0-9_-]{10,300}$/.test(placeId)) return json({ error: "bad_request" }, 400);
      return json({ matches: await details(key, placeId) });
    }

    const query = String(body?.query ?? "").trim();
    if (!query) return json({ error: "bad_request", message: "Empty query." }, 400);

    if (looksLikeLink(query)) {
      if (query.length > 2000) return json({ error: "bad_request", message: "Link is too long." }, 400);
      const info = await resolveLink(query);
      if (!info) return json({ matches: [], link: { ok: false } });
      let matches: ReturnType<typeof toMatch>[] = [];
      if (info.placeId) matches = await details(key, info.placeId);
      if (!matches.length && info.name) {
        const center = info.lat != null && info.lng != null ? { latitude: info.lat, longitude: info.lng } : NYC;
        matches = await textSearch(key, info.name, center, info.lat != null ? 500 : 40000);
      }
      return json({ matches, link: { ok: true, name: info.name ?? "" } });
    }

    if (query.length > 200) return json({ error: "bad_request", message: "Query must be 1-200 characters." }, 400);
    return json({ matches: await textSearch(key, query) });
  } catch (e) {
    if (e instanceof GoogleError) return json({ error: "google_error" }, 502);
    console.error(e);
    return json({ error: "server_error" }, 500);
  }
});
