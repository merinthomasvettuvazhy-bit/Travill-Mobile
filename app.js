const map = L.map("map", {
  zoomControl: true,
  zoomSnap: 0.5,
  zoomDelta: 0.5,
  wheelPxPerZoomLevel: 90,
  wheelDebounceTime: 30,
  fadeAnimation: true,
  markerZoomAnimation: true,
  inertia: true,
  inertiaDeceleration: 3000,
  easeLinearity: 0.25,
  doubleClickZoom: true
}).setView([12.9716, 77.5946], 13);

/* =========================================
   MAP FIX
========================================= */

setTimeout(() => {
  map.invalidateSize();
}, 500);

/* =========================================
   LEAFLET INTERACTIVITY EXTRAS
   (scale control, live coordinate readout,
   hover cursor + click ripple on the map)
========================================= */

L.control.scale({
  position: "bottomleft",
  imperial: false,
  maxWidth: 120
}).addTo(map);

const coordsTooltip = document.createElement("div");
coordsTooltip.id = "mapCoordsTooltip";
coordsTooltip.style.display = "none";
document.body.appendChild(coordsTooltip);

map.on("mousemove", (e) => {

  coordsTooltip.style.display = "block";
  coordsTooltip.style.left = (e.originalEvent.clientX + 16) + "px";
  coordsTooltip.style.top = (e.originalEvent.clientY + 16) + "px";
  coordsTooltip.innerText =
    `${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`;

});

map.on("mouseout", () => {
  coordsTooltip.style.display = "none";
});

/* ---------- SHORT-LIVED RIPPLE WHERE THE USER TAPS THE MAP ---------- */

map.on("click", (e) => {

  const point = map.latLngToContainerPoint(e.latlng);

  const ripple = document.createElement("div");
  ripple.className = "mapClickRipple";
  ripple.style.left = point.x + "px";
  ripple.style.top = point.y + "px";

  const mapEl = document.getElementById("mapContainer");
  if(mapEl){
    mapEl.appendChild(ripple);
    setTimeout(() => ripple.remove(), 650);
  }

});

/* =========================================
   BASE MAP
========================================= */

/* =========================================
   MAP THEMES
========================================= */

const darkMapLayer =
L.tileLayer(

"https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",

{
  attribution:"© OpenStreetMap © CARTO",
  maxZoom:20
}

);

const lightMapLayer =
L.tileLayer(

"https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",

{
  attribution:"© OpenStreetMap",
  maxZoom:20
}

);

/* =========================================
   DEFAULT THEME
========================================= */

let darkMode = true;

darkMapLayer.addTo(map);

/* =========================================
   VARIABLES
========================================= */

let routeControl = null;

let userLat = null;
let userLng = null;

let selectedPlaceName = "";
let selectedLat = null;
let selectedLng = null;

let userMarker = null;
let destinationMarker = null;
let selectedDestinationAddress = "";

let navigationStarted = false;
let watchId = null;

let routeCoordinates = [];
let currentStepIndex = 0;

let weatherUpdateTimer = null;

let trafficLayer = null;
let trafficMonitoring = false;
const TOMTOM_API_KEY = "rx9GTkIOIuZ1Dq8D3TKwigfAQxqiDhSJ";

/* ---------- LIVE CONGESTION / AUTO-REROUTE STATE ----------
   window.lastTrafficRatio: currentSpeed / freeFlowSpeed for the road
   just ahead of the driver (1 = free flowing, close to 0 = jammed).
   Filled in by assessTrafficAhead() below and read by both the Smart
   Travel panel and calculateSmartETA so they reflect REAL congestion
   instead of just "is the traffic layer toggled on". ---------- */

window.lastTrafficRatio = null;

let lastRerouteTime = 0;
const REROUTE_COOLDOWN_MS = 120000; // don't reroute more than once every 2 minutes
const HEAVY_TRAFFIC_RATIO = 0.45;   // below this = treat as jammed
const MODERATE_TRAFFIC_RATIO = 0.7;

let nearbyMarkers = [];

window.routeSteps = [];

/* =========================================
   CAR AVATAR ICON (LEAFLET)
========================================= */

const CAR_SVG = `
<svg width="42" height="42" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="32" cy="54" rx="14" ry="4" fill="rgba(0,0,0,0.35)"></ellipse>
  <g class="carRotate" style="transform-origin:32px 32px;">
    <path d="M32 6 L48 24 L44 46 L20 46 L16 24 Z" fill="#38bdf8" stroke="#ffffff" stroke-width="2.5"></path>
    <rect x="23" y="24" width="18" height="14" rx="3" fill="#0f172a"></rect>
    <circle cx="24" cy="44" r="3.4" fill="#111827" stroke="#fff" stroke-width="1"></circle>
    <circle cx="40" cy="44" r="3.4" fill="#111827" stroke="#fff" stroke-width="1"></circle>
    <path d="M32 6 L38 16 L26 16 Z" fill="#e0f2fe"></path>
  </g>
</svg>`;

function createCarDivIcon(){

  return L.divIcon({

    className:"carDivIcon",

    html:`<div class="carMarkerWrap">${CAR_SVG}</div>`,

    iconSize:[42,42],
    iconAnchor:[21,21]

  });

}

/* ---------- ROTATE CAR TO FACE TRAVEL DIRECTION ---------- */

function rotateCarMarker(markerInstance, bearingDeg){

  if(!markerInstance) return;

  const el = markerInstance.getElement
  ? markerInstance.getElement()
  : null;

  if(!el) return;

  const rotateEl = el.querySelector(".carRotate") || el.querySelector(".carRotate3d");

  if(rotateEl){
    rotateEl.style.transform = `rotate(${bearingDeg}deg)`;
  }

}

/* ---------- SMALL BOUNCE FEEDBACK ON CLICK ---------- */

function bounceMarkerEl(el){

  if(!el) return;

  el.classList.remove("markerBounce");

  void el.offsetWidth; /* restart animation */

  el.classList.add("markerBounce");

}


/* =========================================
   LIVE TRACKING
========================================= */

let liveTrackingEnabled = false;

let trackingShareId =
Math.random()
.toString(36)
.substring(2,10);

let trackingUpdateInterval = null;

/* =========================================
   SEARCH DROPDOWN
========================================= */

const mainSearchBar =
document.getElementById("mainSearchBar");

const searchDropdown =
document.getElementById("searchDropdown");

mainSearchBar.onclick = () => {

  searchDropdown.style.display =
  searchDropdown.style.display === "block"
  ? "none"
  : "block";

};

/* =========================================
   LOCATION
========================================= */

/* =========================================
   LOCATION
========================================= */

/* ---------- SHARED INIT FOR WHATEVER LOCATION WE END UP WITH ----------
   Runs identically whether we got a real GPS fix or fell back to a
   default location, so weather/map/marker always come alive instead
   of the app silently sitting on placeholder text. ---------- */

function initUserLocation(lat, lng, { isFallback = false } = {}){

  userLat = lat;
  userLng = lng;

  /* ---------- DEFAULT START LOCATION ---------- */

  selectedStartLat = lat;
  selectedStartLng = lng;

  map.setView([lat, lng], 15);

  showWeather("current");

  /* =====================================
     START INPUT DEFAULT TEXT
  ===================================== */

  const startInput =
  document.getElementById("startInput");

  startInput.value =
  isFallback ? "Approximate Location" : "Current Location";

  /* =====================================
     ALLOW USER TO EDIT MANUALLY
  ===================================== */

  startInput.removeAttribute("readonly");

  startInput.addEventListener("focus", ()=>{

    if(
      startInput.value === "Current Location" ||
      startInput.value === "Approximate Location"
    ){

      startInput.select();

    }

  });

  /* =====================================
     USER MARKER
  ===================================== */

  const userIcon = createCarDivIcon();

  userMarker =
  L.marker(
    [lat,lng],
    {
      draggable:true,
      icon:userIcon
    }
  )
  .addTo(map)
  .bindPopup(
    isFallback
    ? "📍 Approximate location — drag to adjust"
    : "🚗 You are here"
  )
  .openPopup();

  /* ---------- CLICK BOUNCE ---------- */

  const userMarkerElInit = userMarker.getElement();

  if(userMarkerElInit){

    userMarkerElInit.addEventListener("click", ()=>{
      bounceMarkerEl(userMarkerElInit);
    });

  }

  /* =====================================
     DRAG USER MARKER
  ===================================== */

  userMarker.on("dragend", ()=>{

    const pos =
    userMarker.getLatLng();

    userLat = pos.lat;
    userLng = pos.lng;

    selectedStartLat = pos.lat;
    selectedStartLng = pos.lng;

    map.flyTo(
      [pos.lat,pos.lng],
      16
    );

    showWeather(
      "destination",
      pos.lat,
      pos.lng
    );

  });

}

/* ---------- DEFAULT FALLBACK COORDS ----------
   Used only if GPS permission is denied/unavailable, so the app
   still shows live weather/map/traffic instead of getting stuck
   on "Loading weather..." forever. ---------- */

const FALLBACK_LAT = 12.9716;
const FALLBACK_LNG = 77.5946;

navigator.geolocation.getCurrentPosition(

(position) => {

  const lat = position.coords.latitude;
  const lng = position.coords.longitude;

  initUserLocation(lat, lng);

},

(err)=>{

  console.log(err);

  /* ---------- FALL BACK INSTEAD OF DEAD-ENDING ----------
     Previously this just alerted and stopped, leaving userLat/
     userLng null forever — showWeather() bails out early on null
     coords, so the weather box stayed on its static placeholder
     text and never called the real API. Falling back to a default
     location keeps the app fully functional (live weather, map,
     traffic) even without GPS access, and the marker is draggable
     so the user can correct it to their real position. ---------- */

  alert(
    "Location access unavailable — showing an approximate " +
    "location. Drag the marker to set your real position."
  );

  initUserLocation(
    FALLBACK_LAT,
    FALLBACK_LNG,
    { isFallback: true }
  );

},

{
  enableHighAccuracy: true,
  timeout: 10000,
  maximumAge: 0
}

);

