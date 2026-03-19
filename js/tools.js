// ===== TOOLS.JS - Công cụ vẽ và đo =====

window.activeDrawTool = null;
let drawHandler = null;
let featureCount = 0;
const featureMap = {}; // { id: layer }

// Leaflet Draw options
const drawOptions = {
  polyline: new L.Draw.Polyline(map, {
    shapeOptions: {
      color: CONFIG.drawColors.stroke,
      weight: 3
    }
  }),
  polygon: new L.Draw.Polygon(map, {
    shapeOptions: {
      color: CONFIG.drawColors.stroke,
      fillColor: CONFIG.drawColors.fill,
      fillOpacity: CONFIG.drawColors.fillOpacity,
      weight: 2
    }
  }),
  circle: new L.Draw.Circle(map, {
    shapeOptions: {
      color: CONFIG.drawColors.stroke,
      fillColor: CONFIG.drawColors.fill,
      fillOpacity: CONFIG.drawColors.fillOpacity
    }
  })
};

// -------- MARKER --------
function addMarker(latlng) {
  const id = ++featureCount;
  const marker = L.marker(latlng, {
    icon: L.divIcon({
      className: '',
      html: `<div style="
        width:14px;height:14px;
        background:${CONFIG.drawColors.stroke};
        border:2px solid white;
        border-radius:50%;
        box-shadow:0 2px 6px rgba(0,0,0,0.3)
      "></div>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7]
    })
  });

  const popupContent = `
    <strong>📍 Điểm #${id}</strong><br/>
    Lat: ${latlng.lat.toFixed(5)}<br/>
    Lng: ${latlng.lng.toFixed(5)}
  `;
  marker.bindPopup(popupContent);
  marker.addTo(drawnItems);

  featureMap[id] = marker;
  addFeatureToList(id, 'marker', `Điểm #${id}`);
  deactivateAllTools();
}

// -------- ACTIVATE TOOL --------
function activateTool(toolName) {
  // Tắt tool hiện tại
  deactivateAllTools();

  if (toolName === 'marker') {
    window.activeDrawTool = 'marker';
    document.getElementById('tool-marker').classList.add('active');
    map.getContainer().style.cursor = 'crosshair';
    showNotification('Click lên bản đồ để đặt điểm');
    return;
  }

  if (toolName === 'measure') {
    startMeasure();
    return;
  }

  // Leaflet Draw tools
  const handler = drawOptions[toolName];
  if (handler) {
    window.activeDrawTool = toolName;
    drawHandler = handler;
    drawHandler.enable();
    document.getElementById(`tool-${toolName}`).classList.add('active');
  }
}

function deactivateAllTools() {
  window.activeDrawTool = null;
  map.getContainer().style.cursor = '';

  // Tắt tất cả draw handlers
  Object.values(drawOptions).forEach(h => {
    try { h.disable(); } catch(e) {}
  });

  // Tắt measure
  stopMeasure();

  // Reset UI
  document.querySelectorAll('.tool-btn').forEach(btn => {
    if (!btn.classList.contains('danger')) {
      btn.classList.remove('active');
    }
  });
}

// -------- DRAW EVENTS --------
map.on(L.Draw.Event.CREATED, async function (e) {
    const id = ++featureCount;
    const type = e.layerType;
    const layer = e.layer;
    
    drawnItems.addLayer(layer);

    // Xử lý Popup thông tin (Đã được đưa vào TRONG hàm)
    let info = `<strong>${getTypeLabel(type)} #${id}</strong><br/>`;
    
    if (type === 'polyline') {
      const dist = calculatePolylineLength(layer);
      info += `Độ dài: <b>${formatDistance(dist)}</b>`;
    } else if (type === 'polygon') {
      const area = L.GeometryUtil.geodesicArea(layer.getLatLngs()[0]);
      info += `Diện tích: <b>${formatArea(area)}</b>`;
    } else if (type === 'circle') {
      const r = layer.getRadius();
      info += `Bán kính: <b>${formatDistance(r)}</b>`;
    }

    layer.bindPopup(info);
    layer.openPopup();

    featureMap[id] = layer;
    addFeatureToList(id, type, `${getTypeLabel(type)} #${id}`);
    deactivateAllTools();

    // THUẬT TOÁN BỔ SUNG: Lưu vào Database
    const featureData = {
        name: `Đối tượng ${type} mới`,
        feature_type: type,
        geojson: layer.toGeoJSON()
    };

    try {
        const { error } = await supabaseClient
            .from('web_map_features')
            .insert([featureData]);
        
        if (!error) console.log("✅ Đã lưu đối tượng vẽ vào DB");
    } catch (err) {
        console.error("❌ Lỗi lưu đối tượng:", err);
    }
}); // <-- Dấu đóng hàm được đưa xuống cuối cùng cho đúng cấu trúc

// -------- MEASURE --------
let measurePolyline = null;
let measurePoints = [];
let measureTooltips = [];
let isMeasuring = false;

function startMeasure() {
  isMeasuring = true;
  measurePoints = [];
  window.activeDrawTool = 'measure';
  document.getElementById('tool-measure').classList.add('active');
  map.getContainer().style.cursor = 'crosshair';
  document.getElementById('measure-result').textContent = '📏 Click để bắt đầu đo. Double-click để kết thúc.';
  showNotification('Click để thêm điểm đo. Double-click để kết thúc');

  map.on('click', onMeasureClick);
  map.on('dblclick', onMeasureEnd);
}

function onMeasureClick(e) {
  if (!isMeasuring) return;
  measurePoints.push(e.latlng);

  if (measurePolyline) map.removeLayer(measurePolyline);
  measurePolyline = L.polyline(measurePoints, {
    color: '#f97316',
    weight: 3,
    dashArray: '6,4'
  }).addTo(map);

  // Tooltip tại điểm click
  if (measurePoints.length > 1) {
    const total = calculatePolylineLength(measurePolyline);
    const tt = L.tooltip({ permanent: true, className: 'measure-tooltip', direction: 'top' })
      .setLatLng(e.latlng)
      .setContent(formatDistance(total))
      .addTo(map);
    measureTooltips.push(tt);
    document.getElementById('measure-result').textContent =
      `📏 Tổng: ${formatDistance(total)}`;
  }
}

function onMeasureEnd(e) {
  if (!isMeasuring || measurePoints.length < 2) return;
  map.off('click', onMeasureClick);
  map.off('dblclick', onMeasureEnd);

  const total = calculatePolylineLength(measurePolyline);
  showNotification(`Khoảng cách: ${formatDistance(total)}`);
  deactivateAllTools();
}

function stopMeasure() {
  if (isMeasuring) {
    isMeasuring = false;
    map.off('click', onMeasureClick);
    map.off('dblclick', onMeasureEnd);
    if (measurePolyline) { map.removeLayer(measurePolyline); measurePolyline = null; }
    measureTooltips.forEach(t => map.removeLayer(t));
    measureTooltips = [];
    measurePoints = [];
    document.getElementById('measure-result').textContent = '';
  }
}

// -------- CLEAR --------
document.getElementById('tool-clear').addEventListener('click', function() {
  if (!confirm('Xóa tất cả đối tượng đã vẽ?')) return;
  drawnItems.clearLayers();
  Object.keys(featureMap).forEach(k => delete featureMap[k]);
  featureCount = 0;
  updateFeaturesList();
  stopMeasure();
  showNotification('Đã xóa tất cả đối tượng');
});

// -------- TOOL BUTTONS --------
document.getElementById('tool-marker').addEventListener('click', () => activateTool('marker'));
document.getElementById('tool-polyline').addEventListener('click', () => activateTool('polyline'));
document.getElementById('tool-polygon').addEventListener('click', () => activateTool('polygon'));
document.getElementById('tool-circle').addEventListener('click', () => activateTool('circle'));
document.getElementById('tool-measure').addEventListener('click', () => activateTool('measure'));

// ESC để hủy tool
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') deactivateAllTools();
});

// -------- HELPERS --------
function calculatePolylineLength(polyline) {
  const latlngs = polyline.getLatLngs();
  let total = 0;
  for (let i = 1; i < latlngs.length; i++) {
    total += latlngs[i - 1].distanceTo(latlngs[i]);
  }
  return total;
}

function formatDistance(meters) {
  if (meters >= 1000) return (meters / 1000).toFixed(2) + ' km';
  return Math.round(meters) + ' m';
}

function formatArea(sqm) {
  if (sqm >= 1000000) return (sqm / 1000000).toFixed(3) + ' km²';
  if (sqm >= 10000) return (sqm / 10000).toFixed(2) + ' ha';
  return Math.round(sqm) + ' m²';
}

function getTypeLabel(type) {
  const labels = { marker: '📍 Điểm', polyline: '📏 Đường', polygon: '🔷 Vùng', circle: '⭕ Tròn' };
  return labels[type] || type;
}

function addFeatureToList(id, type, label) {
  const container = document.getElementById('features-list');
  const emptyMsg = container.querySelector('.empty-msg');
  if (emptyMsg) emptyMsg.remove();

  const item = document.createElement('div');
  item.className = 'feature-item';
  item.id = `feat-${id}`;
  item.innerHTML = `
    <div class="feat-info">
      <i class="fa-solid ${getTypeIcon(type)}"></i>
      <span>${label}</span>
    </div>
    <button class="feat-del-btn" onclick="deleteFeature(${id})" title="Xóa">
      <i class="fa-solid fa-times"></i>
    </button>
  `;

  // Click để zoom
  item.querySelector('.feat-info').addEventListener('click', function() {
    const layer = featureMap[id];
    if (layer) {
      if (layer.getLatLng) map.setView(layer.getLatLng(), 15);
      else if (layer.getBounds) map.fitBounds(layer.getBounds(), { padding: [30, 30] });
      layer.openPopup && layer.openPopup();
    }
  });

  container.appendChild(item);
}

function updateFeaturesList() {
  const container = document.getElementById('features-list');
  container.innerHTML = '<p class="empty-msg">Chưa có đối tượng nào</p>';
}

function deleteFeature(id) {
  const layer = featureMap[id];
  if (layer) {
    drawnItems.removeLayer(layer);
    delete featureMap[id];
    const el = document.getElementById(`feat-${id}`);
    if (el) el.remove();
    if (document.getElementById('features-list').children.length === 0) {
      updateFeaturesList();
    }
  }
}

function getTypeIcon(type) {
  const icons = { marker: 'fa-location-dot', polyline: 'fa-minus', polygon: 'fa-vector-square', circle: 'fa-circle' };
  return icons[type] || 'fa-map-pin';
}
