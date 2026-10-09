/* =========================================
   TRAVILLOX • BMTC BUS MODULE
   Shows a BMTC route's stops (and live buses
   when the API returns them) on the map.

   Chat:  "bus 335E"   or   tap the 🚌 Bus button

   API (unofficial Namma BMTC, see github.com/Vonter/open-bmtc):
     1. POST /SearchRoute_v2           -> routeparentid
     2. POST /SearchByRouteDetails_v4  -> stops (+ live vehicles)

   NOTE: request field names below follow the commonly used
   BMTC app format. If the API rejects them, open the browser
   console: every request/response is logged under "[BUS]",
   so the exact fields can be corrected in the two body
   builders (buildSearchBody / buildDetailsBody).
========================================= */

/* ---------- CONFIG ----------
   If the browser blocks the call with a CORS error, deploy
   bus-proxy-worker.js and set BUS_API_BASE to the worker URL. */

const BUS_API_BASE = "https://bmtcmobileapistaging.amnex.com/WebAPI";

const BUS_HEADERS = {
  "Content-Type": "application/json",
  "lan": "en",
  "deviceType": "WEB"
};

function buildSearchBody(routeNo){
  return { routetext: routeNo };
}

function buildDetailsBody(routeParentId){
  return { routeid: routeParentId, servicetypeid: 0 };
}

/* ---------- STATE ---------- */

let busStopMarkers = [];
let busLiveMarkers = [];
let busRouteLine = null;
let busAdvancedMarkers = [];
let busRefreshTimer = null;
let currentBusRouteNo = null;
let currentBusParentId = null;

/* ---------- HELPERS ---------- */

async function busPost(path, body){

  const res = await fetch(BUS_API_BASE + path, {
    method: "POST",
    headers: BUS_HEADERS,
    body: JSON.stringify(body)
  });

  if(!res.ok) throw new Error("HTTP " + res.status);

  const text = await res.text();

  let json;
  try{ json = JSON.parse(text); }
  catch(e){ throw new Error("Bad JSON from bus API"); }

  console.log("[BUS]", path, body, json);

  return json;

}

/* case-insensitive field lookup so slightly different
   field names (centerlat / center_lat / latitude) still work */

function pick(obj, names){

  if(!obj) return undefined;

  const lower = {};
  Object.keys(obj).forEach(k => lower[k.toLowerCase()] = obj[k]);

  for(const n of names){
    const v = lower[n.toLowerCase()];
    if(v !== undefined && v !== null && v !== "") return v;
  }

  return undefined;

}

