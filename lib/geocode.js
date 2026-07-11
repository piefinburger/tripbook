// Reverse geocode via OSM Nominatim. Fine at family scale (max 1 req/sec).
const cache = new Map();
export async function reverseGeocode(lat, lng) {
  if (lat == null || lng == null) return null;
  const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  if (cache.has(key)) return cache.get(key);
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=14`,
      { headers: { "User-Agent": "tripbook-family-app/1.0" } });
    if (!r.ok) return null;
    const j = await r.json();
    const a = j.address || {};
    const place = [a.attraction || a.tourism || a.suburb || a.village || a.town || a.city,
      a.state || a.country].filter(Boolean).join(", ") || j.display_name?.split(",").slice(0, 2).join(",");
    cache.set(key, place || null);
    return place || null;
  } catch { return null; }
}

// Forward geocode a typed place name (Nominatim search, best effort).
export async function searchPlace(text) {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(text)}`,
      { headers: { "User-Agent": "tripbook/1.0" }, signal: AbortSignal.timeout(4000) });
    const [hit] = await r.json();
    if (!hit) return null;
    return { lat: Number(hit.lat), lng: Number(hit.lon),
      name: hit.display_name.split(",").slice(0, 2).join(",").trim() };
  } catch { return null; }
}
