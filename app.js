const searchForm = document.querySelector("#search-form");
const placeInput = document.querySelector("#place-input");
const searchButton = document.querySelector("#search-button");
const searchStatus = document.querySelector("#search-status");
const searchResults = document.querySelector("#search-results");
const googleButton = document.querySelector("#google-button");
const amapButton = document.querySelector("#amap-button");
const wazeButton = document.querySelector("#waze-button");
const themeColorMeta = document.querySelector('meta[name="theme-color"]');
const liveRegion = document.querySelector("#live-region");

const userAgent = navigator.userAgent;
const isIPadOS = /Macintosh/i.test(userAgent) && navigator.maxTouchPoints > 1;
const isIOS = /iP(hone|ad|od)/i.test(userAgent) || isIPadOS;
const isAndroid = /Android/i.test(userAgent);
const LOCATION_SEARCH_API_URL = "https://www.map.gov.hk/gs/api/v1.0.0/locationSearch";
const AUTO_SEARCH_RESULTS_LIMIT = 5;
const MANUAL_SEARCH_RESULTS_LIMIT = 10;
const SEARCH_TIMEOUT_MS = 8000;
const SEARCH_CACHE_MAX_ENTRIES = 50;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const ARCSEC_TO_RAD = Math.PI / (180 * 3600);
const HK80_SEMI_MAJOR = 6378388;
const HK80_FLATTENING = 1 / 297;
const HK80_ECCENTRICITY_SQ = (2 * HK80_FLATTENING) - (HK80_FLATTENING * HK80_FLATTENING);
const HK80_ORIGIN_LAT = (22 + (18 / 60) + (43.68 / 3600)) * DEG_TO_RAD;
const HK80_ORIGIN_LON = (114 + (10 / 60) + (42.8 / 3600)) * DEG_TO_RAD;
const HK80_FALSE_EASTING = 836694.05;
const HK80_FALSE_NORTHING = 819069.8;
const HK80_SCALE_FACTOR = 1;
const HK80_MIN_EASTING = 700000;
const HK80_MAX_EASTING = 950000;
const HK80_MIN_NORTHING = 700000;
const HK80_MAX_NORTHING = 950000;
const HK80_TO_WGS84_DX = -162.619;
const HK80_TO_WGS84_DY = -276.959;
const HK80_TO_WGS84_DZ = -161.764;
const HK80_TO_WGS84_RX = -0.067753 * ARCSEC_TO_RAD;
const HK80_TO_WGS84_RY = 2.243648 * ARCSEC_TO_RAD;
const HK80_TO_WGS84_RZ = 1.158828 * ARCSEC_TO_RAD;
const HK80_TO_WGS84_SCALE = 1 + (-1.094246 * 1e-6);
const WGS84_SEMI_MAJOR = 6378137;
const WGS84_FLATTENING = 1 / 298.257223563;
const WGS84_ECCENTRICITY_SQ = (2 * WGS84_FLATTENING) - (WGS84_FLATTENING * WGS84_FLATTENING);
const NOISY_RESULT_PATTERNS = [
  /Wi-?Fi\.?HK/i,
  /已登記.*Wi-?Fi/i,
  /Registered WiFi Access Points/i,
  /\bAPID[:\s-]*\d+\b/i,
  /天線/,
  /基站/,
  /流動郵政局/,
  /郵箱/,
  /\bPost(?:ing)? Box\b/i,
  /自動(?:體外)?心臟(?:除|去)顫器/,
  /Automated External Defibrillator/i,
  /回收機構及收集點/,
  /Recycling Organisations and Collection Points/i,
];
const VARIANT_CHAR_MAP = {
  "㘭": "坳",
  "恆": "恒",
  "臺": "台",
  "厦": "廈",
  "滙": "匯",
  "峯": "峰",
  "啓": "啟",
  "裏": "裡",
  "綫": "線",
};
const VARIANT_CHAR_REGEX = /[㘭恆臺厦滙峯啓裏綫]/g;
const LOW_PRIORITY_RESULT_PATTERNS = [
  /前稱/,
  /別稱/,
  /Previous Name/i,
  /Other Name/i,
];
const HONG_KONG_TIME_ZONE = "Asia/Hong_Kong";
const HONG_KONG_LATITUDE = 22.3193;
const HONG_KONG_LONGITUDE = 114.1694;
const HONG_KONG_UTC_OFFSET = 8;
const MILLISECONDS_PER_DAY = 86400000;
const JULIAN_UNIX_EPOCH = 2440588;
const JULIAN_J2000 = 2451545;
const SOLAR_CYCLE_OFFSET = 0.0009;
const SOLAR_OBSERVER_ANGLE = toRadians(-0.833);
const EARTH_OBLIQUITY = toRadians(23.4397);
const SOLAR_PERIHELION = toRadians(102.9372);