/* =========================================
   START LOCATION AUTOCOMPLETE
========================================= */

const startInput =
document.getElementById(
  "startInput"
);

startInput.addEventListener(
"input",
async ()=>{

  const query =
  startInput.value;

  /* ---------- IGNORE EMPTY ---------- */

  if(
    query.length < 2 ||
    query === "Current Location"
  ){

    return;

  }

  try{

    const response =
    await fetch(
`https://photon.komoot.io/api/?q=${query}`
    );

    const data =
    await response.json();

    /* ---------- CREATE DROPDOWN ---------- */

    let startSuggestions =
    document.getElementById(
      "startSuggestions"
    );

    if(!startSuggestions){

      startSuggestions =
      document.createElement("div");

      startSuggestions.id =
      "startSuggestions";

      startSuggestions.className =
      "suggestionsBox";

      startInput.parentNode.appendChild(
        startSuggestions
      );

    }

    startSuggestions.innerHTML = "";

    data.features
    .slice(0,5)
    .forEach(place=>{

      const div =
      document.createElement("div");

      div.className =
      "suggestionItem";

      div.innerText =
      (place.properties.name || "")
      + " "
      + (place.properties.city || "");

      div.onclick = ()=>{

        const lat =
        place.geometry.coordinates[1];

        const lng =
        place.geometry.coordinates[0];

        startInput.value =
        div.innerText;

        userLat = lat;
        userLng = lng;

        selectedStartLat = lat;
        selectedStartLng = lng;

        flyToLocation(
          lat,
          lng,
          16
        );

        if(userMarker){

          userMarker.setLatLng(
            [lat,lng]
          );

        }

        startSuggestions.innerHTML = "";

      };

      startSuggestions.appendChild(div);

    });

  }catch(e){

    console.log(e);

  }

});
/* =========================================
   NAVIGATION
========================================= */

document.getElementById(
  "goBtn"
).onclick = async ()=>{

  const destination =
  destinationInput.value;

  if(!destination){

    alert("Enter destination");
    return;

  }

  searchDropdown.style.display =
  "none";

  try{

    const res =
    await fetch(
`https://photon.komoot.io/api/?q=${destination}`
    );

    const data =
    await res.json();

    if(!data.features.length){

      alert("Destination not found");
      return;

    }

    const destLat =
    data.features[0]
    .geometry.coordinates[1];

    const destLng =
    data.features[0]
    .geometry.coordinates[0];

    selectedLat = destLat;
    selectedLng = destLng;

    if(!userLat || !userLng){

      alert("User location unavailable");
      return;

    }

await generateRoute(
  userLat,
  userLng,
  destLat,
  destLng
);

await createOrUpdateDestinationMarker(
  destLat,
  destLng,
  destination
);

    addMessage(
      "🧭 Route generated successfully",
      "bot"
    );

    speak(
      "Route generated successfully"
    );

  }catch(e){

    console.log(e);

    alert("Navigation failed");

  }

};

/* =========================================
   UNIVERSAL ROUTE GENERATOR
========================================= */

/* ---------- REQUEST GUARD ----------
   generateRoute() is called from several places (destination search,
   marker drag, live traffic reroute, etc). Because it's async, two
   calls can overlap: call A starts and awaits the OSRM fetch, and
   while it's waiting call B starts too. Each call only knew about the
   routeControl polyline that existed the moment IT started, so both
   would add a new polyline to the map — but only whichever call
   finished LAST ends up referenced by `routeControl`, so the other
   polyline is never removed. That's what caused multiple routes to
   appear on the Leaflet map at once. routeRequestSeq fixes this:
   every call gets a ticket number, and a call only draws its result
   if it's still the most recent one in flight; stale/late responses
   are discarded instead of being drawn. ---------- */

let routeRequestSeq = 0;

function drawRouteOnMap(routeData){

  window.routeSteps =
  routeData.routes[0]
  .legs[0]
  .steps;

  const coords =
  routeData.routes[0]
  .geometry.coordinates;

  const latlngs =
  coords.map(c=>[c[1],c[0]]);

  routeCoordinates =
  latlngs;

  /* ---------- REMOVE ANY EXISTING ROUTE RIGHT BEFORE DRAWING ----------
     Doing this here (immediately before the new polyline is added,
     rather than back when the request started) guarantees there is
     never a moment with two live route layers on the map. ---------- */

  if(routeControl){

    map.removeLayer(
      routeControl
    );

    routeControl = null;

  }

  routeControl =
  L.polyline(
    latlngs,
    {
      color:"#00E5FF",
      weight:6,
      opacity:0.95
    }
  ).addTo(map);

  map.fitBounds(
    routeControl.getBounds()
  );

  syncAdvancedMap();

}

async function generateRoute(
startLat,
startLng,
destLat,
destLng
){

  const requestId = ++routeRequestSeq;

  try{

    currentStepIndex = 0;

    const routeUrl =

`https://router.project-osrm.org/route/v1/driving/${startLng},${startLat};${destLng},${destLat}?overview=full&geometries=geojson&steps=true`;

    const routeRes =
    await fetch(routeUrl);

    const routeData =
    await routeRes.json();

    /* ---------- DISCARD IF A NEWER ROUTE REQUEST HAS SINCE STARTED ---------- */

    if(requestId !== routeRequestSeq){
      return;
    }

    if(
      !routeData.routes ||
      !routeData.routes.length
    ){

      alert("Route unavailable");
      return;

    }

    drawRouteOnMap(routeData);

    addMessage(
      "🧭 Route updated",
      "bot"
    );

  }catch(e){

    console.log(e);

  }
  startSmartTravelSystem();

}

/* =========================================
   CHATBOT
========================================= */

document
.getElementById("robotBtn")
.onclick = ()=>{

  const bot =
  document.getElementById(
    "chatbot"
  );

  bot.style.display =
  (bot.style.display === "flex")
  ? "none"
  : "flex";

};

document
.getElementById("closeChatBtn")
.onclick = ()=>{

  document
  .getElementById("chatbot")
  .style.display = "none";

};

document
.getElementById("sendBtn")
.onclick = sendMessage;

function sendMessage(){

  const input =
  document.getElementById(
    "chatInput"
  );

  const msg =
  input.value.trim();

  if(!msg) return;

  addMessage(msg,"user");

  input.value = "";

  handleBotCommand(msg);

}

async function handleBotCommand(msg){

  const text =
  msg.toLowerCase();

  addMessage(
    "🤖 Processing request...",
    "bot"
  );

  await new Promise(
    r=>setTimeout(r,500)
  );

  if(text.includes("weather")){

    showWeather("current");

    addMessage(
      "🌦 Showing weather",
      "bot"
    );

    return;

  }

  if(
    text.includes("go to")
    ||
    text.includes("navigate")
  ){

    const place =
    text
    .replace("go to","")
    .replace("navigate","")
    .trim();

    searchDestination(place);

    return;

  }

  if(text.includes("traffic")){

    document
    .getElementById("trafficBtn")
    .click();

    return;

  }

  if(
    text.includes("safety")
    ||
    text.includes("pulse")
  ){

    openSafety();

    return;

  }

  /* =========================================
   UI CONTROL COMMANDS
========================================= */

if (text.includes("dark mode")) {

  if (!darkMode) {
    darkBtn.click();
  }

  addMessage("🌙 Dark mode enabled", "bot");
  speak("Dark mode enabled");
  return;
}

if (text.includes("light mode")) {

  if (darkMode) {
    darkBtn.click();
  }

  addMessage("☀ Light mode enabled", "bot");
  speak("Light mode enabled");
  return;
}

if (text.includes("theme")) {

  darkBtn.click();

  addMessage("🎨 Theme toggled", "bot");
  speak("Theme changed");
  return;
}

if (text.includes("advance map on")) {

  if (!advanceMapEnabled) {
    advanceMapBtn.click();
  }

  addMessage("🗺 Advanced map enabled", "bot");
  speak("Advanced map enabled");
  return;
}

if (text.includes("advance map off")) {

  if (advanceMapEnabled) {
    advanceMapBtn.click();
  }

  addMessage("🗺 Advanced map disabled", "bot");
  speak("Advanced map disabled");
  return;
}

if (text.includes("share location") || 
text.includes("share live") || 
text.includes("share") || 
text.includes("share map") || text.includes("map share") || 
text.includes("share live location") ||
text.includes("share live traffic") ) {

  shareBtn.click();

  addMessage("📡 Sharing live location", "bot");
  speak("Sharing live location");
  return;
}

  addMessage(
`🤖 Try:
• weather
• traffic
• PulseX
• dark mode
• light mode
• theme
• advance map on
• advance map off
• share location`,
"bot");

}

function addMessage(text,type){

  const div =
  document.createElement("div");

  div.className =
  "message " + type;

  div.innerText = text;

  const chat =
  document.getElementById(
    "chatMessages"
  );

  chat.appendChild(div);

  chat.scrollTop =
  chat.scrollHeight;

}

/* =========================================
   DESTINATION SEARCH
========================================= */

