import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Deployed to project jkehxprjvrivlzkgkvgw as "place-search".
// POST { query }    -> place name search (Google Places API (New) Text Search, biased to NYC),
//                      or a pasted Google Maps link (resolved server-side, then matched)
// POST { place_id } -> one place by Google place ID
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
];
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

function classify(t: string | undefined): "restaurant" | "attraction" | null {
  if (!t) return null;
  if (FOOD.has(t) || t.endsWith("_restaurant")) return "restaurant";
  if (ATTRACTION.has(t)) return "attraction";
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
    lng: typeof p.location?.longitude === "number" ? p.location.longitude : null,
    closed: p.businessStatus === "CLOSED_PERMANENTLY",
    temporarily_closed: p.businessStatus === "CLOSED_TEMPORARILY",
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

class GoogleError extends Error {}

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
