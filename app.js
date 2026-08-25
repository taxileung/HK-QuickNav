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
const TRANSFORM_API_URL = "https://www.geodetic.gov.hk/transform/v2/";
const AUTO_SEARCH_RESULTS_LIMIT = 5;
const MANUAL_SEARCH_RESULTS_LIMIT = 10;
const SEARCH_TIMEOUT_MS = 8000;
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
];
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

let readyDestination = null;
let isSearchLoading = false;
let activeSearchController = null;
let activeSearchId = 0;
let activeSelectionId = 0;

initializeTheme();

searchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await searchPlaces(placeInput.value, MANUAL_SEARCH_RESULTS_LIMIT);
});

placeInput.addEventListener("input", () => {
  const query = placeInput.value.trim();
  if (!query) {
    cancelActiveSearch();
    clearSearchResults();
    setSearchStatus("");
    setSearchLoading(false);
    return;
  }

  searchPlaces(query, AUTO_SEARCH_RESULTS_LIMIT);
});

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
  window.setInterval(() => {
    applyTheme(getAutomaticThemeMode());
  }, 60000);
}

async function searchPlaces(rawQuery, resultsLimit = AUTO_SEARCH_RESULTS_LIMIT) {
  const query = rawQuery.trim();
  if (!query) {
    cancelActiveSearch();
    clearSearchResults();
    setSearchStatus("請輸入地點。", "error");
    placeInput.focus();
    return;
  }

  const searchId = startSearchRequest();
  resetState();
  setSearchLoading(true);
  clearSearchResults();
  setSearchStatus("搜尋中...");

  try {
    const places = await fetchLocationResults(query, resultsLimit, activeSearchController.signal);
    if (searchId !== activeSearchId) {
      return;
    }

    if (!places.length) {
      setSearchStatus("找不到地點，請試另一個名稱。", "error");
      announce("找不到地點。");
      return;
    }

    renderSearchResults(places);
    setSearchStatus(`找到 ${places.length} 個結果，請選擇。`);
    announce(`找到 ${places.length} 個結果。`);
  } catch (error) {
    if (searchId !== activeSearchId || error?.name === "AbortError") {
      return;
    }

    setSearchStatus(getSearchErrorMessage(error), "error");
    announce("未能連接政府地圖資料。");
  } finally {
    if (searchId === activeSearchId) {
      activeSearchController = null;
      setSearchLoading(false);
    }
  }
}

async function fetchLocationResults(query, resultsLimit, signal) {
  const url = new URL(LOCATION_SEARCH_API_URL);
  url.searchParams.set("q", query);

  const data = await fetchJsonWithTimeout(url.toString(), SEARCH_TIMEOUT_MS, signal);
  if (!Array.isArray(data)) {
    return [];
  }

  return data
    .map(normalizePlaceResult)
    .filter(Boolean)
    .filter((place) => !isNoisyPlaceResult(place))
    .filter(deduplicateDisplayedPlace)
    .sort((first, second) => rankPlaceResult(first, query) - rankPlaceResult(second, query))
    .slice(0, resultsLimit);
}