async function searchDestination(place){

  try{

    const url =
`https://photon.komoot.io/api/?q=${place}`;

    const res =
    await fetch(url);

    const data =
    await res.json();

    if(!data.features.length){

      addMessage(
        "❌ Not found",
        "bot"
      );

      return;

    }

    const lat =
    data.features[0]
    .geometry.coordinates[1];

    const lng =
    data.features[0]
    .geometry.coordinates[0];
 
flyToLocation(lat, lng, 15);

    if(destinationMarker){

      map.removeLayer(
        destinationMarker
      );

    }

    destinationMarker =
    L.marker([lat,lng])
    .addTo(map)
    .bindPopup(place)
    .openPopup();
     
    syncAdvancedMap();

  }catch(e){

    console.log(e);

  }

}

/* =========================================
   DESTINATION MARKER SYSTEM
========================================= */

async function createOrUpdateDestinationMarker(
lat,
lng,
address = "Destination"
){

  selectedLat = lat;
  selectedLng = lng;

  selectedDestinationAddress =
  address;

  /* ---------- REMOVE OLD ---------- */

  if(destinationMarker){

    map.removeLayer(
      destinationMarker
    );

  }

  /* ---------- LEAFLET MARKER ---------- */

  destinationMarker =
  L.marker(
    [lat,lng],
    {
      draggable:true
    }
  )
  .addTo(map)
  .bindPopup(
    `📍 ${address}`
  )
  .openPopup();

  /* ---------- UPDATE INPUT ---------- */

  document
  .getElementById(
    "destinationInput"
  ).value = address;

  /* ---------- DRAGGING ---------- */

  destinationMarker.on(
    "dragend",
    async ()=>{

      const pos =
      destinationMarker.getLatLng();

      selectedLat = pos.lat;
      selectedLng = pos.lng;

      const placeName =
      await reverseGeocode(
        pos.lat,
        pos.lng
      );

      document
      .getElementById(
        "destinationInput"
      ).value = placeName;

      destinationMarker
      .bindPopup(
        `📍 ${placeName}`
      )
      .openPopup();

      syncAdvancedMap();

      if(userLat && userLng){

        generateRoute(
          userLat,
          userLng,
          pos.lat,
          pos.lng
        );

      }

    }
  );

  syncAdvancedMap();

}

/* =========================================
   REVERSE GEOCODING
========================================= */

async function reverseGeocode(
lat,
lng
){

  try{

    const url =

`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`;

    const res =
    await fetch(url);

    const data =
    await res.json();

    return (
      data.display_name
      || "Selected Destination"
    );

  }catch(e){

    console.log(e);

    return "Selected Destination";

  }

}

/* =========================================
   WEATHER SYSTEM
========================================= */

/* ---------- WMO WEATHER-CODE DECODER ----------
   Open-Meteo's "current" payload only returns a numeric weather_code
   (the WMO code), not a text description. The old code fetched that
   field but never used it — the topBar/panel text only ever showed
   temperature, wind and humidity, so it never contained a word like
   "rain". That's why Smart Travel's weather box always said CLEAR
   even while it was raining: convertWeatherToSmartLabel() looks for
   keywords like "rain" in the text, and that keyword never appeared
   anywhere. Decoding the code fixes it at the source. ---------- */

function wmoWeatherInfo(code){

  const table = {
    0:  { text:"Clear sky",              icon:"☀️" },
    1:  { text:"Mainly clear",           icon:"🌤" },
    2:  { text:"Partly cloudy",          icon:"⛅" },
    3:  { text:"Overcast",               icon:"☁️" },
    45: { text:"Fog",                    icon:"🌫" },
    48: { text:"Rime fog",               icon:"🌫" },
    51: { text:"Light drizzle",          icon:"🌦" },
    53: { text:"Moderate drizzle",       icon:"🌦" },
    55: { text:"Dense drizzle",          icon:"🌦" },
    56: { text:"Light freezing drizzle", icon:"🌧" },
    57: { text:"Dense freezing drizzle", icon:"🌧" },
    61: { text:"Slight rain",            icon:"🌧" },
    63: { text:"Moderate rain",          icon:"🌧" },
    65: { text:"Heavy rain",             icon:"🌧" },
    66: { text:"Light freezing rain",    icon:"🌧" },
    67: { text:"Heavy freezing rain",    icon:"🌧" },
    71: { text:"Slight snow",            icon:"🌨" },
    73: { text:"Moderate snow",          icon:"🌨" },
    75: { text:"Heavy snow",             icon:"❄️" },
    77: { text:"Snow grains",            icon:"❄️" },
    80: { text:"Slight rain showers",    icon:"🌦" },
    81: { text:"Moderate rain showers",  icon:"🌧" },
    82: { text:"Violent rain showers",   icon:"⛈" },
    85: { text:"Slight snow showers",    icon:"🌨" },
    86: { text:"Heavy snow showers",     icon:"❄️" },
    95: { text:"Thunderstorm",           icon:"⛈" },
    96: { text:"Thunderstorm w/ hail",   icon:"⛈" },
    99: { text:"Thunderstorm w/ hail",   icon:"⛈" }
  };

  return table[code] || { text:"Clear sky", icon:"☀️" };

}

/* ---------- REQUEST GUARD ----------
   showWeather() gets called from several places that can overlap —
   on load, on marker drag, on the 5-minute nav timer, on the Weather
   button, from chat commands. Because it's async, an OLDER call can
   finish AFTER a newer one (e.g. a slow network round trip), and
   without a guard whichever response lands last just overwrites the
   DOM — even if it's stale. That's what caused two different
   temperatures to appear to "flicker" on screen. weatherRequestSeq
   fixes this exactly the way routeRequestSeq does for routes: every
   call gets a ticket, and a call only writes its result if it's
   still the most recently started one; late/stale responses are
   discarded instead of being shown. ---------- */

let weatherRequestSeq = 0;

async function showWeather(
type="current",
lat=null,
lng=null
){

  const requestId = ++weatherRequestSeq;

  try{

    if(type === "current"){

      lat = userLat;
      lng = userLng;

    }

    if(!lat || !lng) return;

    /* ---------- DON'T FLASH "LOADING" IF A NEWER CALL ALREADY STARTED ---------- */

    if(requestId !== weatherRequestSeq) return;

    document
    .getElementById("weather")
    .innerText =
    "🌦 Loading...";

    const url =
`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m`;

    const res =
    await fetch(url);

    const data =
    await res.json();

    /* ---------- DISCARD IF A NEWER WEATHER REQUEST HAS SINCE STARTED ---------- */

    if(requestId !== weatherRequestSeq) return;

    const temp =
    data.current.temperature_2m;

    const wind =
    data.current.wind_speed_10m;

    const humidity =
    data.current.relative_humidity_2m;

    const weatherCode =
    data.current.weather_code;

    const condition =
    wmoWeatherInfo(weatherCode);

    /* ---------- STORE THE ACTUAL CONDITION FOR OTHER CODE TO READ ----------
       Reading DOM innerText back out (as the Smart Travel panel does)
       is fragile, so keep a clean copy of the current condition too. */

    window.currentWeatherCondition = condition.text;
    window.currentWeatherCode = weatherCode;

    document
    .getElementById("weather")
    .innerText =
`${condition.icon} ${condition.text} | 🌡 ${temp}°C | 💨 ${wind} km/h | 💧 ${humidity}%`;

  }catch(e){

    console.log(e);

    /* ---------- DON'T STOMP A NEWER SUCCESSFUL RESULT WITH A LATE ERROR ---------- */

    if(requestId !== weatherRequestSeq) return;

    window.currentWeatherCondition = null;

    document
    .getElementById("weather")
    .innerText =
    "❌ Weather unavailable";

  }

}

/* =========================================
   DARK MODE SYSTEM
========================================= */

const weatherContainer =
document.getElementById("weather");

/* ---------- CREATE BUTTON ---------- */

const darkBtn =
document.createElement("button");

darkBtn.id = "darkModeBtn";

darkBtn.innerHTML =
"🌙 Dark Mode";

/* ---------- INSERT LEFT OF WEATHER ---------- */

weatherContainer.parentNode.insertBefore(
  darkBtn,
  weatherContainer
);

/* =========================================
   APPLY THEME
========================================= */

function applyTheme(){

  /* ---------- DARK MODE ---------- */

  if(darkMode){

    if(map.hasLayer(lightMapLayer)){

      map.removeLayer(
        lightMapLayer
      );

    }

    darkMapLayer.addTo(map);

    darkBtn.innerHTML =
    "🌙 Dark Mode";

    document.body.classList.add(
      "darkTheme"
    );

  }

  /* ---------- LIGHT MODE ---------- */

  else{

    if(map.hasLayer(darkMapLayer)){

      map.removeLayer(
        darkMapLayer
      );

    }

    lightMapLayer.addTo(map);

    darkBtn.innerHTML =
    "☀ Light Mode";

    document.body.classList.remove(
      "darkTheme"
    );

  }

  /* ---------- KEEP TRAFFIC ABOVE MAP ---------- */

  if(trafficMonitoring && trafficLayer){

    trafficLayer.bringToFront();

  }

  /* ---------- SAVE ---------- */

  localStorage.setItem(
    "travelnova_darkmode",
    darkMode
  );

}

/* =========================================
   BUTTON CLICK
========================================= */

darkBtn.onclick = ()=>{

  darkMode = !darkMode;

  applyTheme();

};

/* =========================================
   LOAD SAVED THEME
========================================= */

const savedTheme =
localStorage.getItem(
  "travelnova_darkmode"
);

if(savedTheme !== null){

  darkMode =
  savedTheme === "true";

}

applyTheme();

/* =========================================
   ADVANCE MAP BUTTON (FIXED STABLE VERSION)
========================================= */

let advanceMapEnabled = false;
let mapLibreMap = null;

const mapContainer = document.getElementById("map");
const mapLibreContainer = document.getElementById("maplibre");

