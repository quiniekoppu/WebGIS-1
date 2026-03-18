// ===== MAP.JS - Khởi tạo bản đồ Leaflet =====

// Khởi tạo bản đồ
const map = L.map('map', {
  center: CONFIG.defaultCenter,
  zoom: CONFIG.defaultZoom,
  zoomControl: false
});

// Thêm zoom control vào góc phải
L.control.zoom({ position: 'bottomright' }).addTo(map);

// Scale control
L.control.scale({
  metric: true,
  imperial: false,
  position: 'bottomright'
}).addTo(map);

// Layer mặc định (OSM)
let currentBaseLayer = L.tileLayer(
  CONFIG.tileLayers.osm.url,
  CONFIG.tileLayers.osm.options
).addTo(map);

// Layer nhóm cho đối tượng vẽ
const drawnItems = new L.FeatureGroup().addTo(map);

// Layer nhóm cho GeoJSON upload
const geojsonLayer = new L.FeatureGroup().addTo(map);

// Cập nhật tọa độ chuột
map.on('mousemove', function(e) {
  const lat = e.latlng.lat.toFixed(5);
  const lng = e.latlng.lng.toFixed(5);
  document.getElementById('coords').textContent =
    `📍 Lat: ${lat} | Lng: ${lng}`;
});

// Cập nhật zoom level
map.on('zoomend', function() {
  document.getElementById('zoom-level').textContent =
    `Zoom: ${map.getZoom()}`;
});

// Click bản đồ để thêm marker nhanh (khi tool marker đang active)
map.on('click', function(e) {
  if (window.activeDrawTool === 'marker') {
    addMarker(e.latlng);
  }
});
