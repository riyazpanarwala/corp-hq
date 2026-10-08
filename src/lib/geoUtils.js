// src/lib/geoUtils.js

/**
 * Calculates the great-circle distance between two geographic coordinates
 * in meters using the Haversine formula.
 *
 * @param {number} lat1 Latitude of first point
 * @param {number} lon1 Longitude of first point
 * @param {number} lat2 Latitude of second point
 * @param {number} lon2 Longitude of second point
 * @returns {number} Distance in meters (rounded to nearest integer)
 */
function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) {
    return null;
  }

  const R = 6371e3; // Earth's mean radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

/**
 * Extracts the client IP address from request headers or socket info.
 * Avoids spoofable leftmost entry by selecting from rightmost entry based on trusted hop count.
 * Returns null if no valid IP can be extracted, preventing fallback to allowlisted loopback.
 *
 * @param {Request} request Next.js / standard Fetch Request
 * @returns {string|null} Normalized IP address or null
 */
function extractClientIp(request) {
  if (!request || !request.headers) return null;

  // Only trust X-Forwarded-For if explicitly enabled in environment (default: false in dev)
  const trustProxy = process.env.TRUST_PROXY === "true" || process.env.NODE_ENV === "production";
  let ip = null;

  if (trustProxy) {
    const forwarded = request.headers.get("x-forwarded-for");
    if (forwarded) {
      const parts = forwarded.split(",").map(p => p.trim()).filter(Boolean);
      const hopCount = Math.max(1, parseInt(process.env.PROXY_HOPS || "1", 10));
      // Rightmost hop from trusted reverse proxy
      const targetIdx = Math.max(0, parts.length - hopCount);
      ip = parts[targetIdx] || parts[parts.length - 1];
    }
  }

  if (!ip) {
    // If not using proxy or no XFF, check for direct remote address or standard header
    ip = request.headers.get("x-real-ip");
  }

  if (!ip) return null;

  // Strip IPv6-mapped IPv4 prefix
  if (ip.startsWith("::ffff:")) {
    ip = ip.substring(7);
  }

  return ip;
}

/**
 * Checks if a client IP matches an allowed list.
 * Supports exact match, localhost equivalents, and wildcard subnets (e.g. 192.168.1.*).
 *
 * @param {string} clientIp 
 * @param {string[]} allowedList 
 * @returns {boolean}
 */
function matchIp(clientIp, allowedList = []) {
  if (!clientIp || !Array.isArray(allowedList) || allowedList.length === 0) {
    return false;
  }

  const normalizedClient = clientIp.trim();

  // Localhost aliases
  const isLocalClient = normalizedClient === "127.0.0.1" || normalizedClient === "::1" || normalizedClient === "localhost";

  for (const allowed of allowedList) {
    const norm = allowed.trim();
    if (!norm) continue;

    if (isLocalClient && (norm === "127.0.0.1" || norm === "::1" || norm === "localhost")) {
      return true;
    }

    if (norm === normalizedClient) {
      return true;
    }

    // Wildcard prefix match: e.g. "192.168.1.*" -> retain trailing dot so 192.168.10.* doesn't match
    if (norm.endsWith(".*")) {
      const prefix = norm.slice(0, -1); // keep trailing "."
      if (normalizedClient.startsWith(prefix)) return true;
    }
  }

  return false;
}

/**
 * Evaluates employee check-in geolocation and IP against active office locations.
 *
 * @param {object} params
 * @param {number|null} params.latitude
 * @param {number|null} params.longitude
 * @param {string|null} params.clientIp
 * @param {string} [params.workMode="WFO"] WFO | WFH | ON_DUTY
 * @param {object} [params.config={}] AttendanceConfig object
 * @param {Array} [params.offices=[]] Array of active OfficeLocation records
 * @returns {object} Verification assessment
 */
function verifyLocationAndIp({
  latitude,
  longitude,
  clientIp,
  workMode = "WFO",
  config = {},
  offices = [],
}) {
  const normMode = (workMode || "WFO").toUpperCase();

  // 1. Remote or On-Duty modes:
  // Allowed without office restrictions, but location/IP are not marked verified as they are outside office perimeter
  if (normMode === "WFH" || normMode === "ON_DUTY") {
    let nearestOffice = null;
    let distanceMeters = null;

    if (latitude != null && longitude != null && offices.length > 0) {
      let minDistance = Infinity;
      for (const office of offices) {
        const d = calculateDistanceMeters(latitude, longitude, office.latitude, office.longitude);
        if (d != null && d < minDistance) {
          minDistance = d;
          nearestOffice = office;
          distanceMeters = d;
        }
      }
    }

    return {
      allowed: true,
      workMode: normMode,
      locationVerified: false,
      ipVerified: false,
      distanceMeters,
      locationName: normMode === "WFH" ? "Remote (Work From Home)" : "On Duty / Client Site",
      nearestOffice: nearestOffice?.name || null,
      notes: null,
    };
  }

  // 2. On-Site (WFO) mode:
  // If no office locations are configured in the system, allow by default
  if (!offices || offices.length === 0) {
    return {
      allowed: true,
      workMode: "WFO",
      locationVerified: true,
      ipVerified: true,
      distanceMeters: null,
      locationName: "Headquarters (Default)",
      nearestOffice: null,
      notes: null,
    };
  }

  // Find the closest active office
  let nearestOffice = null;
  let minDistance = Infinity;

  if (latitude != null && longitude != null) {
    for (const office of offices) {
      const d = calculateDistanceMeters(latitude, longitude, office.latitude, office.longitude);
      if (d != null && d < minDistance) {
        minDistance = d;
        nearestOffice = office;
      }
    }
  }

  const distanceMeters = minDistance === Infinity ? null : minDistance;
  const isLocationVerified = nearestOffice != null && distanceMeters != null && distanceMeters <= (nearestOffice.radiusMeters || 200);

  // Check IP match across all offices or nearest office
  const isIpVerified = offices.some(off => matchIp(clientIp, off.allowedIps));

  // Policy enforcement checks
  const enforceGeofence = Boolean(config.enforceGeofence);
  const enforceIp = Boolean(config.enforceIp);

  if (enforceGeofence && !isLocationVerified) {
    // If strict geofence is on and GPS is missing:
    if (latitude == null || longitude == null) {
      return {
        allowed: false,
        error: "Location access is required for on-site check-in. Please allow browser location or select Work From Home.",
        code: "LOCATION_REQUIRED",
      };
    }

    // Outside geofence radius
    const radius = nearestOffice ? nearestOffice.radiusMeters : 200;
    const officeName = nearestOffice ? nearestOffice.name : "office";
    return {
      allowed: false,
      error: `You are ${distanceMeters}m away from ${officeName} (maximum allowed radius is ${radius}m). Please check in from the office or select Work From Home.`,
      code: "OUTSIDE_GEOFENCE",
      distanceMeters,
      nearestOffice: nearestOffice?.name,
    };
  }

  if (enforceIp && !isIpVerified) {
    return {
      allowed: false,
      error: "You are not connected to the authorized office Wi-Fi network. Please connect to office Wi-Fi or select Work From Home.",
      code: "UNAUTHORIZED_IP",
      clientIp,
    };
  }

  return {
    allowed: true,
    workMode: "WFO",
    locationVerified: isLocationVerified,
    ipVerified: isIpVerified,
    distanceMeters,
    locationName: nearestOffice?.name || "Office",
    nearestOffice: nearestOffice?.name || null,
  };
}

module.exports = {
  calculateDistanceMeters,
  extractClientIp,
  matchIp,
  verifyLocationAndIp,
};