/* =========================================
   UNIVERSAL MAP HELPERS
========================================= */

function flyToLocation(lat, lng, zoom = 15) {

  if (advanceMapEnabled && mapLibreMap) {
    mapLibreMap.flyTo({
      center: [lng, lat],
      zoom: zoom
    });
  } else {
    map.flyTo([lat, lng], zoom);
  }
}

function setMapCenter(lat, lng, zoom = 15) {

  if (advanceMapEnabled && mapLibreMap) {
    mapLibreMap.setCenter([lng, lat]);
    mapLibreMap.setZoom(zoom);
  } else {
    map.setView([lat, lng], zoom);
  }
}

/* =========================================
   3D "DRIVE MODE" CHASE CAMERA
   Follows the user with a tilted, bearing-locked
   view during turn-by-turn navigation.
========================================= */

function bearingBetween(lat1, lng1, lat2, lng2){

  const toRad = d => d * Math.PI / 180;
  const toDeg = r => r * 180 / Math.PI;

  const y = Math.sin(toRad(lng2 - lng1)) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lng2 - lng1));

  return (toDeg(Math.atan2(y, x)) + 360) % 360;

}

function driveCameraTo(lat, lng, prevLat, prevLng){

  const camera = {
    center: [lng, lat],
    zoom: 18.5,
    pitch: 62,
    duration: 900,
    essential: true
  };

  if(prevLat != null && prevLng != null){

    const dist = mapLibreMap
      ? Math.hypot(lat - prevLat, lng - prevLng)
      : 0;

    if(dist > 0.000005){

      const heading = bearingBetween(prevLat, prevLng, lat, lng);

      camera.bearing = heading;

      if(window.advancedUserMarker){
        rotateCarMarker(window.advancedUserMarker, heading);
      }

    }

  }

  mapLibreMap.easeTo(camera);

}

/* =========================================
   BUTTON
========================================= */

const advanceMapBtn = document.createElement("button");
advanceMapBtn.id = "advanceMapBtn";
advanceMapBtn.innerHTML = "🗺 Advance Map";

darkBtn.insertAdjacentElement("afterend", advanceMapBtn);

/* =========================================
   LIVE TRACKING SHARE BUTTON
========================================= */

const shareBtn = document.getElementById("nearbyBtn");

shareBtn.onclick = () => {

  if (!userLat || !userLng) {
    alert("Location unavailable");
    return;
  }

  startLiveTracking();
};

/* =========================================
   INIT MAPLIBRE (SAFE CREATOR)
========================================= */

/* =========================================
   INIT MAPLIBRE
========================================= */

function initMapLibre() {

  if (mapLibreMap) return;

  mapLibreMap = new maplibregl.Map({

    container: "maplibre",

    style:
STREETS_3D_STYLE,

    center: [
      userLng || 77.5946,
      userLat || 12.9716
    ],

    zoom: 15,
    pitch: 45,
    bearing: 0,
    antialias: true

  });

  mapLibreMap.addControl(
    new maplibregl.NavigationControl({ visualizePitch: true }),
    "bottom-right"
  );

  mapLibreMap.on(
    "load",
    ()=>{

      addSkyAndFog();
      enable3DBuildings();
      renderAdvancedMapLayers();
      setup3dMapControls();

      /* =====================================
         CLICK ADVANCED MAP
      ===================================== */

      mapLibreMap.on(
        "click",
        async (e)=>{

          const lat =
          e.lngLat.lat;

          const lng =
          e.lngLat.lng;

          const placeName =
          await reverseGeocode(
            lat,
            lng
          );

          await createOrUpdateDestinationMarker(
            lat,
            lng,
            placeName
          );

          if(userLat && userLng){

            await generateRoute(
              userLat,
              userLng,
              lat,
              lng
            );

          }

        }
      );

      mapLibreMap.on("rotate", updateCompassIcon);

    }
  );

  /* re-attach 3D layers whenever the style finishes (re)loading,
     e.g. after switching to satellite and back */
  mapLibreMap.on("style.load", ()=>{
    addSkyAndFog();
    enable3DBuildings();
    renderAdvancedMapLayers();
  });

}

/* =========================================
   3D MAP STYLE URLS
========================================= */

const STREETS_3D_STYLE =
"https://api.maptiler.com/maps/019e1b06-64f2-7466-9694-5ae9ce6dc189/style.json?key=xtGVoTN4yqyQpzLrWjNt";

const SATELLITE_3D_STYLE =
"https://api.maptiler.com/maps/hybrid/style.json?key=xtGVoTN4yqyQpzLrWjNt";

let satelliteModeOn = false;

/* =========================================
   SKY / ATMOSPHERE
========================================= */

function addSkyAndFog(){

  if(!mapLibreMap) return;

  try{

    if(!mapLibreMap.getLayer("sky-layer")){

      mapLibreMap.addLayer({
        id: "sky-layer",
        type: "sky",
        paint: {
          "sky-type": "atmosphere",
          "sky-atmosphere-sun-intensity": 8,
          "sky-atmosphere-color": "rgba(56,189,248,0.6)",
          "sky-atmosphere-halo-color": "rgba(139,92,246,0.4)"
        }
      });

    }

  }catch(err){
    console.log("Sky layer unavailable", err);
  }

}

/* =========================================
   3D BUILDING EXTRUSIONS
========================================= */

function enable3DBuildings(){

  if(!mapLibreMap) return;

  try{

    const style = mapLibreMap.getStyle();
    if(!style || !style.layers) return;

    const buildingSourceLayer = style.layers.find(l =>
      l["source-layer"] === "building" &&
      (l.type === "fill" || l.type === "fill-extrusion")
    );

    if(!buildingSourceLayer) return;

    if(mapLibreMap.getLayer("3d-buildings")) return;

    mapLibreMap.addLayer({
      id: "3d-buildings",
      source: buildingSourceLayer.source,
      "source-layer": "building",
      type: "fill-extrusion",
      minzoom: 13,
      paint: {
        "fill-extrusion-color": [
          "interpolate", ["linear"], ["zoom"],
          13, "#1e293b",
          18, "#38bdf8"
        ],
        "fill-extrusion-height": [
          "interpolate", ["linear"], ["zoom"],
          13, 0,
          16, ["coalesce", ["get", "render_height"], ["get", "height"], 12]
        ],
        "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
        "fill-extrusion-opacity": 0.75
      }
    });

  }catch(err){
    console.log("3D buildings unavailable for this style", err);
  }

}

/* =========================================
   3D MAP UI CONTROLS (tilt / compass / satellite)
========================================= */

let tiltLevel = 1; // 0 = flat, 1 = 45deg, 2 = 60deg
const TILT_STEPS = [0, 45, 65];

function setup3dMapControls(){

  const tiltBtn = document.getElementById("tiltBtn");
  const compassBtn = document.getElementById("compassBtn");
  const satelliteBtn = document.getElementById("satelliteBtn");

  if(tiltBtn && !tiltBtn.dataset.bound){

    tiltBtn.dataset.bound = "1";

    tiltBtn.addEventListener("click", ()=>{

      tiltLevel = (tiltLevel + 1) % TILT_STEPS.length;

      mapLibreMap.easeTo({
        pitch: TILT_STEPS[tiltLevel],
        duration: 700
      });

      tiltBtn.classList.toggle("active", TILT_STEPS[tiltLevel] > 0);

    });

  }

  if(compassBtn && !compassBtn.dataset.bound){

    compassBtn.dataset.bound = "1";

    compassBtn.addEventListener("click", ()=>{

      mapLibreMap.easeTo({
        bearing: 0,
        duration: 600
      });

    });

  }

  if(satelliteBtn && !satelliteBtn.dataset.bound){

    satelliteBtn.dataset.bound = "1";

    satelliteBtn.addEventListener("click", ()=>{

      satelliteModeOn = !satelliteModeOn;

      satelliteBtn.classList.toggle("active", satelliteModeOn);

      mapLibreMap.setStyle(
        satelliteModeOn ? SATELLITE_3D_STYLE : STREETS_3D_STYLE
      );

    });

  }

}

function updateCompassIcon(){

  const icon = document.getElementById("compassIcon");
  if(!icon || !mapLibreMap) return;

  const bearing = mapLibreMap.getBearing();
  icon.style.transform = `rotate(${-bearing}deg)`;

}

/* =========================================
   RENDER MARKERS + ROUTE
========================================= */

/* =========================================
   RENDER MARKERS + ROUTE (FIXED)
========================================= */