function normalizePlaceResult(item) {
  const x = Number(item?.x);
  const y = Number(item?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  const name = cleanText(item.nameZH) ||
    cleanText(item.nameEN) ||
    cleanText(item.addressZH) ||
    cleanText(item.addressEN) ||
    "未命名地點";
  const address = [
    cleanText(item.addressZH) || cleanText(item.addressEN),
    cleanText(item.districtZH) || cleanText(item.districtEN),
  ].filter(Boolean).join(" · ");

  return {
    name,
    address,
    searchText: cleanText([
      item.nameZH,
      item.addressZH,
      item.districtZH,
      item.nameEN,
      item.addressEN,
      item.districtEN,
    ].filter(Boolean).join(" ")),
    x,
    y,
  };
}

function isNoisyPlaceResult(place) {
  return NOISY_RESULT_PATTERNS.some((pattern) => pattern.test(place.searchText));
}

function deduplicateDisplayedPlace(place, index, places) {
  const duplicateKey = getDisplayedPlaceKey(place);
  return places.findIndex((candidate) => getDisplayedPlaceKey(candidate) === duplicateKey) === index;
}

function getDisplayedPlaceKey(place) {
  return `${normalizeSearchText(place.name)}|${normalizeSearchText(place.address)}`;
}

function rankPlaceResult(place, query) {
  const normalizedQuery = normalizeSearchText(query);
  const normalizedName = normalizeSearchText(place.name);
  const normalizedAddress = normalizeSearchText(place.address);
  const normalizedSearchText = normalizeSearchText(place.searchText);
  let score = 100;

  if (normalizedName === normalizedQuery) {
    score -= 90;
  } else if (normalizedName.startsWith(normalizedQuery)) {
    score -= 70;
  } else if (normalizedName.includes(normalizedQuery)) {
    score -= 55;
  } else if (normalizedAddress.includes(normalizedQuery)) {
    score -= 25;
  } else if (normalizedSearchText.includes(normalizedQuery)) {
    score -= 10;
  }

  if (LOW_PRIORITY_RESULT_PATTERNS.some((pattern) => pattern.test(place.searchText))) {
    score += 40;
  }

  return score;
}

function renderSearchResults(places) {
  searchResults.textContent = "";

  places.forEach((place) => {
    const button = document.createElement("button");
    const name = document.createElement("span");
    const address = document.createElement("span");

    button.type = "button";
    button.className = "result-button";
    button.setAttribute("aria-label", place.address ? `${place.name}，${place.address}` : place.name);
    button.addEventListener("click", () => {
      selectPlace(place);
    });

    name.className = "result-name";
    name.textContent = place.name;
    button.append(name);

    if (place.address) {
      address.className = "result-address";
      address.textContent = place.address;
      button.append(address);
    }

    searchResults.append(button);
  });

  searchResults.hidden = false;
}

async function selectPlace(place) {
  if (isSearchLoading) {
    return;
  }

  const selectionId = startSelectionRequest();
  setSearchLoading(true);
  setSearchStatus("轉換座標中...");

  try {
    const coordinates = await transformHKGridToWGS84(place.x, place.y);
    if (selectionId !== activeSelectionId) {
      return;
    }

    const result = buildSuccessResult(coordinates.latitude, coordinates.longitude, "政府地圖搜尋");
    if (!result.ok) {
      throw new Error(result.message);
    }

    setReadyDestination({ ...result, name: place.name }, `已選擇${place.name}。`);
    clearSearchResults();
    setSearchStatus(`已選擇：${place.name}`);
  } catch (error) {
    if (selectionId !== activeSelectionId) {
      return;
    }

    setSearchStatus("未能轉換政府地圖座標，請選擇另一個結果。", "error");
    announce("未能轉換政府地圖座標。");
  } finally {
    if (selectionId === activeSelectionId) {
      setSearchLoading(false);
    }
  }
}

async function transformHKGridToWGS84(easting, northing) {
  const url = new URL(TRANSFORM_API_URL);
  url.searchParams.set("inSys", "hkgrid");
  url.searchParams.set("outSys", "wgsgeog");
  url.searchParams.set("e", String(easting));
  url.searchParams.set("n", String(northing));

  const data = await fetchJsonWithTimeout(url.toString(), SEARCH_TIMEOUT_MS);
  if (data?.ErrorCode) {
    throw new Error(`Coordinate transform error ${data.ErrorCode}`);
  }

  const latitude = Number(data?.wgsLat);
  const longitude = Number(data?.wgsLong);
  if (!isValidCoordinate(latitude, longitude)) {
    throw new Error("Invalid transformed coordinate");
  }

  return { latitude, longitude };
}

async function fetchJsonWithTimeout(url, timeoutMs, signal) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => {
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
  } finally {
    window.clearTimeout(timeoutId);
    signal?.removeEventListener("abort", abortRequest);
  }
}

