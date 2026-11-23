/**
 * Reverse Geocoding Service for Zuna HRMS
 * 
 * Converts GPS latitude & longitude coordinates into human-readable place names
 * using OpenStreetMap Nominatim with strict caching, rate limiting, and timeout safety.
 */

// In-memory cache for resolved addresses: key is rounded lat,lon (4 decimal places ~11m)
const addressCache = new Map();
const MAX_CACHE_ENTRIES = 5000;

// Rate limiting queue for upstream Nominatim requests (1 req per sec per policy)
const requestQueue = [];
let isQueueProcessing = false;
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL_MS = 1000; // 1 second interval per OSM Nominatim usage policy

/**
 * Normalizes coordinates to a cache key rounded to 4 decimal places (~11 meters).
 */
export function getCoordCacheKey(lat, lon) {
  const numLat = parseFloat(lat);
  const numLon = parseFloat(lon);
  if (isNaN(numLat) || isNaN(numLon)) return null;
  return `${numLat.toFixed(4)},${numLon.toFixed(4)}`;
}

/**
 * Constructs a clean, human-readable address from Nominatim JSON payload.
 * Expected example: "Gandhipuram, Coimbatore, Tamil Nadu, India"
 */
export function formatNominatimAddress(data) {
  if (!data || typeof data !== "object") return null;

  const addr = data.address || {};

  // 1. Street / Road / Landmark
  const street = addr.road || addr.street || addr.pedestrian || addr.footway || addr.amenity || "";

  // 2. Neighbourhood / Suburb / Area
  const area = addr.suburb || addr.neighbourhood || addr.residential || addr.subdivision || addr.city_district || "";

  // 3. City / Town / Village / Municipality
  const city = addr.city || addr.town || addr.village || addr.municipality || addr.county || "";

  // 4. District
  const district = addr.state_district || addr.district || "";

  // 5. State / Region
  const state = addr.state || addr.province || addr.region || "";

  // 6. Country
  const country = addr.country || "";

  // Build ordered segments, deduplicating case-insensitively
  const rawSegments = [street, area, city, district, state, country];
  const seen = new Set();
  const segments = [];

  for (const seg of rawSegments) {
    if (!seg || typeof seg !== "string") continue;
    const clean = seg.trim();
    const lower = clean.toLowerCase();
    if (!seen.has(lower) && clean.length > 0) {
      seen.add(lower);
      segments.push(clean);
    }
  }

  if (segments.length >= 2) {
    return segments.join(", ");
  }

  // Fallback to display_name truncated to meaningful primary components
  if (data.display_name && typeof data.display_name === "string") {
    const parts = data.display_name.split(",").map(p => p.trim()).filter(Boolean);
    if (parts.length > 4) {
      return [parts[0], parts[1], parts[parts.length - 2], parts[parts.length - 1]].join(", ");
    }
    return parts.join(", ");
  }

  return null;
}

/**
 * Process queued geocoding requests with rate limiting and timeout.
 */
async function processQueue() {
  if (isQueueProcessing || requestQueue.length === 0) return;
  isQueueProcessing = true;

  while (requestQueue.length > 0) {
    const item = requestQueue.shift();
    const now = Date.now();
    const elapsed = now - lastRequestTime;

    if (elapsed < MIN_REQUEST_INTERVAL_MS) {
      await new Promise(r => setTimeout(r, MIN_REQUEST_INTERVAL_MS - elapsed));
    }

    lastRequestTime = Date.now();

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);

      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${item.lat}&lon=${item.lon}&addressdetails=1`;
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Zuna-HRMS/1.0 (contact: admin@zuna-hrms.local; context: attendance-monitoring)",
          "Accept": "application/json"
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        const formatted = formatNominatimAddress(data);
        if (formatted) {
          setInCache(item.cacheKey, formatted);
          item.resolve(formatted);
          continue;
        }
      }
      item.resolve(null);
    } catch (err) {
      // Network failure, timeout, or abort
      item.resolve(null);
    }
  }

  isQueueProcessing = false;
}

function setInCache(key, val) {
  if (!key || !val) return;
  if (addressCache.size >= MAX_CACHE_ENTRIES) {
    const firstKey = addressCache.keys().next().value;
    addressCache.delete(firstKey);
  }
  addressCache.set(key, val);
}

/**
 * Reverse geocodes coordinates (lat, lon) into a formatted place name.
 * 
 * @param {number|string} lat Latitude
 * @param {number|string} lon Longitude
 * @param {Object} [options]
 * @param {boolean} [options.immediateOnly=false] If true, only returns cached result or null without blocking network
 * @returns {Promise<string|null>} Formatted place string or null
 */
export async function reverseGeocode(lat, lon, options = {}) {
  const numLat = parseFloat(lat);
  const numLon = parseFloat(lon);

  if (isNaN(numLat) || isNaN(numLon)) return null;
  if (numLat === 0 && numLon === 0) return null;
  if (numLat < -90 || numLat > 90 || numLon < -180 || numLon > 180) return null;

  const cacheKey = getCoordCacheKey(numLat, numLon);
  if (addressCache.has(cacheKey)) {
    return addressCache.get(cacheKey);
  }

  if (options.immediateOnly) {
    // Queue in background for subsequent requests without blocking
    enqueueRequest(numLat, numLon, cacheKey).catch(() => {});
    return null;
  }

  return enqueueRequest(numLat, numLon, cacheKey);
}

function enqueueRequest(lat, lon, cacheKey) {
  return new Promise((resolve) => {
    // If queue is excessively long (> 50), fail fast to avoid backlog
    if (requestQueue.length > 50) {
      return resolve(null);
    }

    requestQueue.push({
      lat,
      lon,
      cacheKey,
      resolve
    });

    processQueue();
  });
}

/**
 * Direct setter for pre-seeded or test addresses into cache
 */
export function setCachedAddress(lat, lon, address) {
  const key = getCoordCacheKey(lat, lon);
  if (key && address) {
    setInCache(key, address);
  }
}

/**
 * Clear cache (used in tests)
 */
export function clearAddressCache() {
  addressCache.clear();
}
