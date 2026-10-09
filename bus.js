/* =========================================
   TRAVILLOX • BMTC BUS MODULE
   Shows BMTC route stops and live buses on
   the map using live API with Mock Fallback.
========================================= */

const BUS_API_BASE = "https://bmtcmobileapistaging.amnex.com/WebAPI";

const BUS_HEADERS = {
  "Content-Type": "application/json",
  "lan": "en",
  "deviceType": "WEB"
};

/* ---------- PREDEFINED MOCK BMTC DATASET ---------- */

const MOCK_BMTC_ROUTES = {
  "335E": {
    routeNo: "335E",
    stops: [
      { name: "Kempegowda Bus Station (Majestic)", lat: 12.9779, lng: 77.5724 },
      { name: "Corporation", lat: 12.9649, lng: 77.5888 },
      { name: "Richmond Circle", lat: 12.9602, lng: 77.5985 },
      { name: "Domlur Flyover", lat: 12.9609, lng: 77.6382 },
      { name: "HAL Main Gate", lat: 12.9576, lng: 77.6685 },
      { name: "Marathahalli Bridge", lat: 12.9560, lng: 77.7011 },
      { name: "Kundalahalli Gate", lat: 12.9664, lng: 77.7128 },
      { name: "ITPL (Information Tech Park)", lat: 12.9863, lng: 77.7346 },
      { name: "Kadugodi Bus Station", lat: 12.9984, lng: 77.7601 }
    ],
    vehicles: [
      { id: "KA-57-F-1234", lat: 12.9605, lng: 77.6250 },
      { id: "KA-57-F-5678", lat: 12.9600, lng: 77.7080 }
    ]
  },
  "500D": {
    routeNo: "500D",
    stops: [
      { name: "Silk Board", lat: 12.9173, lng: 77.6227 },
      { name: "HSR Layout Sector 7", lat: 12.9116, lng: 77.6389 },
      { name: "Agara Junction", lat: 12.9237, lng: 77.6432 },
      { name: "Iblur Junction", lat: 12.9254, lng: 77.6622 },
      { name: "Bellandur", lat: 12.9328, lng: 77.6811 },
      { name: "Kadubeesanahalli", lat: 12.9380, lng: 77.6960 },
      { name: "Marathahalli Multiplex", lat: 12.9520, lng: 77.7010 },
      { name: "Mahadevapura", lat: 12.9912, lng: 77.6974 },
      { name: "KR Puram Railway Station", lat: 13.0012, lng: 77.6748 },
      { name: "Hebbal Flyover", lat: 13.0359, lng: 77.5888 }
    ],
    vehicles: [
      { id: "KA-57-F-9012", lat: 12.9240, lng: 77.6510 },
      { id: "KA-57-F-3456", lat: 12.9700, lng: 77.6980 }
    ]
  },
  "G-3": {
    routeNo: "G-3",
    stops: [
      { name: "Brigade Road", lat: 12.9734, lng: 77.6074 },
      { name: "Mayo Hall", lat: 12.9723, lng: 77.6133 },
      { name: "MG Road Metro", lat: 12.9756, lng: 77.6067 },
      { name: "Trinity Circle", lat: 12.9722, lng: 77.6186 },
      { name: "Ulsoor Lake", lat: 12.9817, lng: 77.6200 },
      { name: "Indiranagar 100ft Road", lat: 12.9620, lng: 77.6380 }
    ],
    vehicles: [
      { id: "KA-01-F-7788", lat: 12.9740, lng: 77.6100 }
    ]
  }
};

/* ---------- STATE ---------- */

let busStopMarkers = [];
let busLiveMarkers = [];
let busRouteLine = null;
let busAdvancedMarkers = [];
let busRefreshTimer = null;
let currentBusRouteNo = null;
let currentBusParentId = null;

/* ---------- HELPERS ---------- */

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function clearBusLayers() {
  busStopMarkers.forEach(m => map.removeLayer(m));
  busStopMarkers = [];

  busLiveMarkers.forEach(m => map.removeLayer(m));
  busLiveMarkers = [];

  if (busRouteLine) {
    map.removeLayer(busRouteLine);
    busRouteLine = null;
  }

  busAdvancedMarkers.forEach(m => m.remove());
  busAdvancedMarkers = [];
}