const HONG_KONG_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: HONG_KONG_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  hourCycle: "h23",
});

let readyDestination = null;
let isSearchLoading = false;
let isComposingInput = false;
let activeSearchController = null;
let activeSearchQuery = "";
let activeSearchId = 0;
let cachedSunSchedule = null;
const searchResultsCache = new Map();

initializeTheme();

searchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (placeInput.value.trim()) {
    placeInput.blur();
  }
  await searchPlaces(placeInput.value, MANUAL_SEARCH_RESULTS_LIMIT);
});

placeInput.addEventListener("compositionstart", () => {
  isComposingInput = true;
});

placeInput.addEventListener("compositionend", () => {
  isComposingInput = false;
  handlePlaceInputChange();
});

placeInput.addEventListener("input", (event) => {
  if (isComposingInput || event.isComposing) {
    return;
  }

  handlePlaceInputChange();
});

function handlePlaceInputChange() {
  const query = placeInput.value.trim();
  if (!query) {
    cancelActiveSearch();
    resetState();
    clearSearchResults();
    setSearchStatus("");
    setSearchLoading(false);
    return;
  }

  if (activeSearchController && activeSearchQuery === query) {
    return;
  }

  searchPlaces(query, AUTO_SEARCH_RESULTS_LIMIT);
}

googleButton.addEventListener("click", () => {
  if (!readyDestination) {
    return;
  }

  openGoogleMapsNavigation(readyDestination);
});

amapButton.addEventListener("click", () => {
  if (!readyDestination) {
    return;
  }

  openAmapNavigation(readyDestination);
});

wazeButton.addEventListener("click", () => {
  if (!readyDestination) {
    return;
  }

  openWazeNavigation(readyDestination);
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    applyTheme(getAutomaticThemeMode());
  }
});

function initializeTheme() {
  applyTheme(getAutomaticThemeMode());
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      document.documentElement?.classList?.add("theme-ready");
    });
  });
  window.setInterval(() => {
    applyTheme(getAutomaticThemeMode());
  }, 60000);
}

async function searchPlaces(rawQuery, resultsLimit = AUTO_SEARCH_RESULTS_LIMIT) {
  const query = rawQuery.trim();
  if (!query) {
    cancelActiveSearch();
    resetState();
    clearSearchResults();
    setSearchStatus("請輸入地點。", "error");
    setSearchLoading(false);
    placeInput.focus();
    return;
  }

  const cachedPlaces = getCachedSearchResults(query);
  if (cachedPlaces) {
    cancelActiveSearch();
    resetState();
    setSearchLoading(false);
    clearSearchResults();
    displaySearchResults(cachedPlaces.slice(0, resultsLimit), query);
    return;
  }

  const searchId = startSearchRequest();
  activeSearchQuery = query;
  resetState();
  setSearchLoading(true);
  clearSearchResults();
  setSearchStatus("搜尋中...");

  try {
    const allPlaces = await fetchLocationResults(query, activeSearchController.signal);
    if (searchId !== activeSearchId) {
      return;
    }

    if (allPlaces.length) {
      setCachedSearchResults(query, allPlaces);
    }

    displaySearchResults(allPlaces.slice(0, resultsLimit), query);
  } catch (error) {
    if (searchId !== activeSearchId || error?.name === "AbortError") {
      return;
    }

    const errorMessage = getSearchErrorMessage(error);
    setSearchStatus(errorMessage, "error");
    announce(errorMessage);
  } finally {
    if (searchId === activeSearchId) {
      activeSearchController = null;
      activeSearchQuery = "";
      setSearchLoading(false);
    }
  }
}

function displaySearchResults(places, query = "") {
  if (!places.length) {
    setSearchStatus("找不到地點，請試另一個名稱。", "error");
    announce("找不到地點。");
    return;
  }

  renderSearchResults(places, query);
  setSearchStatus(`找到 ${places.length} 個結果，請選擇。`);
  announce(`找到 ${places.length} 個結果。`);
}

function getSearchCacheKey(query) {
  return query.toLowerCase();
}

function getCachedSearchResults(query) {
  const key = getSearchCacheKey(query);
  if (!searchResultsCache.has(key)) {
    return null;
  }

  const cached = searchResultsCache.get(key);
  searchResultsCache.delete(key);
  searchResultsCache.set(key, cached);
  return cached;
}