function toNum(v){
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

function getLat(o){
  return toNum(pick(o, ["centerlat","center_lat","latitude","lat"]));
}

function getLng(o){
  return toNum(pick(o, ["centerlong","centerlon","center_lon","center_lng","longitude","lng","lon"]));
}

function escapeHtml(s){
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}

/* ---------- CLEAR ---------- */

function clearBusLayers(){

  busStopMarkers.forEach(m => map.removeLayer(m));
  busStopMarkers = [];

  busLiveMarkers.forEach(m => map.removeLayer(m));
  busLiveMarkers = [];

  if(busRouteLine){
    map.removeLayer(busRouteLine);
    busRouteLine = null;
  }

  busAdvancedMarkers.forEach(m => m.remove());
  busAdvancedMarkers = [];

}

function stopBusTracking(){

  clearBusLayers();

  if(busRefreshTimer){
    clearInterval(busRefreshTimer);
    busRefreshTimer = null;
  }

  currentBusRouteNo = null;
  currentBusParentId = null;

}

/* ---------- STEP 1: ROUTE NUMBER -> PARENT ID ---------- */

async function findBusRoute(routeNo){

  const data = await busPost("/SearchRoute_v2", buildSearchBody(routeNo));

  const list = data.data || data.Data || [];

  if(!list.length) return null;

  const wanted = routeNo.replace(/\s+/g,"").toLowerCase();

  const exact = list.find(r => {
    const no = String(pick(r, ["routeno"]) || "").replace(/\s+/g,"").toLowerCase();
    return no === wanted;
  }) || list[0];

  return {
    parentId: pick(exact, ["routeparentid","routeid"]),
    routeNo: pick(exact, ["routeno"]) || routeNo
  };

}

/* ---------- STEP 2: STOPS + LIVE BUSES ---------- */

async function fetchBusDetails(parentId){

  const data = await busPost("/SearchByRouteDetails_v4", buildDetailsBody(parentId));

  const stops = [];
  const vehicles = [];

  /* the stops array may be called "data", "route", "stops" etc.,
     so scan every array in the response for items with lat/lng */

  function scan(node){

    if(Array.isArray(node)){
      node.forEach(item => {
        if(item && typeof item === "object"){
          const lat = getLat(item);
          const lng = getLng(item);
          const isVehicle =
            pick(item, ["vehicleid","vehiclenumber","vehicleno","busno"]) !== undefined;

          if(lat !== null && lng !== null && (lat !== 0 || lng !== 0)){
            (isVehicle ? vehicles : stops).push(item);
          }
          scan(item);
        }
      });
    } else if(node && typeof node === "object"){
      Object.values(node).forEach(scan);
    }

  }

  scan(data);

  return { stops, vehicles, raw: data };

}

/* ---------- DRAWING ---------- */

function busStopIcon(){
  return L.divIcon({
    className: "",
    html: '<div class="busStopDot"></div>',
    iconSize: [14,14],
    iconAnchor: [7,7]
  });
}

function busLiveIcon(){
  return L.divIcon({
    className: "",
    html: '<div class="busLiveIcon">🚌</div>',
    iconSize: [34,34],
    iconAnchor: [17,17]
  });
}

function drawBusStops(stops){

  const latlngs = [];

  stops.forEach((s, i) => {

    const lat = getLat(s);
    const lng = getLng(s);

    const name = pick(s, ["stationname","stopname","name"]) || ("Stop " + (i + 1));

    latlngs.push([lat, lng]);

    const m = L.marker([lat, lng], { icon: busStopIcon() })
      .addTo(map)
      .bindPopup("🚏 " + escapeHtml(name));

    busStopMarkers.push(m);

  });

  if(latlngs.length > 1){

    busRouteLine = L.polyline(latlngs, {
      color: "#facc15",
      weight: 4,
      opacity: 0.85,
      dashArray: "8 8"
    }).addTo(map);

    if(!advanceMapEnabled){
      map.fitBounds(busRouteLine.getBounds(), { padding: [40, 40] });
    }

  }

  /* advanced (MapLibre) map */

  if(typeof advanceMapEnabled !== "undefined" && advanceMapEnabled && mapLibreMap){

    const bounds = new maplibregl.LngLatBounds();

    stops.forEach(s => {

      const lat = getLat(s);
      const lng = getLng(s);

      const el = document.createElement("div");
      el.className = "busStopDot";

      const name = pick(s, ["stationname","stopname","name"]) || "Bus stop";

      const mk = new maplibregl.Marker({ element: el })
        .setLngLat([lng, lat])
        .setPopup(new maplibregl.Popup().setText("🚏 " + name))
        .addTo(mapLibreMap);

      busAdvancedMarkers.push(mk);
      bounds.extend([lng, lat]);

    });

    if(stops.length > 1){
      mapLibreMap.fitBounds(bounds, { padding: 60, duration: 900 });
    }

  }

}

function drawLiveBuses(vehicles){

  busLiveMarkers.forEach(m => map.removeLayer(m));
  busLiveMarkers = [];

  vehicles.forEach(v => {

    const lat = getLat(v);
    const lng = getLng(v);

    const no = pick(v, ["vehiclenumber","vehicleno","busno","vehicleid"]) || "Bus";

    const m = L.marker([lat, lng], { icon: busLiveIcon() })
      .addTo(map)
      .bindPopup("🚌 " + escapeHtml(no));

    busLiveMarkers.push(m);

  });

}

/* ---------- MAIN ENTRY ---------- */

async function showBusRoute(routeNo){

  routeNo = (routeNo || "").trim();

  if(!routeNo){
    addMessage("🚌 Type a route number, e.g. bus 335E", "bot");
    return;
  }

  addMessage("🚌 Looking up route " + routeNo + "...", "bot");

  try{

    const route = await findBusRoute(routeNo);

    if(!route || !route.parentId){
      addMessage("❌ Bus route " + routeNo + " not found", "bot");
      return;
    }

    stopBusTracking();

    const { stops, vehicles } = await fetchBusDetails(route.parentId);

    if(!stops.length){
      addMessage(
        "⚠️ Route found but no stop locations came back. " +
        "Open the browser console ([BUS] logs) to check the response format.",
        "bot"
      );
      return;
    }

    currentBusRouteNo = route.routeNo;
    currentBusParentId = route.parentId;

    drawBusStops(stops);
    drawLiveBuses(vehicles);

    addMessage(
      "🚌 Route " + route.routeNo + ": " + stops.length + " stops" +
      (vehicles.length ? ", " + vehicles.length + " live bus(es)" : ""),
      "bot"
    );

    speak("Showing bus route " + route.routeNo);

    /* refresh live bus positions every 20s */

    busRefreshTimer = setInterval(async () => {

      try{
        const d = await fetchBusDetails(currentBusParentId);
        drawLiveBuses(d.vehicles);
      }catch(e){
        console.log("[BUS] refresh failed", e);
      }

    }, 20000);

  }catch(e){

    console.log("[BUS] error", e);

    addMessage(
      "❌ Bus data unavailable right now (" + e.message + "). " +
      "If this is a CORS error, deploy bus-proxy-worker.js and set BUS_API_BASE.",
      "bot"
    );

  }

}

/* ---------- BMTC BUS BUTTON ---------- */

function initializeBusButton() {
  const busBtnEl = document.getElementById("busBtn");

  if (!busBtnEl) {
    console.error("[BUS] Button #busBtn was not found. Check index.html.");
    return;
  }

  if (busBtnEl.dataset.busHandlerAttached === "true") return;
  busBtnEl.dataset.busHandlerAttached = "true";

  busBtnEl.addEventListener("click", () => {
    console.log("[BUS] Bus button clicked");

    if (currentBusRouteNo) {
      stopBusTracking();
      addMessage("🚌 Bus route cleared", "bot");
      return;
    }

    const input = window.prompt("Enter BMTC route number (e.g. 335E, 500D, G-3):");
    if (input && input.trim()) {
      showBusRoute(input.trim().toUpperCase());
    }
  });

  console.log("[BUS] Button handler attached successfully");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeBusButton, { once: true });
} else {
  initializeBusButton();
}