function renderAdvancedMapLayers() {

  if (!mapLibreMap) return;

  /* =====================================
     REMOVE OLD DESTINATION MARKER
  ===================================== */

  if (window.advancedDestinationMarker) {

    window.advancedDestinationMarker.remove();

  }

  /* =====================================
     USER MARKER (CAR AVATAR - PERSISTENT,
     GLIDES SMOOTHLY BETWEEN POSITION UPDATES
     INSTEAD OF BEING RECREATED EACH TIME)
  ===================================== */

  if (userLat && userLng) {

    if (!window.advancedUserMarker) {

      const userEl = document.createElement("div");
      userEl.className = "carMarker3dWrap";
      userEl.innerHTML =
        '<div class="carRotate3d" style="transform-origin:center;">' +
        CAR_SVG +
        '</div>';

      window.advancedUserMarker =
      new maplibregl.Marker({
        element: userEl,
        anchor: "center"
      })
      .setLngLat([userLng, userLat])
      .addTo(mapLibreMap);

      window.advancedUserMarker.getElement().addEventListener("click", ()=>{
        bounceMarkerEl(window.advancedUserMarker.getElement());
      });

    } else {

      /* just glide the existing marker to the new spot */
      window.advancedUserMarker.setLngLat([userLng, userLat]);

    }

  }

  /* =====================================
     DESTINATION MARKER
  ===================================== */

  if (selectedLat && selectedLng) {

    const pinEl = document.createElement("div");
    pinEl.className = "dropPinWrap";
    pinEl.innerHTML =
      '<div class="pinBody"></div>' +
      '<div class="pinShadow"></div>';

    window.advancedDestinationMarker =
new maplibregl.Marker({
  element: pinEl,
  anchor: "bottom",
  draggable:true
})
.setLngLat([
  selectedLng,
  selectedLat
])
.addTo(mapLibreMap);

/* ---------- DRAGGING ---------- */

window.advancedDestinationMarker.on(
  "dragend",
  async ()=>{

    const lngLat =
    window
    .advancedDestinationMarker
    .getLngLat();

    selectedLat =
    lngLat.lat;

    selectedLng =
    lngLat.lng;

    const placeName =
    await reverseGeocode(
      lngLat.lat,
      lngLat.lng
    );

    await createOrUpdateDestinationMarker(
      lngLat.lat,
      lngLat.lng,
      placeName
    );

    if(userLat && userLng){

      await generateRoute(
        userLat,
        userLng,
        lngLat.lat,
        lngLat.lng
      );

    }

  }
);

  }

  /* =====================================
     ROUTE
  ===================================== */

  if (routeCoordinates.length) {

    const geojson = {

      type: "Feature",

      geometry: {

        type: "LineString",

        coordinates:
        routeCoordinates.map(c => [
          c[1],
          c[0]
        ])

      }

    };

    /* ---------- CREATE SOURCE ---------- */

    if (!mapLibreMap.getSource("route")) {

      mapLibreMap.addSource("route", {

        type: "geojson",
        data: geojson

      });

      /* soft outer glow */
      mapLibreMap.addLayer({
        id: "route-glow",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#00E5FF",
          "line-width": 16,
          "line-blur": 8,
          "line-opacity": 0.35
        }
      });

      /* solid base line */
      mapLibreMap.addLayer({

        id: "route",

        type: "line",

        source: "route",

        layout: { "line-cap": "round", "line-join": "round" },

        paint: {

          "line-color": "#0ea5e9",
          "line-width": 6

        }

      });

      /* animated flowing dashes on top */
      mapLibreMap.addLayer({
        id: "route-flow",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#ffffff",
          "line-width": 3,
          "line-opacity": 0.9,
          "line-dasharray": [0, 4, 3]
        }
      });

      animateRouteFlow();

    }

    /* ---------- UPDATE ROUTE ---------- */

    else {

      mapLibreMap
      .getSource("route")
      .setData(geojson);

    }

  }

}

/* =========================================
   ANIMATED ROUTE "FLOW" EFFECT
========================================= */

let routeFlowFrame = null;

function animateRouteFlow(){

  if(routeFlowFrame) return; // already running

  const dashSequences = [
    [0, 4, 3],
    [0.5, 4, 2.5],
    [1, 4, 2],
    [1.5, 4, 1.5],
    [2, 4, 1],
    [2.5, 4, 0.5],
    [3, 4, 0],
    [0, 0.5, 3, 3.5]
  ];

  let step = 0;

  function frame(){

    if(!mapLibreMap || !mapLibreMap.getLayer("route-flow")){
      routeFlowFrame = null;
      return;
    }

    step = (step + 1) % dashSequences.length;

    try{
      mapLibreMap.setPaintProperty(
        "route-flow",
        "line-dasharray",
        dashSequences[step]
      );
    }catch(err){ /* layer may have been removed mid-animation */ }

    routeFlowFrame = setTimeout(
      () => requestAnimationFrame(frame),
      80
    );

  }

  requestAnimationFrame(frame);

}

/* =========================================
   TOGGLE BUTTON LOGIC (FIXED)
========================================= */

advanceMapBtn.onclick = () => {

  advanceMapEnabled = !advanceMapEnabled;

  /* ================= ENABLE ================= */
  if (advanceMapEnabled) {

    mapContainer.style.display = "none";
    mapLibreContainer.style.display = "block";

    initMapLibre();

    setTimeout(() => {
      mapLibreMap.resize();
    }, 200);

    if (userLat && userLng) {
      mapLibreMap.flyTo({
        center: [userLng, userLat],
        zoom: 16
      });
    }

    renderAdvancedMapLayers();

    advanceMapBtn.innerHTML = "🚀 Advanced ON";

    const controls3d = document.getElementById("mapControls3d");
    if(controls3d) controls3d.classList.add("visible");

    addMessage("🗺 Advanced 3D map enabled", "bot");
    speak("Advanced map enabled");
  }

  /* ================= DISABLE ================= */
  else {

    mapLibreContainer.style.display = "none";
    mapContainer.style.display = "block";

    setTimeout(() => {
      map.invalidateSize();
    }, 200);

    advanceMapBtn.innerHTML = "🗺 Advance Map";

    const controls3d = document.getElementById("mapControls3d");
    if(controls3d) controls3d.classList.remove("visible");

    addMessage("🗺 Advanced map disabled", "bot");
    speak("Advanced map disabled");
  }
};

/* =========================================
   SYNC FUNCTION (UPDATED SAFE VERSION)
========================================= */

function syncAdvancedMap() {

  if (!advanceMapEnabled || !mapLibreMap) return;

  renderAdvancedMapLayers();

  if (userLat && userLng) {
    mapLibreMap.flyTo({
      center: [userLng, userLat],
      zoom: 16
    });
  }
}
/* =========================================
   SAFETY
========================================= */

function openSafety(){

  window.open(
"https://merinthomasvettuvazhy-bit.github.io/PulseX/",
"_blank"
  );

}

/* =========================================
   TRAFFIC SYSTEM
========================================= */
/* =========================================
   ULTRA LIVE TRAFFIC SYSTEM
========================================= */

let trafficIncidentMarkers = [];
let trafficRefreshInterval = null;

/* =========================================
   TRAFFIC BUTTON
========================================= */

document
.getElementById("trafficBtn")
.onclick = async ()=>{

  /* =====================================
     DISABLE TRAFFIC
  ===================================== */

  if(trafficMonitoring){

    trafficMonitoring = false;

    /* ---------- REMOVE FLOW LAYER ---------- */

    if(trafficLayer){

      map.removeLayer(trafficLayer);
      trafficLayer = null;

    }

    /* ---------- REMOVE INCIDENTS ---------- */

    trafficIncidentMarkers.forEach(marker=>{

      map.removeLayer(marker);

    });

    trafficIncidentMarkers = [];

    /* ---------- STOP AUTO REFRESH ---------- */

    if(trafficRefreshInterval){

      clearInterval(
        trafficRefreshInterval
      );

    }

    addMessage(
      "🚦 Live traffic disabled",
      "bot"
    );

    speak(
      "Live traffic disabled"
    );

    return;

  }

  /* =====================================
     ENABLE TRAFFIC
  ===================================== */

  trafficMonitoring = true;

  /* ---------- LIVE FLOW LAYER ---------- */

  trafficLayer =
  L.tileLayer(

`https://api.tomtom.com/traffic/map/4/tile/flow/relative0/{z}/{x}/{y}.png?tileSize=256&style=relative&key=${TOMTOM_API_KEY}`,

    {
      tileSize:256,
      opacity:0.95,
      attribution:"© TomTom Traffic",
      zIndex:999
    }

  ).addTo(map);

  /* ---------- LOAD INCIDENTS ---------- */

  await loadLiveTrafficIncidents();

  /* ---------- AUTO REFRESH ---------- */

  trafficRefreshInterval =
  setInterval(()=>{

    if(trafficMonitoring){

      loadLiveTrafficIncidents();

    }

  },60000);

  addMessage(
    "🚦 Ultra live traffic enabled",
    "bot"
  );

  speak(
    "Ultra live traffic enabled"
  );

};

/* =========================================
   LOAD LIVE INCIDENTS
========================================= */