function stopBusTracking() {
  clearBusLayers();

  if (busRefreshTimer) {
    clearInterval(busRefreshTimer);
    busRefreshTimer = null;
  }

  currentBusRouteNo = null;
  currentBusParentId = null;
}

/* ---------- GENERATE DYNAMIC MOCK ROUTE FOR UNKNOWN ROUTES ---------- */

function generateFallbackMock(routeNo) {
  const baseLat = (typeof userLat !== "undefined" && userLat) ? userLat : 12.9716;
  const baseLng = (typeof userLng !== "undefined" && userLng) ? userLng : 77.5946;

  const stops = [];
  const count = 6;

  for (let i = 0; i < count; i++) {
    stops.push({
      name: `Route ${routeNo} - Stop ${i + 1}`,
      lat: baseLat + (i * 0.012) - 0.02,
      lng: baseLng + (i * 0.015) - 0.025
    });
  }

  return {
    routeNo: routeNo,
    stops: stops,
    vehicles: [
      { id: `KA-57-MOCK-${Math.floor(1000 + Math.random() * 9000)}`, lat: stops[1].lat, lng: stops[1].lng },
      { id: `KA-57-MOCK-${Math.floor(1000 + Math.random() * 9000)}`, lat: stops[4].lat, lng: stops[4].lng }
    ]
  };
}

/* ---------- FETCH ROUTE (MOCK FIRST WITH API FALLBACK) ---------- */

async function fetchRouteData(routeNo) {
  const key = routeNo.toUpperCase().replace(/\s+/g, "");

  // Check if predefined in mock dataset
  if (MOCK_BMTC_ROUTES[key]) {
    return { data: MOCK_BMTC_ROUTES[key], isMock: true };
  }

  // Attempt live API call
  try {
    const res = await fetch(BUS_API_BASE + "/SearchRoute_v2", {
      method: "POST",
      headers: BUS_HEADERS,
      body: JSON.stringify({ routetext: routeNo })
    });

    if (res.ok) {
      const json = await res.json();
      const list = json.data || json.Data || [];
      if (list.length > 0) {
        const routeId = list[0].routeparentid || list[0].routeid;
        const detailsRes = await fetch(BUS_API_BASE + "/SearchByRouteDetails_v4", {
          method: "POST",
          headers: BUS_HEADERS,
          body: JSON.stringify({ routeid: routeId, servicetypeid: 0 })
        });

        if (detailsRes.ok) {
          const detailsJson = await detailsRes.json();
          const stops = [];
          const vehicles = [];

          const scan = (node) => {
            if (Array.isArray(node)) {
              node.forEach(item => {
                if (item && typeof item === "object") {
                  const lat = parseFloat(item.centerlat || item.latitude || item.lat);
                  const lng = parseFloat(item.centerlong || item.longitude || item.lng);
                  if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
                    if (item.vehicleid || item.vehiclenumber) {
                      vehicles.push({ id: item.vehiclenumber || item.vehicleid, lat, lng });
                    } else {
                      stops.push({ name: item.stationname || item.stopname || "Stop", lat, lng });
                    }
                  }
                  scan(item);
                }
              });
            } else if (node && typeof node === "object") {
              Object.values(node).forEach(scan);
            }
          };

          scan(detailsJson);

          if (stops.length > 0) {
            return { data: { routeNo, stops, vehicles }, isMock: false };
          }
        }
      }
    }
  } catch (err) {
    console.warn("[BUS] Live API unavailable, using mock fallback:", err);
  }

  // Fallback to auto-generated mock route if live API fails or route is unlisted
  return { data: generateFallbackMock(routeNo), isMock: true };
}

/* ---------- RENDER FUNCTIONS ---------- */

function busStopIcon() {
  return L.divIcon({
    className: "",
    html: '<div class="busStopDot"></div>',
    iconSize: [14, 14],
    iconAnchor: [7, 7]
  });
}

function busLiveIcon() {
  return L.divIcon({
    className: "",
    html: '<div class="busLiveIcon">🚌</div>',
    iconSize: [34, 34],
    iconAnchor: [17, 17]
  });
}