function setCachedSearchResults(query, places) {
  const key = getSearchCacheKey(query);
  if (searchResultsCache.has(key)) {
    searchResultsCache.delete(key);
  } else if (searchResultsCache.size >= SEARCH_CACHE_MAX_ENTRIES) {
    const oldestKey = searchResultsCache.keys().next().value;
    searchResultsCache.delete(oldestKey);
  }

  searchResultsCache.set(key, places);
}

async function fetchLocationResults(query, signal) {
  const url = new URL(LOCATION_SEARCH_API_URL);
  url.searchParams.set("q", query);

  const data = await fetchJsonWithTimeout(url.toString(), SEARCH_TIMEOUT_MS, signal);
  if (!Array.isArray(data)) {
    return [];
  }

  const rankedPlaces = data
    .map(normalizePlaceResult)
    .filter(Boolean)
    .filter((place) => !isNoisyPlaceResult(place))
    .sort((first, second) => rankPlaceResult(first, query) - rankPlaceResult(second, query));

  return deduplicateDisplayedPlaces(rankedPlaces);
}

function normalizePlaceResult(item) {
  const x = Number(item?.x);
  const y = Number(item?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  const nameZH = cleanText(item.nameZH);
  const nameEN = cleanText(item.nameEN);
  const addressZH = cleanText(item.addressZH);
  const addressEN = cleanText(item.addressEN);
  const districtZH = cleanText(item.districtZH);
  const districtEN = cleanText(item.districtEN);

  const name = nameZH ||
    nameEN ||
    addressZH ||
    addressEN ||
    "未命名地點";
  const district = districtZH || districtEN;
  const address = [
    addressZH || addressEN,
    district,
  ].filter(Boolean).join(" · ");

  return {
    name,
    nameZH,
    nameEN,
    address,
    addressZH,
    addressEN,
    district,
    searchText: cleanText([
      nameZH,
      addressZH,
      districtZH,
      nameEN,
      addressEN,
      districtEN,
    ].filter(Boolean).join(" ")),
    x,
    y,
  };
}

function isNoisyPlaceResult(place) {
  return NOISY_RESULT_PATTERNS.some((pattern) => pattern.test(place.searchText));
}

function deduplicateDisplayedPlaces(places) {
  const seenKeys = new Set();

  return places.filter((place) => {
    const duplicateKey = getDisplayedPlaceKey(place);
    if (seenKeys.has(duplicateKey)) {
      return false;
    }

    seenKeys.add(duplicateKey);
    return true;
  });
}

function getDisplayedPlaceKey(place) {
  return `${normalizeSearchText(place.name)}|${normalizeSearchText(place.address)}`;
}

function rankPlaceResult(place, query) {
  const normalizedQuery = normalizeSearchText(query);
  const normalizedName = normalizeSearchText(place.name);
  const normalizedAddress = normalizeSearchText(place.address);
  const normalizedSearchText = normalizeSearchText(place.searchText);
  const normalizedNameEN = normalizeSearchText(place.nameEN);
  const normalizedAddressEN = normalizeSearchText(place.addressEN);
  const relaxedQuery = normalizeRelaxedSearchText(query);
  const relaxedName = normalizeRelaxedSearchText(place.name);
  const relaxedAddress = normalizeRelaxedSearchText(place.address);
  const relaxedSearchText = normalizeRelaxedSearchText(place.searchText);

  const bonuses = [
    getContinuousMatchBonus(normalizedQuery, normalizedName, normalizedAddress, normalizedSearchText, 0),
    getContinuousMatchBonus(relaxedQuery, relaxedName, relaxedAddress, relaxedSearchText, 5),
    getMultiKeywordMatchBonus(query, normalizedName, normalizedSearchText, normalizeSearchText, 0),
    getMultiKeywordMatchBonus(query, relaxedName, relaxedSearchText, normalizeRelaxedSearchText, 3),
  ];

  if (normalizedNameEN || normalizedAddressEN) {
    bonuses.push(
      getContinuousMatchBonus(normalizedQuery, normalizedNameEN, normalizedAddressEN, normalizedSearchText, 0),
      getMultiKeywordMatchBonus(query, normalizedNameEN, normalizedSearchText, normalizeSearchText, 0),
      getAcronymMatchBonus(normalizedQuery, place.nameEN),
    );
  }

  let score = 100 - Math.max(...bonuses);

  if (LOW_PRIORITY_RESULT_PATTERNS.some((pattern) => pattern.test(place.searchText))) {
    score += 40;
  }

  return score;
}

function getAcronymMatchBonus(normalizedQuery, nameEN) {
  if (!nameEN || !/^[a-z]{2,6}$/.test(normalizedQuery)) {
    return 0;
  }

  const initials = cleanText(nameEN)
    .split(/[\s\-/]+/)
    .map((word) => word.replace(/[^a-z0-9]/gi, "").charAt(0).toLowerCase())
    .filter(Boolean)
    .join("");

  return initials === normalizedQuery ? 75 : 0;
}

function getContinuousMatchBonus(query, name, address, searchText, penalty) {
  if (!query) {
    return 0;
  }

  if (name === query) {
    return 90 - penalty;
  }

  if (name.startsWith(query)) {
    return 70 - penalty;
  }

  if (name.includes(query)) {
    return 55 - penalty;
  }

  if (address.includes(query)) {
    return 25 - penalty;
  }

  if (searchText.includes(query)) {
    return Math.max(1, 10 - penalty);
  }

  return 0;
}

function getMultiKeywordMatchBonus(rawQuery, name, searchText, normalizer, penalty) {
  const tokens = cleanText(rawQuery)
    .split(" ")
    .map(normalizer)
    .filter(Boolean);
  if (tokens.length < 2) {
    return 0;
  }

  if (tokens.every((token) => name.includes(token))) {
    return (name.startsWith(tokens[0]) ? 60 : 50) - penalty;
  }

  if (!tokens.every((token) => searchText.includes(token))) {
    return 0;
  }

  if (name.includes(tokens[tokens.length - 1])) {
    return 40 - penalty;
  }

  if (tokens.some((token) => name.includes(token))) {
    return 32 - penalty;
  }

  return 22 - penalty;
}

function isEnglishQuery(query) {
  return /[a-z]/i.test(query) && !/[\u3400-\u9fff]/.test(query);
}

function formatSelectedPlaceLabel(place) {
  if (place.district && !place.name.includes(place.district)) {
    return `${place.name} · ${place.district}`;
  }

  if (!place.district && place.address && place.address !== place.name) {
    return `${place.name} · ${place.address}`;
  }

  return place.name;
}

function renderSearchResults(places, query = "") {
  const showEnglishName = isEnglishQuery(query);
  searchResults.textContent = "";

  places.forEach((place) => {
    const button = document.createElement("button");
    const name = document.createElement("span");
    const shouldShowEnglishSubtitle = showEnglishName &&
      place.nameEN &&
      normalizeSearchText(place.nameEN) !== normalizeSearchText(place.name);
    const ariaParts = [place.name];

    button.type = "button";
    button.className = "result-button";
    button.addEventListener("click", () => {
      selectPlace(place);
    });

    name.className = "result-name";
    name.textContent = place.name;
    button.append(name);

    if (shouldShowEnglishSubtitle) {
      const nameEN = document.createElement("span");
      nameEN.className = "result-name-en";
      nameEN.textContent = place.nameEN;
      button.append(nameEN);
      ariaParts.push(place.nameEN);
    }

    if (place.address) {
      const address = document.createElement("span");
      address.className = "result-address";
      address.textContent = place.address;
      button.append(address);
      ariaParts.push(place.address);
    }

    button.setAttribute("aria-label", ariaParts.join("，"));
    searchResults.append(button);
  });

  searchResults.hidden = false;
}

function selectPlace(place) {
  if (isSearchLoading) {
    return;
  }

  cancelActiveSearch();
  placeInput.blur();

  try {
    const coordinates = transformHKGridToWGS84(place.x, place.y);
    const result = buildSuccessResult(coordinates.latitude, coordinates.longitude);
    if (!result.ok) {
      throw new Error(result.message);
    }

    const selectedLabel = formatSelectedPlaceLabel(place);
    setReadyDestination({ ...result, name: place.name }, `已選擇${selectedLabel}。`);
    clearSearchResults();
    setSearchStatus(`已選擇：${selectedLabel}`, "ready");
  } catch (error) {
    resetState();
    setSearchStatus("未能轉換政府地圖座標，請選擇另一個結果。", "error");
    announce("未能轉換政府地圖座標。");
  }
}

function transformHKGridToWGS84(easting, northing) {
  if (
    !Number.isFinite(easting) ||
    !Number.isFinite(northing) ||
    easting < HK80_MIN_EASTING ||
    easting > HK80_MAX_EASTING ||
    northing < HK80_MIN_NORTHING ||
    northing > HK80_MAX_NORTHING
  ) {
    throw new Error("Invalid HK1980 grid coordinate");
  }

  const hk80Geo = convertHKGridToHK80Geo(easting, northing);
  const { latitude, longitude } = convertHK80GeoToWGS84(hk80Geo.latitude, hk80Geo.longitude);
  if (!isValidCoordinate(latitude, longitude)) {
    throw new Error("Invalid transformed coordinate");
  }

  return { latitude, longitude };
}

function calculateMeridionalArc(phi, semiMajor, eccentricitySq) {
  const e4 = eccentricitySq * eccentricitySq;
  const e6 = e4 * eccentricitySq;
  const a0 = 1 - (eccentricitySq / 4) - ((3 * e4) / 64) - ((5 * e6) / 256);
  const a2 = (3 / 8) * (eccentricitySq + (e4 / 4) + ((15 * e6) / 128));
  const a4 = (15 / 256) * (e4 + ((3 * e6) / 4));
  const a6 = (35 * e6) / 3072;

  return semiMajor * (
    (a0 * phi) -
    (a2 * Math.sin(2 * phi)) +
    (a4 * Math.sin(4 * phi)) -
    (a6 * Math.sin(6 * phi))
  );
}

function convertHKGridToHK80Geo(easting, northing) {
  const m0 = calculateMeridionalArc(HK80_ORIGIN_LAT, HK80_SEMI_MAJOR, HK80_ECCENTRICITY_SQ);
  const m = m0 + ((northing - HK80_FALSE_NORTHING) / HK80_SCALE_FACTOR);
  const sqrtOneMinusE2 = Math.sqrt(1 - HK80_ECCENTRICITY_SQ);
  const e1 = (1 - sqrtOneMinusE2) / (1 + sqrtOneMinusE2);
  const e1Sq = e1 * e1;
  const e1Cu = e1Sq * e1;
  const e1Qd = e1Sq * e1Sq;
  const e4 = HK80_ECCENTRICITY_SQ * HK80_ECCENTRICITY_SQ;
  const e6 = e4 * HK80_ECCENTRICITY_SQ;
  const mu = m / (HK80_SEMI_MAJOR * (1 - (HK80_ECCENTRICITY_SQ / 4) - ((3 * e4) / 64) - ((5 * e6) / 256)));
  const phi1 = mu +
    (((3 * e1) / 2) - ((27 * e1Cu) / 32)) * Math.sin(2 * mu) +
    (((21 * e1Sq) / 16) - ((55 * e1Qd) / 32)) * Math.sin(4 * mu) +
    ((151 * e1Cu) / 96) * Math.sin(6 * mu) +
    ((1097 * e1Qd) / 512) * Math.sin(8 * mu);

  const sinPhi1 = Math.sin(phi1);
  const cosPhi1 = Math.cos(phi1);
  const tanPhi1 = Math.tan(phi1);
  const ep2 = HK80_ECCENTRICITY_SQ / (1 - HK80_ECCENTRICITY_SQ);
  const c1 = ep2 * cosPhi1 * cosPhi1;
  const t1 = tanPhi1 * tanPhi1;
  const denom = 1 - (HK80_ECCENTRICITY_SQ * sinPhi1 * sinPhi1);
  const n1 = HK80_SEMI_MAJOR / Math.sqrt(denom);
  const r1 = (HK80_SEMI_MAJOR * (1 - HK80_ECCENTRICITY_SQ)) / Math.pow(denom, 1.5);
  const d = (easting - HK80_FALSE_EASTING) / (n1 * HK80_SCALE_FACTOR);
  const d2 = d * d;
  const d3 = d2 * d;
  const d4 = d2 * d2;
  const d5 = d4 * d;
  const d6 = d4 * d2;

  const latitude = phi1 - ((n1 * tanPhi1) / r1) * (
    (d2 / 2) -
    (((5 + (3 * t1) + (10 * c1) - (4 * c1 * c1) - (9 * ep2)) * d4) / 24) +
    (((61 + (90 * t1) + (298 * c1) + (45 * t1 * t1) - (252 * ep2) - (3 * c1 * c1)) * d6) / 720)
  );
  const longitude = HK80_ORIGIN_LON + (
    d -
    (((1 + (2 * t1) + c1) * d3) / 6) +
    (((5 - (2 * c1) + (28 * t1) - (3 * c1 * c1) + (8 * ep2) + (24 * t1 * t1)) * d5) / 120)
  ) / cosPhi1;

  return { latitude, longitude };
}

function convertHK80GeoToWGS84(latitudeRad, longitudeRad) {
  const sinLat = Math.sin(latitudeRad);
  const cosLat = Math.cos(latitudeRad);
  const sinLon = Math.sin(longitudeRad);
  const cosLon = Math.cos(longitudeRad);
  const nu = HK80_SEMI_MAJOR / Math.sqrt(1 - (HK80_ECCENTRICITY_SQ * sinLat * sinLat));

  const x = nu * cosLat * cosLon;
  const y = nu * cosLat * sinLon;
  const z = nu * (1 - HK80_ECCENTRICITY_SQ) * sinLat;

  const x2 = HK80_TO_WGS84_DX + (HK80_TO_WGS84_SCALE * (x + (HK80_TO_WGS84_RZ * y) - (HK80_TO_WGS84_RY * z)));
  const y2 = HK80_TO_WGS84_DY + (HK80_TO_WGS84_SCALE * ((-HK80_TO_WGS84_RZ * x) + y + (HK80_TO_WGS84_RX * z)));
  const z2 = HK80_TO_WGS84_DZ + (HK80_TO_WGS84_SCALE * ((HK80_TO_WGS84_RY * x) - (HK80_TO_WGS84_RX * y) + z));

  const longitude = Math.atan2(y2, x2);
  const p = Math.hypot(x2, y2);
  let latitude = Math.atan2(z2, p * (1 - WGS84_ECCENTRICITY_SQ));

  for (let iteration = 0; iteration < 6; iteration += 1) {
    const sinIter = Math.sin(latitude);
    const nu2 = WGS84_SEMI_MAJOR / Math.sqrt(1 - (WGS84_ECCENTRICITY_SQ * sinIter * sinIter));
    latitude = Math.atan2(z2 + (WGS84_ECCENTRICITY_SQ * nu2 * sinIter), p);
  }

  return {
    latitude: latitude * RAD_TO_DEG,
    longitude: longitude * RAD_TO_DEG,
  };
}

async function fetchJsonWithTimeout(url, timeoutMs, signal) {
  const controller = new AbortController();
  let didTimeout = false;
  const timeoutId = window.setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);
  const abortRequest = () => {
    controller.abort();
  };

  if (signal?.aborted) {
    controller.abort();
  } else {
    signal?.addEventListener("abort", abortRequest, { once: true });
  }

  try {
    const response = await fetch(url, {
      cache: "no-store",
      mode: "cors",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    if (didTimeout && !signal?.aborted) {
      const timeoutError = new Error("Request timed out");
      timeoutError.name = "TimeoutError";
      throw timeoutError;
    }

    throw error;
  } finally {
    window.clearTimeout(timeoutId);
    signal?.removeEventListener("abort", abortRequest);
  }
}

function buildSuccessResult(latitude, longitude) {
  if (!isValidCoordinate(latitude, longitude)) {
    return {
      ok: false,
      message: "辨識到的緯度或經度超出範圍，請檢查輸入內容是否正確。",
    };
  }

  return {
    ok: true,
    latitude,
    longitude,
    latitudeText: formatCoordinate(latitude),
    longitudeText: formatCoordinate(longitude),
  };
}

function isValidCoordinate(latitude, longitude) {
  return Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180;
}

function formatCoordinate(value) {
  return value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

function buildGoogleMapsDirectionUrl(latitudeText, longitudeText) {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${latitudeText},${longitudeText}`)}&travelmode=driving`;
}

function buildAmapWebUrl(latitudeText, longitudeText, name) {
  const destination = `${longitudeText},${latitudeText},${name || "目的地"}`;
  return `https://uri.amap.com/navigation?to=${encodeURIComponent(destination)}&mode=car&policy=0&coordinate=wgs84&src=HKQuickNav`;
}

function buildWazeUrl(latitudeText, longitudeText) {
  return `https://waze.com/ul?ll=${encodeURIComponent(`${latitudeText},${longitudeText}`)}&navigate=yes&utm_source=HKQuickNav`;
}

function buildAndroidIntentUrl(destination, fallbackUrl) {
  return `intent://maps.google.com/maps?daddr=${encodeURIComponent(destination)}&directionsmode=driving#Intent;scheme=https;package=com.google.android.apps.maps;S.browser_fallback_url=${encodeURIComponent(fallbackUrl)};end`;
}

function openGoogleMapsNavigation(destination) {
  const destinationText = `${destination.latitudeText},${destination.longitudeText}`;
  const fallbackUrl = buildGoogleMapsDirectionUrl(destination.latitudeText, destination.longitudeText);
  const appUrl = isIOS
    ? `comgooglemaps://?daddr=${encodeURIComponent(destinationText)}&directionsmode=driving`
    : isAndroid
      ? buildAndroidIntentUrl(destinationText, fallbackUrl)
      : fallbackUrl;

  openWithFallback(appUrl, fallbackUrl);
}

function openAmapNavigation(destination) {
  const fallbackUrl = buildAmapWebUrl(destination.latitudeText, destination.longitudeText, destination.name);
  const placeName = encodeURIComponent(destination.name || "目的地");
  const appUrl = isIOS
    ? `iosamap://navi?sourceApplication=HKQuickNav&poiname=${placeName}&lat=${encodeURIComponent(destination.latitudeText)}&lon=${encodeURIComponent(destination.longitudeText)}&dev=1&style=0`
    : isAndroid
      ? `androidamap://navi?sourceApplication=HKQuickNav&poiname=${placeName}&lat=${encodeURIComponent(destination.latitudeText)}&lon=${encodeURIComponent(destination.longitudeText)}&dev=1&style=0`
      : fallbackUrl;

  openWithFallback(appUrl, fallbackUrl);
}

function openWazeNavigation(destination) {
  window.location.href = buildWazeUrl(destination.latitudeText, destination.longitudeText);
}

function openWithFallback(appUrl, fallbackUrl) {
  if (appUrl === fallbackUrl) {
    window.location.href = fallbackUrl;
    return;
  }

  const cleanup = () => {
    window.clearTimeout(fallbackTimer);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    window.removeEventListener("blur", cleanup);
    window.removeEventListener("pagehide", cleanup);
  };

  const handleVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      cleanup();
    }
  };

  const fallbackTimer = window.setTimeout(() => {
    cleanup();
    window.location.href = fallbackUrl;
  }, 700);

  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("blur", cleanup, { once: true });
  window.addEventListener("pagehide", cleanup, { once: true });

  try {
    window.location.href = appUrl;
  } catch (error) {
    cleanup();
    window.location.href = fallbackUrl;
  }
}

function getAutomaticThemeMode() {
  const hongKongNow = getHongKongDateParts(new Date());
  const dateKey = `${hongKongNow.year}-${hongKongNow.month}-${hongKongNow.day}`;
  if (!cachedSunSchedule || cachedSunSchedule.dateKey !== dateKey) {
    cachedSunSchedule = {
      dateKey,
      sunriseMinutes: calculateSunEventMinutes(hongKongNow, false),
      sunsetMinutes: calculateSunEventMinutes(hongKongNow, true),
    };
  }

  const nowMinutes = hongKongNow.hour * 60 + hongKongNow.minute + hongKongNow.second / 60;

  return nowMinutes < cachedSunSchedule.sunriseMinutes || nowMinutes >= cachedSunSchedule.sunsetMinutes ? "dark" : "light";
}

function applyTheme(mode) {
  const isDark = mode === "dark";
  document.documentElement?.classList?.toggle("theme-dark", isDark);
  document.body.classList.toggle("theme-dark", isDark);

  if (themeColorMeta) {
    themeColorMeta.setAttribute("content", isDark ? "#000000" : "#ffffff");
  }
}

function getHongKongDateParts(date) {
  const values = {};

  HONG_KONG_DATE_FORMATTER.formatToParts(date).forEach((part) => {
    if (part.type !== "literal") {
      values[part.type] = Number(part.value);
    }
  });

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function calculateSunEventMinutes(dateParts, isSunset) {
  const solarDate = createHongKongSolarDate(dateParts);
  const longitudeWest = toRadians(-HONG_KONG_LONGITUDE);
  const latitude = toRadians(HONG_KONG_LATITUDE);
  const days = toDays(solarDate);
  const cycle = julianCycle(days, longitudeWest);
  const transitApproximation = approximateTransit(0, longitudeWest, cycle);
  const meanAnomaly = solarMeanAnomaly(transitApproximation);
  const longitude = eclipticLongitude(meanAnomaly);
  const declination = solarDeclination(longitude);
  const solarNoon = solarTransitJulian(transitApproximation, meanAnomaly, longitude);
  const sunsetJulian = getSetJulian(
    SOLAR_OBSERVER_ANGLE,
    longitudeWest,
    latitude,
    declination,
    cycle,
    meanAnomaly,
    longitude,
  );
  const eventJulian = isSunset ? sunsetJulian : solarNoon - (sunsetJulian - solarNoon);

  return getHongKongMinutesFromDate(fromJulian(eventJulian));
}

function createHongKongSolarDate(dateParts) {
  return new Date(Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day, 12 - HONG_KONG_UTC_OFFSET, 0, 0));
}

function getHongKongMinutesFromDate(date) {
  const parts = getHongKongDateParts(date);
  return parts.hour * 60 + parts.minute + parts.second / 60;
}

function toJulian(date) {
  return (date.valueOf() / MILLISECONDS_PER_DAY) - 0.5 + JULIAN_UNIX_EPOCH;
}

function fromJulian(value) {
  return new Date((value + 0.5 - JULIAN_UNIX_EPOCH) * MILLISECONDS_PER_DAY);
}

function toDays(date) {
  return toJulian(date) - JULIAN_J2000;
}

function julianCycle(days, longitudeWest) {
  return Math.round(days - SOLAR_CYCLE_OFFSET - (longitudeWest / (2 * Math.PI)));
}

function approximateTransit(hourAngle, longitudeWest, cycle) {
  return SOLAR_CYCLE_OFFSET + ((hourAngle + longitudeWest) / (2 * Math.PI)) + cycle;
}

function solarMeanAnomaly(days) {
  return toRadians(357.5291 + (0.98560028 * days));
}

function eclipticLongitude(meanAnomaly) {
  const equationOfCenter = toRadians(
    (1.9148 * Math.sin(meanAnomaly)) +
    (0.02 * Math.sin(2 * meanAnomaly)) +
    (0.0003 * Math.sin(3 * meanAnomaly))
  );

  return meanAnomaly + equationOfCenter + SOLAR_PERIHELION + Math.PI;
}

function solarDeclination(longitude) {
  return Math.asin(Math.sin(EARTH_OBLIQUITY) * Math.sin(longitude));
}

function solarTransitJulian(approximation, meanAnomaly, longitude) {
  return JULIAN_J2000 + approximation + (0.0053 * Math.sin(meanAnomaly)) - (0.0069 * Math.sin(2 * longitude));
}

function hourAngle(angle, latitude, declination) {
  return Math.acos(
    (Math.sin(angle) - (Math.sin(latitude) * Math.sin(declination))) /
    (Math.cos(latitude) * Math.cos(declination))
  );
}

function getSetJulian(angle, longitudeWest, latitude, declination, cycle, meanAnomaly, longitude) {
  const setHourAngle = hourAngle(angle, latitude, declination);
  const setApproximation = approximateTransit(setHourAngle, longitudeWest, cycle);
  return solarTransitJulian(setApproximation, meanAnomaly, longitude);
}

function toRadians(value) {
  return value * (Math.PI / 180);
}

function setReadyDestination(destination, announcement) {
  readyDestination = {
    ...destination,
    name: destination.name || "目的地",
  };
  googleButton.disabled = false;
  amapButton.disabled = false;
  wazeButton.disabled = false;
  announce(announcement);
}

function resetState() {
  readyDestination = null;
  googleButton.disabled = true;
  amapButton.disabled = true;
  wazeButton.disabled = true;
}

function setSearchLoading(isLoading) {
  isSearchLoading = isLoading;
  searchButton.disabled = isLoading;

  searchResults.querySelectorAll("button").forEach((button) => {
    button.disabled = isLoading;
  });
}

function startSearchRequest() {
  cancelActiveSearch();
  activeSearchController = new AbortController();
  activeSearchId += 1;
  return activeSearchId;
}

function cancelActiveSearch() {
  if (activeSearchController) {
    activeSearchController.abort();
    activeSearchController = null;
  }

  activeSearchQuery = "";
  activeSearchId += 1;
}

function setSearchStatus(message, type = "") {
  searchStatus.textContent = message;
  searchStatus.hidden = !message;
  searchStatus.className = "search-status";

  if (type) {
    searchStatus.classList.add(`is-${type}`);
  }
}

function clearSearchResults() {
  searchResults.textContent = "";
  searchResults.hidden = true;
}

function cleanText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function normalizeSearchText(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(VARIANT_CHAR_REGEX, (character) => VARIANT_CHAR_MAP[character] || character)
    .replace(/[\s\-.,，。:：/|()（）·]/g, "");
}

function normalizeRelaxedSearchText(value) {
  return normalizeSearchText(value).replace(/村/g, "邨");
}

function getSearchErrorMessage(error) {
  if (error?.name === "TimeoutError") {
    return "政府地圖回應太慢，請再按一次搜尋。";
  }

  return "未能連接政府地圖資料，請稍後再試。";
}

function announce(message) {
  liveRegion.textContent = "";
  window.requestAnimationFrame(() => {
    liveRegion.textContent = message;
  });
}