async function loadLiveTrafficIncidents(){

  try{

    /* ---------- CLEAR OLD INCIDENTS ---------- */

    trafficIncidentMarkers.forEach(marker=>{

      map.removeLayer(marker);

    });

    trafficIncidentMarkers = [];

    /* ---------- GET MAP BOUNDS ---------- */

    const bounds =
    map.getBounds();

    const bbox =
`${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`;

    /* ---------- INCIDENT API ---------- */

    const incidentUrl =

`https://api.tomtom.com/traffic/services/5/incidentDetails?bbox=${bbox}&fields={incidents{type,geometry{type,coordinates},properties{iconCategory,magnitudeOfDelay,events{description},startTime,endTime}}}&language=en-GB&t=1111&key=${TOMTOM_API_KEY}`;

    const response =
    await fetch(incidentUrl);

    const data =
    await response.json();

    if(
      !data.incidents ||
      !data.incidents.length
    ){

      addMessage(
        "✅ No traffic incidents nearby",
        "bot"
      );

      return;

    }

    /* ---------- CREATE INCIDENTS ---------- */

    data.incidents.forEach(incident=>{

      try{

        const coords =
        incident.geometry.coordinates;

        if(!coords || !coords.length)
        return;

        const lng =
        coords[0][0];

        const lat =
        coords[0][1];

        const description =
        incident.properties
        ?.events?.[0]
        ?.description
        || "Traffic alert";

        const delay =
        incident.properties
        ?.magnitudeOfDelay || 0;

        /* =====================================
           NEON STYLING
        ===================================== */

        let bgColor = "#00E5FF";
        let pulseColor = "#00E5FF";
        let trafficLabel = "LIVE";

        const lowerDesc =
        description.toLowerCase();

        /* ---------- ROAD CLOSED ---------- */

        if(
          lowerDesc.includes("closed")
        ){

          bgColor = "#ff1744";
          pulseColor = "#ff1744";
          trafficLabel = "CLOSED";

        }

        /* ---------- ACCIDENT ---------- */

        else if(
          lowerDesc.includes("accident")
        ){

          bgColor = "#ff3d00";
          pulseColor = "#ff3d00";
          trafficLabel = "CRASH";

        }

        /* ---------- CONSTRUCTION ---------- */

        else if(
          lowerDesc.includes("construction")
        ){

          bgColor = "#FFD600";
          pulseColor = "#FFD600";
          trafficLabel = "WORK";

        }

        /* ---------- JAM ---------- */

        else if(
          lowerDesc.includes("jam")
        ){

          bgColor = "#ff9100";
          pulseColor = "#ff9100";
          trafficLabel = "JAM";

        }

        /* ---------- DELAY LEVEL ---------- */

        if(delay >= 3){

          bgColor = "#ff1744";
          pulseColor = "#ff1744";

        }

        /* =====================================
           MODERN DIV ICON
        ===================================== */

        const trafficIcon =
        L.divIcon({

          className:
          "modernTrafficMarker",

          html:`

          <div
          class="trafficPulse"
          style="
            --pulse:${pulseColor};
          ">
          </div>

          <div
          class="trafficCore"
          style="
            background:${bgColor};

            box-shadow:
            0 0 15px ${pulseColor},
            0 0 30px ${pulseColor},
            0 0 60px ${pulseColor};
          ">

            <div class="trafficDot"></div>

            <span class="trafficText">
              ${trafficLabel}
            </span>

          </div>

          `,

          iconSize:[90,90],
          iconAnchor:[45,45]

        });

        /* =====================================
           CREATE MARKER
        ===================================== */

        const marker =
        L.marker(
          [lat,lng],
          {
            icon:trafficIcon
          }
        )
        .addTo(map)
        .bindPopup(

`
<div class="trafficPopup">

  <div class="trafficPopupTitle">
    ${trafficLabel}
  </div>

  <div class="trafficPopupDesc">
    ${description}
  </div>

  <div class="trafficPopupDelay">
    Delay Level:
    ${delay}
  </div>

</div>
`

        );

        trafficIncidentMarkers.push(
          marker
        );

      }catch(e){

        console.log(
          "Marker error:",
          e
        );

      }

    });

  }catch(e){

    console.log(
      "Traffic API Error:",
      e
    );

    addMessage(
      "❌ Traffic service unavailable",
      "bot"
    );

  }

}

/* =========================================
   REAL-TIME CONGESTION CHECK + AUTO REROUTE
   ("change the route if traffic is high nearby")
========================================= */

/* ---------- ROAD SPEED AT A SINGLE POINT ----------
   TomTom's Flow Segment Data API returns the current measured speed
   on the road segment at a point, plus the "free flow" speed (what
   that road normally allows). currentSpeed / freeFlowSpeed close to 1
   means traffic is moving normally; close to 0 means it's jammed. */

async function getFlowSegmentData(lat, lng){

  try{

    const url =
`https://api.tomtom.com/traffic/services/4/flowSegmentData/relative0/10/json?point=${lat},${lng}&key=${TOMTOM_API_KEY}`;

    const res = await fetch(url);
    const data = await res.json();

    const seg = data?.flowSegmentData;

    if(
      !seg ||
      !seg.freeFlowSpeed ||
      seg.currentSpeed == null
    ){
      return null;
    }

    return {
      currentSpeed: seg.currentSpeed,
      freeFlowSpeed: seg.freeFlowSpeed,
      ratio: seg.currentSpeed / seg.freeFlowSpeed
    };

  }catch(e){

    console.log("Flow segment error:", e);
    return null;

  }

}

/* ---------- SAMPLE A FEW POINTS ALONG A ROUTE, AHEAD OF THE DRIVER ----------
   Walks forward along `coords` from the point nearest (lat,lng),
   picking up to `maxPoints` points spread out over the next
   `aheadMeters` of road so we're checking the road the driver is
   ABOUT to be on, not the road behind them. */

function sampleRouteAheadPoints(coords, lat, lng, aheadMeters = 3000, maxPoints = 4){

  if(!coords || coords.length < 2) return [];

  /* ---------- FIND NEAREST INDEX ---------- */

  let nearestIdx = 0;
  let nearestDist = Infinity;

  for(let i = 0; i < coords.length; i++){

    const d = map.distance([lat, lng], coords[i]);

    if(d < nearestDist){
      nearestDist = d;
      nearestIdx = i;
    }

  }

  /* ---------- WALK FORWARD, ACCUMULATING DISTANCE ---------- */

  const samples = [];
  let accumulated = 0;

  for(let i = nearestIdx; i < coords.length - 1 && samples.length < maxPoints; i++){

    accumulated += map.distance(coords[i], coords[i + 1]);

    if(accumulated >= (samples.length + 1) * (aheadMeters / maxPoints)){
      samples.push(coords[i + 1]);
    }

  }

  return samples;

}

/* ---------- AVERAGE CONGESTION RATIO JUST AHEAD OF THE DRIVER ---------- */

async function assessTrafficAhead(lat, lng){

  const points = sampleRouteAheadPoints(routeCoordinates, lat, lng);

  if(!points.length) return null;

  const results = await Promise.all(
    points.map(p => getFlowSegmentData(p[0], p[1]))
  );

  const valid = results.filter(r => r !== null);

  if(!valid.length) return null;

  const avgRatio =
    valid.reduce((sum, r) => sum + r.ratio, 0) / valid.length;

  return avgRatio;

}

/* ---------- CHECK CONGESTION AND SWITCH ROUTE IF IT'S BAD ----------
   Called periodically while navigating with live traffic enabled.
   If the road just ahead is badly congested, ask OSRM for alternative
   routes and switch to whichever alternative actually takes a
   different road (a same-road "alternative" wouldn't dodge the jam).
   A cooldown stops this from re-triggering every few seconds. */

async function maybeRerouteForTraffic(lat, lng){

  if(!trafficMonitoring) return;
  if(!navigationStarted) return;
  if(!routeCoordinates.length) return;
  if(selectedLat == null || selectedLng == null) return;

  const now = Date.now();

  if(now - lastRerouteTime < REROUTE_COOLDOWN_MS) return;

  const ratio = await assessTrafficAhead(lat, lng);

  window.lastTrafficRatio = ratio;

  if(ratio === null || ratio >= HEAVY_TRAFFIC_RATIO) return;

  /* ---------- HEAVY TRAFFIC AHEAD: LOOK FOR A BETTER ALTERNATIVE ---------- */

  try{

    const altUrl =
`https://router.project-osrm.org/route/v1/driving/${lng},${lat};${selectedLng},${selectedLat}?alternatives=true&overview=full&geometries=geojson&steps=true`;

    const res = await fetch(altUrl);
    const data = await res.json();

    if(!data.routes || data.routes.length < 2) return;

    /* ---------- SCORE EACH ALTERNATIVE BY SAMPLING ITS OWN FLOW DATA ---------- */

    let bestRoute = null;
    let bestRatio = ratio;

    for(const candidate of data.routes){

      const candCoords =
        candidate.geometry.coordinates.map(c => [c[1], c[0]]);

      const points = sampleRouteAheadPoints(candCoords, lat, lng);

      if(!points.length) continue;

      const flows = await Promise.all(
        points.map(p => getFlowSegmentData(p[0], p[1]))
      );

      const valid = flows.filter(r => r !== null);

      if(!valid.length) continue;

      const avg =
        valid.reduce((sum, r) => sum + r.ratio, 0) / valid.length;

      if(avg > bestRatio + 0.15){ // require a meaningful improvement
        bestRatio = avg;
        bestRoute = candidate;
      }

    }

    if(!bestRoute) return;

    lastRerouteTime = now;

    drawRouteOnMap({ routes: [bestRoute] });

    addMessage(
      "🚦 Heavy traffic ahead — switched to a faster route",
      "bot"
    );

    speak("Heavy traffic ahead. Rerouting to a faster path.");

  }catch(e){

    console.log("Reroute error:", e);

  }

}

/* =========================================
   REFRESH INCIDENTS WHEN MAP MOVES
========================================= */

map.on(
  "moveend",
  ()=>{

    if(trafficMonitoring){

      loadLiveTrafficIncidents();

    }

  }
);

/* =========================================
   CLICK MAP TO SET DESTINATION
========================================= */

map.on(
"click",
async (e)=>{

  const lat = e.latlng.lat;
  const lng = e.latlng.lng;

  const placeName =
  await reverseGeocode(
    lat,
    lng
  );

  await createOrUpdateDestinationMarker(
    lat,
    lng,
    placeName
  );

  if(userLat && userLng){

    await generateRoute(
      userLat,
      userLng,
      lat,
      lng
    );

  }

}
);

/* =========================================
   MODERN TRAFFIC CSS
========================================= */

const trafficStyle =
document.createElement("style");

