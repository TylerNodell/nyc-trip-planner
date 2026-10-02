import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Already deployed to project jkehxprjvrivlzkgkvgw as "place-search".
// Looks up places in Google Places API (New) Text Search, biased to New York City,
// and classifies each as attraction / restaurant / other.
// Requires the secret GOOGLE_PLACES_API_KEY.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.shortFormattedAddress",
  "places.primaryType",
  "places.primaryTypeDisplayName",
  "places.types",
  "places.googleMapsUri",
  "places.addressComponents",
  "places.businessStatus",
  "places.rating",
  "places.userRatingCount",
].join(",");

const FOOD = new Set([
  "restaurant", "cafe", "coffee_shop", "bakery", "bar", "pub", "wine_bar", "cocktail_bar",
  "meal_takeaway", "meal_delivery", "food_court", "ice_cream_shop", "dessert_shop", "deli",
  "bagel_shop", "donut_shop", "sandwich_shop", "juice_shop", "tea_house", "confectionery",
  "steak_house", "bar_and_grill", "brewery", "brewpub", "diner", "bistro", "food", "cafeteria",
  "chocolate_shop", "candy_store", "dessert_restaurant", "night_club", "lounge_bar", "sports_bar",
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

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const key = Deno.env.get("GOOGLE_PLACES_API_KEY");
  if (!key) return json({ error: "missing_key", message: "GOOGLE_PLACES_API_KEY is not set." }, 500);

  let query = "";
  try {
    const body = await req.json();
    query = String(body?.query ?? "").trim();
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  if (!query || query.length > 200) return json({ error: "bad_request", message: "Query must be 1-200 characters." }, 400);

  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify({
      textQuery: query,
      pageSize: 3,
      regionCode: "US",
      locationBias: {
        circle: { center: { latitude: 40.7359, longitude: -73.9911 }, radius: 40000 },
      },
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    console.error("Places API error", res.status, detail);
    return json({ error: "google_error", status: res.status }, 502);
  }

  const data = await res.json();
  // deno-lint-ignore no-explicit-any
  const matches = (data.places ?? []).map((p: any) => ({
    google_place_id: p.id,
    name: p.displayName?.text ?? "",
    category: categoryFor(p.primaryType, p.types),
    type: p.primaryTypeDisplayName?.text ?? "",
    neighborhood: neighborhoodFor(p.addressComponents),
    address: p.shortFormattedAddress ?? p.formattedAddress ?? "",
    maps_url: p.googleMapsUri ?? null,
    rating: typeof p.rating === "number" ? p.rating : null,
    rating_count: typeof p.userRatingCount === "number" ? p.userRatingCount : null,
    closed: p.businessStatus === "CLOSED_PERMANENTLY",
    temporarily_closed: p.businessStatus === "CLOSED_TEMPORARILY",
  })).filter((m: { name: string }) => m.name);

  return json({ matches });
});