function buildSuccessResult(latitude, longitude, sourceFormat) {
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
    sourceFormat,
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
  return `https://uri.amap.com/navigation?to=${encodeURIComponent(destination)}&mode=car&policy=0&src=HKPlaceNav`;
}

function buildWazeUrl(latitudeText, longitudeText) {
  return `https://waze.com/ul?ll=${encodeURIComponent(`${latitudeText},${longitudeText}`)}&navigate=yes&utm_source=HKPlaceNav`;
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
    ? `iosamap://navi?sourceApplication=HKPlaceNav&poiname=${placeName}&lat=${encodeURIComponent(destination.latitudeText)}&lon=${encodeURIComponent(destination.longitudeText)}&dev=1&style=0`
    : isAndroid
      ? `androidamap://navi?sourceApplication=HKPlaceNav&poiname=${placeName}&lat=${encodeURIComponent(destination.latitudeText)}&lon=${encodeURIComponent(destination.longitudeText)}&dev=1&style=0`
      : fallbackUrl;

  openWithFallback(appUrl, fallbackUrl);
}

function openWazeNavigation(destination) {
  window.location.href = buildWazeUrl(destination.latitudeText, destination.longitudeText);
}

function openWithFallback(appUrl, fallbackUrl) {
  const cancelFallback = () => window.clearTimeout(fallbackTimer);
  const markNavigationStarted = () => {
    cancelFallback();
    window.removeEventListener("blur", markNavigationStarted);
    window.removeEventListener("pagehide", markNavigationStarted);
  };

  const fallbackTimer = window.setTimeout(() => {
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    window.removeEventListener("blur", markNavigationStarted);
    window.removeEventListener("pagehide", markNavigationStarted);
    window.location.href = fallbackUrl;
  }, 700);

  const handleVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      markNavigationStarted();
    }
  };

  document.addEventListener("visibilitychange", handleVisibilityChange, { once: true });
  window.addEventListener("blur", markNavigationStarted, { once: true });
  window.addEventListener("pagehide", markNavigationStarted, { once: true });

  try {
    window.location.href = appUrl;
  } catch (error) {
    cancelFallback();
    window.location.href = fallbackUrl;
  }
}

function getAutomaticThemeMode() {
  const hongKongNow = getHongKongDateParts(new Date());
  const sunriseMinutes = calculateSunEventMinutes(hongKongNow, false);
  const sunsetMinutes = calculateSunEventMinutes(hongKongNow, true);
  const nowMinutes = hongKongNow.hour * 60 + hongKongNow.minute + hongKongNow.second / 60;

  return nowMinutes < sunriseMinutes || nowMinutes >= sunsetMinutes ? "dark" : "light";
}

function applyTheme(mode) {
  const isDark = mode === "dark";
  document.body.classList.toggle("theme-dark", isDark);

  if (themeColorMeta) {
    themeColorMeta.setAttribute("content", isDark ? "#000000" : "#ffffff");
  }
}

function getHongKongDateParts(date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
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
  const values = {};

  formatter.formatToParts(date).forEach((part) => {
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
  searchForm.classList.toggle("is-loading", isLoading);

  searchResults.querySelectorAll("button").forEach((button) => {
    button.disabled = isLoading;
  });
}

function startSearchRequest() {
  cancelActiveSearch();
  activeSelectionId += 1;
  activeSearchController = new AbortController();
  activeSearchId += 1;
  return activeSearchId;
}

function startSelectionRequest() {
  cancelActiveSearch();
  activeSelectionId += 1;
  return activeSelectionId;
}

function cancelActiveSearch() {
  if (activeSearchController) {
    activeSearchController.abort();
    activeSearchController = null;
  }

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
    .replace(/㘭/g, "坳")
    .replace(/[\s\-.,，。:：/|()（）·]/g, "");
}

function getSearchErrorMessage(error) {
  if (error?.name === "AbortError") {
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