trafficStyle.innerHTML = `

/* =====================================
   TRAFFIC MARKER ROOT
===================================== */

.modernTrafficMarker{

  background:transparent !important;
  border:none !important;

}

/* =====================================
   PULSE EFFECT
===================================== */

.trafficPulse{

  position:absolute;

  width:70px;
  height:70px;

  border-radius:50%;

  background:var(--pulse);

  opacity:0.25;

  top:10px;
  left:10px;

  filter:blur(5px);

  animation:
  trafficPulseAnim 2s infinite;

}

/* =====================================
   MAIN CORE
===================================== */

.trafficCore{

  position:absolute;

  width:70px;
  height:70px;

  border-radius:50%;

  border:3px solid rgba(
    255,
    255,
    255,
    0.9
  );

  display:flex;
  align-items:center;
  justify-content:center;
  flex-direction:column;

  backdrop-filter:blur(15px);

  animation:
  trafficFloat 3s ease-in-out infinite;

}

/* =====================================
   CENTER DOT
===================================== */

.trafficDot{

  width:14px;
  height:14px;

  border-radius:50%;

  background:white;

  margin-bottom:6px;

  box-shadow:
  0 0 12px white,
  0 0 25px white;

}

/* =====================================
   TEXT
===================================== */

.trafficText{

  font-size:9px;

  font-weight:800;

  color:white;

  letter-spacing:1px;

  text-shadow:
  0 0 8px white;

}

/* =====================================
   POPUP
===================================== */

.trafficPopup{

  min-width:200px;

  color:#111;

  font-family:sans-serif;

}

.trafficPopupTitle{

  font-size:15px;
  font-weight:800;

  margin-bottom:8px;

}

.trafficPopupDesc{

  font-size:13px;

  line-height:1.5;

  margin-bottom:10px;

}

.trafficPopupDelay{

  font-size:12px;

  color:#666;

}

/* =====================================
   ANIMATIONS
===================================== */

@keyframes trafficPulseAnim{

  0%{

    transform:scale(0.8);
    opacity:0.55;

  }

  70%{

    transform:scale(1.7);
    opacity:0;

  }

  100%{

    opacity:0;

  }

}

@keyframes trafficFloat{

  0%{
    transform:translateY(0px);
  }

  50%{
    transform:translateY(-6px);
  }

  100%{
    transform:translateY(0px);
  }

}

`;

document.head.appendChild(
  trafficStyle
);

/* =========================================
   VOICE NAVIGATION
========================================= */

const voiceBtn =
document.getElementById(
  "voiceBtn"
);

voiceBtn.onclick = ()=>{

  if(!routeCoordinates.length){

    alert(
      "Generate route first"
    );

    return;

  }

  if(navigationStarted){

    stopNavigation();
    return;

  }

  startNavigation();

};

function startNavigation(){

  navigationStarted = true;

  addMessage(
    "🎤 Voice navigation activated",
    "bot"
  );

  speak(
    "Voice navigation activated"
  );

  weatherUpdateTimer =
  setInterval(()=>{

    if(userLat && userLng){

      showWeather(
        "destination",
        userLat,
        userLng
      );

    }

  },300000);

  watchId =
  navigator.geolocation.watchPosition(

    (position)=>{

      const lat =
      position.coords.latitude;

      const lng =
      position.coords.longitude;

      const prevLat = userLat;
      const prevLng = userLng;

      userLat = lat;
      userLng = lng;
      syncAdvancedMap();

    if(advanceMapEnabled && mapLibreMap){
      driveCameraTo(lat, lng, prevLat, prevLng);
    } else {
      flyToLocation(lat, lng, 18);
    }

      if(userMarker){

        userMarker.setLatLng(
          [lat,lng]
        );

        if(prevLat != null && prevLng != null){

          const carBearing =
          bearingBetween(prevLat, prevLng, lat, lng);

          const dist =
          Math.hypot(lat - prevLat, lng - prevLng);

          if(dist > 0.000003){
            rotateCarMarker(userMarker, carBearing);
          }

        }

      }

      const speed =
      position.coords.speed;

      if(speed !== null){

        const kmh =
        speed * 3.6;

        if(kmh < 10){

          addMessage(
            "🚦 Heavy traffic detected",
            "bot"
          );

        }
        else if(kmh < 25){

          addMessage(
            "🚦 Moderate traffic detected",
            "bot"
          );

        }
        handleLiveSpeed(position);
        refreshSmartTravel();
      }

      /* ---------- CHECK LIVE ROAD CONGESTION & REROUTE IF NEEDED ---------- */

      maybeRerouteForTraffic(lat, lng);

      checkNavigationStep(
        lat,
        lng
      );

    },

    (err)=>{

      console.log(err);

    },

    {
      enableHighAccuracy:true
    }
  );

}

function stopNavigation(){

  navigationStarted = false;

  navigator
  .geolocation
  .clearWatch(watchId);

  clearInterval(
    weatherUpdateTimer
  );

  addMessage(
    "🛑 Navigation stopped",
    "bot"
  );
stopSmartTravelSystem();

if(advanceMapEnabled && mapLibreMap){
  mapLibreMap.easeTo({
    pitch: TILT_STEPS[tiltLevel],
    bearing: 0,
    zoom: 16,
    duration: 900
  });
}

}

function checkNavigationStep(
lat,
lng
){

  if(!window.routeSteps)
  return;

  const step =
  window.routeSteps[
    currentStepIndex
  ];

  if(!step)
  return;

  const stepLat =
  step.maneuver.location[1];

  const stepLng =
  step.maneuver.location[0];

  const distance =
  map.distance(
    [lat,lng],
    [stepLat,stepLng]
  );

  if(distance < 80){

    let instruction =
    step.maneuver.modifier
    || "straight";

    let road =
    step.name || "road";

    let text = "";

    if(
      instruction.includes("left")
    ){

      text =
      `Turn left to ${road}`;

    }
    else if(
      instruction.includes("right")
    ){

      text =
      `Turn right to ${road}`;

    }
    else{

      text =
      `Continue on ${road}`;

    }

    speak(text);

    addMessage(
      `🧭 ${text}`,
      "bot"
    );

    currentStepIndex++;

  }

  const finalPoint =
  routeCoordinates[
    routeCoordinates.length - 1
  ];

  if(!finalPoint)
  return;

  const finalDistance =
  map.distance(
    [lat,lng],
    finalPoint
  );

  if(finalDistance < 30){

    speak(
      "You have arrived"
    );

    addMessage(
      " Destination reached",
      "bot"
    );

    stopNavigation();

  }

}

/* =========================================
   LIVE WHATSAPP TRACKING SYSTEM
========================================= */

shareBtn.onclick = ()=>{

  if(!userLat || !userLng){

    alert("Location unavailable");
    return;

  }

  startLiveTracking();

};

/* =========================================
   START LIVE TRACKING
========================================= */

function startLiveTracking(){

  liveTrackingEnabled = true;

  /* ---------- CREATE VIEWER LINK ---------- */

  const trackingUrl =

`${window.location.origin}${window.location.pathname}?track=${trackingShareId}`;

  /* =====================================
     SAVE INITIAL DATA
  ===================================== */

  localStorage.setItem(

    "travelnova_tracking_" +
    trackingShareId,

    JSON.stringify({

      lat:userLat,
      lng:userLng,
      destination:selectedDestinationAddress,
      active:true

    })

  );

  /* =====================================
     AUTO UPDATE LOCATION
  ===================================== */

  if(trackingUpdateInterval){

    clearInterval(
      trackingUpdateInterval
    );

  }

  trackingUpdateInterval =
  setInterval(()=>{

    localStorage.setItem(

      "travelnova_tracking_" +
      trackingShareId,

      JSON.stringify({

        lat:userLat,
        lng:userLng,
        destination:selectedDestinationAddress,
        active:navigationStarted

      })

    );

  },3000);

  /* =====================================
     OPEN WHATSAPP SHARE
  ===================================== */

  const whatsappText =

`🚗 Live Trip Tracking

Track my live journey here:

${trackingUrl}

You can only view my live location.`;

  const whatsappUrl =

`https://wa.me/?text=${encodeURIComponent(
  whatsappText
)}`;

  window.open(
    whatsappUrl,
    "_blank"
  );

  addMessage(
    "📡 Live tracking link shared",
    "bot"
  );

  speak(
    "Live tracking enabled"
  );

}

/* =========================================
   VIEWER MODE
========================================= */

const urlParams =
new URLSearchParams(
  window.location.search
);

const trackingId =
urlParams.get("track");

/* =====================================
   VIEW ONLY MODE
===================================== */

if(trackingId){

  enableViewerMode(
    trackingId
  );

}

/* =========================================
   ENABLE VIEWER MODE
========================================= */

function enableViewerMode(id){

  /* ---------- HIDE CONTROLS ---------- */

  const elementsToHide = [

    "searchDropdown",
    "chatbot",
    "robotBtn",
    "voiceBtn",
    "trafficBtn"

  ];

  elementsToHide.forEach(el=>{

    const item =
    document.getElementById(el);

    if(item){

      item.style.display =
      "none";

    }

  });

  /* =====================================
     DISABLE MAP INTERACTION
  ===================================== */

  map.dragging.disable();

  map.touchZoom.disable();

  map.doubleClickZoom.disable();

  map.scrollWheelZoom.disable();

  map.boxZoom.disable();

  map.keyboard.disable();

  /* =====================================
     TRACK LIVE LOCATION
  ===================================== */

  setInterval(()=>{

    const saved =
    localStorage.getItem(

      "travelnova_tracking_" +
      id

    );

    if(!saved) return;

    const data =
    JSON.parse(saved);

    const lat =
    data.lat;

    const lng =
    data.lng;

    /* ---------- REMOVE OLD ---------- */

    if(window.viewerMarker){

      map.removeLayer(
        window.viewerMarker
      );

    }

    /* ---------- CREATE LIVE MARKER ---------- */

    const liveIcon =
    L.icon({

      iconUrl:
"https://cdn-icons-png.flaticon.com/512/684/684908.png",

      iconSize:[45,45],
      iconAnchor:[22,44]

    });

    window.viewerMarker =
    L.marker(
      [lat,lng],
      {
        icon:liveIcon
      }
    )
    .addTo(map)
    .bindPopup(
      `🚗 Driver Live Location`
    );

    map.setView(
      [lat,lng],
      15
    );

  },3000);

}