function drawBusStops(stops) {
  const latlngs = [];

  stops.forEach((s) => {
    latlngs.push([s.lat, s.lng]);

    const m = L.marker([s.lat, s.lng], { icon: busStopIcon() })
      .addTo(map)
      .bindPopup("🚏 " + escapeHtml(s.name));

    busStopMarkers.push(m);
  });

  if (latlngs.length > 1) {
    busRouteLine = L.polyline(latlngs, {
      color: "#facc15",
      weight: 5,
      opacity: 0.9,
      dashArray: "8 8"
    }).addTo(map);

    if (typeof advanceMapEnabled === "undefined" || !advanceMapEnabled) {
      map.fitBounds(busRouteLine.getBounds(), { padding: [40, 40] });
    }
  }

  if (typeof advanceMapEnabled !== "undefined" && advanceMapEnabled && mapLibreMap) {
    const bounds = new maplibregl.LngLatBounds();

    stops.forEach(s => {
      const el = document.createElement("div");
      el.className = "busStopDot";

      const mk = new maplibregl.Marker({ element: el })
        .setLngLat([s.lng, s.lat])
        .setPopup(new maplibregl.Popup().setText("🚏 " + s.name))
        .addTo(mapLibreMap);

      busAdvancedMarkers.push(mk);
      bounds.extend([s.lng, s.lat]);
    });

    if (stops.length > 1) {
      mapLibreMap.fitBounds(bounds, { padding: 60, duration: 900 });
    }
  }
}

function drawLiveBuses(vehicles) {
  busLiveMarkers.forEach(m => map.removeLayer(m));
  busLiveMarkers = [];

  vehicles.forEach(v => {
    const m = L.marker([v.lat, v.lng], { icon: busLiveIcon() })
      .addTo(map)
      .bindPopup("🚌 " + escapeHtml(v.id));

    busLiveMarkers.push(m);
  });
}

/* ---------- MAIN DISPLAY ROUTE ---------- */

async function showBusRoute(routeNo) {
  routeNo = (routeNo || "").trim();

  if (!routeNo) {
    if (typeof addMessage === "function") {
      addMessage("🚌 Enter a route number, e.g. 335E, 500D, G-3", "bot");
    }
    return;
  }

  stopBusTracking();
  if (typeof addMessage === "function") {
    addMessage(`🚌 Fetching route ${routeNo}...`, "bot");
  }

  const { data, isMock } = await fetchRouteData(routeNo);

  currentBusRouteNo = data.routeNo;
  drawBusStops(data.stops);
  drawLiveBuses(data.vehicles);

  const statusMsg = `🚌 Route ${data.routeNo}: ${data.stops.length} stops, ${data.vehicles.length} active bus(es) ${isMock ? "(Mock Data)" : "(Live Data)"}`;
  
  if (typeof addMessage === "function") {
    addMessage(statusMsg, "bot");
  }
  if (typeof speak === "function") {
    speak(`Showing route ${data.routeNo}`);
  }

  // Simulate vehicle movements periodically for mock routes
  if (isMock) {
    busRefreshTimer = setInterval(() => {
      data.vehicles.forEach(v => {
        v.lat += (Math.random() - 0.5) * 0.002;
        v.lng += (Math.random() - 0.5) * 0.002;
      });
      drawLiveBuses(data.vehicles);
    }, 5000);
  }
}

/* ---------- BUTTON INITIALIZER ---------- */

function initializeBusButton() {
  const busBtnEl = document.getElementById("busBtn");

  if (!busBtnEl) {
    console.error("[BUS] Button #busBtn was not found in DOM.");
    return;
  }

  if (busBtnEl.dataset.busHandlerAttached === "true") return;
  busBtnEl.dataset.busHandlerAttached = "true";

  busBtnEl.addEventListener("click", () => {
    if (currentBusRouteNo) {
      stopBusTracking();
      if (typeof addMessage === "function") {
        addMessage("🚌 Bus route cleared", "bot");
      }
      return;
    }

    const input = window.prompt("Enter BMTC route number (e.g. 335E, 500D, G-3):", "335E");
    if (input && input.trim()) {
      showBusRoute(input.trim().toUpperCase());
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeBusButton, { once: true });
} else {
  initializeBusButton();
}