/* =========================================
   SPEECH SYSTEM
========================================= */

function speak(text){

  window.speechSynthesis.cancel();

  const speech =
  new SpeechSynthesisUtterance(
    text
  );

  speech.lang = "en-US";

  speech.rate = 0.95;

  speech.pitch = 1;

  speech.volume = 1;

  window.speechSynthesis.speak(
    speech
  );

}

/* =========================================
   VOICE COMMANDS
========================================= */

if(
  "webkitSpeechRecognition"
  in window
){

  const recognition =
  new webkitSpeechRecognition();

  recognition.continuous = true;

  recognition.interimResults = false;

  recognition.lang = "en-US";

  recognition.onresult =
  (event)=>{

    const text =
    event.results[
      event.results.length - 1
    ][0].transcript;

    addMessage(
      `🎤 ${text}`,
      "user"
    );

    handleBotCommand(text);

  };

  if(voiceBtn){

    voiceBtn.addEventListener(
      "dblclick",
      ()=>{

        recognition.start();

        speak(
          "Voice assistant activated"
        );

      }
    );

  }

}
/* =========================================
   SMART PANEL TOGGLE
========================================= */

const smartTravelPanel =
document.getElementById("smartTravelPanel");

const togglePanelBtn =
document.getElementById("togglePanelBtn");

let panelOpen = true;

togglePanelBtn.addEventListener("click", () => {

  panelOpen = !panelOpen;

  if(panelOpen){

    smartTravelPanel.classList.remove("collapsed");

    togglePanelBtn.innerHTML = "−";

  } else {

    smartTravelPanel.classList.add("collapsed");

    togglePanelBtn.innerHTML = "+";

  }

});
/* =========================================================
   1. ETA ENGINE
========================================================= */

function calculateSmartETA(distanceMeters, liveSpeedKmh, trafficLevel = "normal") {

  // 🔥 REALISTIC BASE SPEED (India city traffic model)
  let speed = liveSpeedKmh && liveSpeedKmh > 5 ? liveSpeedKmh : 22;

  // ---------------- TRAFFIC FACTOR (STRONGER) ----------------
  let trafficMultiplier = 1;

  if (trafficLevel === "heavy") trafficMultiplier = 3.0;
  else if (trafficLevel === "moderate") trafficMultiplier = 1.8;
  else if (trafficLevel === "light") trafficMultiplier = 1.2;

  // ---------------- TIME FACTOR ----------------
  const hour = new Date().getHours();
  let timeMultiplier = 1;

  // Peak Bangalore traffic windows
  if ((hour >= 8 && hour <= 11) || (hour >= 17 && hour <= 21)) {
    timeMultiplier = 1.6;
  }

  // Late night slight improvement
  if (hour >= 23 || hour <= 5) {
    timeMultiplier = 0.85;
  }

  // ---------------- WEATHER FACTOR ----------------
  let weatherMultiplier = 1;

  const weatherText = (
    window.currentWeatherCondition ||
    document.getElementById("weather")?.innerText ||
    ""
  ).toLowerCase();

  if (
    weatherText.includes("rain") ||
    weatherText.includes("drizzle") ||
    weatherText.includes("thunder") ||
    weatherText.includes("showers")
  ) {
    weatherMultiplier = 1.4; // stronger impact
  }

  const distanceKm = distanceMeters / 1000;

  // 🔥 FINAL ETA
  let eta =
    (distanceKm / speed) *
    60 *
    trafficMultiplier *
    timeMultiplier *
    weatherMultiplier;

  return Math.max(5, eta);
}

function convertWeatherToSmartLabel(weatherText) {

  const text = (weatherText || "").toLowerCase();

  // 🌧️ Rain group
  if (text.includes("thunder")) return "🌧️ STORMY";
  if (text.includes("rain")) return "🌧️ RAINY";
  if (text.includes("drizzle") || text.includes("showers")) return "🌧️ SHOWERS";
  if (text.includes("wet")) return "🌧️ WET";

  // ☀️ Clear group
  if (text.includes("clear")) return "CLEAR";
  if (text.includes("sun")) return "☀️ SUNNY";
  if (text.includes("bright")) return "☀️ BRIGHT";
  if (text.includes("fair")) return "FAIR";
  if (text.includes("dry")) return "DRY";

  // ☁️ Cloud group
  if (text.includes("fog")) return "☁️ FOGGY";
  if (text.includes("mist")) return "☁️ MISTY";
  if (text.includes("overcast")) return "☁️ CLOUDY";
  if (text.includes("cloud")) return "☁️ CLOUDY";
  if (text.includes("dark")) return "☁️ DARK";

  // 💨 Wind group
  if (text.includes("gust")) return "💨 GUSTY";
  if (text.includes("wind")) return "💨 WINDY";
  if (text.includes("breeze")) return "💨 BREEZY";

  // 🌡️ Cold group
  if (text.includes("snow")) return "☃️ SNOWY";
  if (text.includes("cold")) return "❄️ COLD";
  if (text.includes("chill")) return "❄️ CHILLY";
  if (text.includes("freeze")) return "❄️ FREEZING";

  // ☀️ default
  return "CLEAR";
}

/* =========================================================
   2. SMART PANEL UPDATER
========================================================= */

function updateSmartTravelPanel(distanceKm, etaMins, weatherText, trafficText) {

  document.getElementById("distanceValue").innerText =
    distanceKm ? `${distanceKm.toFixed(1)} km` : "-- km";

  document.getElementById("etaValue").innerText =
    etaMins ? `${Math.round(etaMins)} mins` : "-- mins";

  // ✅ FIX: use the actual decoded condition (falls back to the topBar text)
  const rawWeather =
    window.currentWeatherCondition ||
    weatherText ||
    document.getElementById("weather")?.innerText ||
    "--";

  const smartWeather = convertWeatherToSmartLabel(rawWeather);

  document.getElementById("weatherValue").innerText =
    smartWeather;

  document.getElementById("trafficValue").innerText =
    trafficText || "--";
}

/* =========================================================
   3. LIVE SPEED TRACKING
========================================================= */

window.lastSpeedKmh = 35;

function handleLiveSpeed(position) {

  if (position.coords.speed !== null) {
    window.lastSpeedKmh = position.coords.speed * 3.6;
  }
}


/* =========================================================
   4. MAIN ETA + PANEL REFRESH ENGINE
========================================================= */

function refreshSmartTravel() {

  if (!routeCoordinates.length || !userLat || !userLng) return;

  const finalPoint = routeCoordinates[routeCoordinates.length - 1];

  const remainingDistance = map.distance(
    [userLat, userLng],
    finalPoint
  );

  /* ---------- USE THE REAL MEASURED CONGESTION RATIO WHEN WE HAVE ONE ---------- */

  let trafficLevel = "light";
  let trafficText = trafficMonitoring ? "Live Traffic ON" : "Live Traffic OFF";

  if(trafficMonitoring && window.lastTrafficRatio != null){

    if(window.lastTrafficRatio < HEAVY_TRAFFIC_RATIO){
      trafficLevel = "heavy";
      trafficText = "🔴 Heavy traffic ahead";
    } else if(window.lastTrafficRatio < MODERATE_TRAFFIC_RATIO){
      trafficLevel = "moderate";
      trafficText = "🟠 Moderate traffic ahead";
    } else {
      trafficLevel = "light";
      trafficText = "🟢 Traffic flowing";
    }

  } else if(trafficMonitoring){

    trafficLevel = "moderate";

  }

  const eta = calculateSmartETA(
    remainingDistance,
    window.lastSpeedKmh,
    trafficLevel
  );

  const distanceKm = remainingDistance / 1000;

  const weatherText = document.getElementById("weather")?.innerText || "--";

  updateSmartTravelPanel(
    distanceKm,
    eta,
    weatherText,
    trafficText
  );
}


/* =========================================================
   5. START SMART SYSTEM LOOP
========================================================= */

let smartTravelInterval = null;

function startSmartTravelSystem() {

  if (smartTravelInterval) return;

  smartTravelInterval = setInterval(() => {

    refreshSmartTravel();

  }, 5000);
}

/* ---------- AUTO-START: KEEP THE SMART TRAVEL COLUMN
   REFRESHING EVERY 5 SECONDS FROM THE MOMENT THE APP LOADS ---------- */

startSmartTravelSystem();


/* =========================================================
   6. STOP SMART SYSTEM LOOP
========================================================= */

function stopSmartTravelSystem() {

  if (smartTravelInterval) {
    clearInterval(smartTravelInterval);
    smartTravelInterval = null;
  }

  updateSmartTravelPanel(null, null, "--", "--");
}
/* =========================================================
   MOBILE WEB APP: SERVICE WORKER REGISTRATION
   Registers the app-shell service worker so Travillox can be
   installed via "Add to Home Screen" and reopens instantly.
   Wrapped in a feature check + try/catch so it's a no-op on
   browsers or contexts (e.g. non-https local files) that
   don't support it.
========================================================= */

if ("serviceWorker" in navigator) {

  window.addEventListener("load", () => {

    navigator.serviceWorker
      .register("sw.js")
      .then((registration) => {

        /* ---------- ALWAYS CHECK FOR A NEWER WORKER ----------
           Browsers only re-check sw.js for changes on navigation,
           and can go a while between checks. Calling update() here
           forces that check on every load, so if a newer sw.js (or
           a newer CACHE_NAME inside it) is deployed, it starts
           installing right away instead of the visitor being stuck
           on an old cached version indefinitely. */

        registration.update();

      })
      .catch((err) => console.log("Service worker registration failed:", err));

  });

}