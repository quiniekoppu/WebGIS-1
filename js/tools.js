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
// -------- DRAW EVENTS --------
map.on(L.Draw.Event.CREATED, async function (e) {
    const id = ++featureCount;
    const type = e.layerType;
    const layer = e.layer;
    
    drawnItems.addLayer(layer);

    // --- [NÂNG CẤP 1] Yêu cầu người dùng nhập tên trước khi lưu ---
    let featureName = window.prompt(`Nhập tên cho đối tượng ${getTypeLabel(type)} vừa vẽ:`, `Đối tượng ${type} mới`);
    
    // Nếu người dùng bấm Cancel, bỏ qua không lưu
    if (featureName === null) {
        drawnItems.removeLayer(layer); // Xóa hình vừa vẽ khỏi bản đồ
        return; 
    }
    // Nếu để trống tên, dùng tên mặc định
    if (featureName.trim() === "") featureName = `Đối tượng ${type} mới`;

    // Cập nhật Popup với tên vừa nhập
    let info = `<strong>${featureName}</strong><br/>`;
    
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
    addFeatureToList(id, type, featureName); // Đưa tên lên danh sách sidebar
    deactivateAllTools();

    // --- [NÂNG CẤP 2] Lưu vào Database với tên chuẩn ---
    const featureData = {
        name: featureName,
        feature_type: type,
        geojson: layer.toGeoJSON()
    };

    try {
        const { error } = await supabaseClient
            .from('web_map_features')
            .insert([featureData]);
        
        if (!error) {
            console.log("✅ Đã lưu đối tượng vẽ vào DB");
            // Hiển thị thông báo nhỏ nếu bạn có hàm showNotification
            if (typeof showNotification === 'function') showNotification('Đã lưu vào cơ sở dữ liệu!');
        } else {
            throw error;
        }
    } catch (err) {
        console.error("❌ Lỗi lưu đối tượng:", err);
        alert("Lỗi: Không thể lưu đối tượng vào CSDL.");
    }
});

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
document.getElementById('tool-clear').addEventListener('click', async function() {
  if (!confirm('⚠️ NGUY HIỂM: Bạn có chắc chắn muốn xóa TẤT CẢ đối tượng đã vẽ khỏi Database? Hành động này không thể hoàn tác!')) return;
  
  try {
    // Gửi lệnh xóa toàn bộ dữ liệu trong bảng web_map_features
    // Dùng gt('id', 0) nghĩa là xóa mọi dòng có id > 0
    const { error } = await supabaseClient
      .from('web_map_features')
      .delete()
      .gt('id', 0); 

    if (error) throw error;

    // Làm sạch giao diện
    drawnItems.clearLayers();
    Object.keys(featureMap).forEach(k => delete featureMap[k]);
    featureCount = 0;
    updateFeaturesList();
    stopMeasure();
    
    console.log("✅ Đã dọn dẹp toàn bộ dữ liệu vẽ trong Database");
    if (typeof showNotification === 'function') showNotification('Đã xóa tất cả đối tượng khỏi Database');
  } catch (err) {
    console.error("❌ Lỗi khi xóa tất cả:", err);
    alert("Lỗi: Không thể xóa toàn bộ dữ liệu.");
  }
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

// --- NÂNG CẤP: XÓA ĐỐI TƯỢNG ĐỒNG BỘ VỚI DATABASE ---
async function deleteFeature(id) {
  // 1. Hỏi xác nhận trước khi xóa (tránh click nhầm)
  if (!confirm('Bạn có chắc chắn muốn xóa đối tượng này khỏi bản đồ và Cơ sở dữ liệu?')) return;

  try {
    // 2. Gửi lệnh Xóa xuống Supabase dựa vào ID
    const { error } = await supabaseClient
      .from('web_map_features')
      .delete()
      .eq('id', id); // Tìm đúng cột id trong bảng để xóa

    if (error) throw error;

    // 3. Nếu DB xóa thành công, tiến hành xóa trên giao diện
    const layer = featureMap[id];
    if (layer) {
      drawnItems.removeLayer(layer);
      delete featureMap[id];
      
      const el = document.getElementById(`feat-${id}`);
      if (el) el.remove();
      
      if (document.getElementById('features-list').children.length === 0) {
        updateFeaturesList();
      }
      
      console.log(`✅ Đã xóa đối tượng #${id} khỏi Database`);
      if (typeof showNotification === 'function') showNotification('Đã xóa thành công!');
    }
  } catch (err) {
    console.error("❌ Lỗi khi xóa đối tượng:", err);
    alert("Lỗi: Không thể xóa đối tượng khỏi cơ sở dữ liệu.");
  }
}

function getTypeIcon(type) {
  const icons = { marker: 'fa-location-dot', polyline: 'fa-minus', polygon: 'fa-vector-square', circle: 'fa-circle' };
  return icons[type] || 'fa-map-pin';
}

// --- NÂNG CẤP GIAO DIỆN: Thêm nút chọn màu vào Sidebar ---
// --- NÂNG CẤP GIAO DIỆN: Thêm nút Đưa lên/Đưa xuống ---
function addFeatureToList(id, type, label) {
  const container = document.getElementById('features-list');
  const emptyMsg = container.querySelector('.empty-msg');
  if (emptyMsg) emptyMsg.remove();

  let currentColor = '#3388ff'; 
  const layer = featureMap[id];
  if (layer && layer.feature && layer.feature.properties && layer.feature.properties.customColor) {
      currentColor = layer.feature.properties.customColor;
  } else if (type === 'marker') {
      currentColor = '#e53e3e';
  }

  const item = document.createElement('div');
  item.className = 'feature-item';
  item.id = `feat-${id}`;
  item.style.display = 'flex';
  item.style.justifyContent = 'space-between';
  item.style.alignItems = 'center';
  
  item.innerHTML = `
    <div class="feat-info" style="cursor:pointer; flex: 1;">
      <i class="fa-solid ${getTypeIcon(type)}"></i>
      <span>${label}</span>
    </div>
    <div class="feat-actions" style="display: flex; gap: 8px; align-items: center;">
      <button class="feat-action-btn" onclick="bringFeatureToFront(${id})" title="Đưa lên trên cùng" style="background:none; border:none; cursor:pointer; color:#4a5568;">
        <i class="fa-solid fa-arrow-up"></i>
      </button>
      
      <button class="feat-action-btn" onclick="sendFeatureToBack(${id})" title="Đưa xuống dưới cùng" style="background:none; border:none; cursor:pointer; color:#4a5568;">
        <i class="fa-solid fa-arrow-down"></i>
      </button>

      <input type="color" value="${currentColor}" 
             style="border:none; width:24px; height:24px; cursor:pointer; padding:0; background:transparent;" 
             onchange="changeFeatureColor(${id}, this.value, '${type}')" 
             title="Đổi màu sắc">
      <button class="feat-del-btn" onclick="deleteFeature(${id})" title="Xóa">
        <i class="fa-solid fa-times"></i>
      </button>
    </div>
  `;

  item.querySelector('.feat-info').addEventListener('click', function() {
    if (layer) {
      if (layer.getLatLng) map.setView(layer.getLatLng(), 15);
      else if (layer.getBounds) map.fitBounds(layer.getBounds(), { padding: [30, 30] });
      layer.openPopup && layer.openPopup();
    }
  });

  // Khi thêm mới, luôn chèn vào đầu danh sách (vì nó nằm trên cùng của map)
  container.insertBefore(item, container.firstChild);
}function addFeatureToList(id, type, label) {
  const container = document.getElementById('features-list');
  const emptyMsg = container.querySelector('.empty-msg');
  if (emptyMsg) emptyMsg.remove();

  // Tìm màu hiện tại nếu đã có trong GeoJSON, nếu chưa thì dùng màu mặc định
  let currentColor = '#3388ff'; 
  const layer = featureMap[id];
  if (layer && layer.feature && layer.feature.properties && layer.feature.properties.customColor) {
      currentColor = layer.feature.properties.customColor;
  } else if (type === 'marker') {
      currentColor = '#e53e3e';
  }

  const item = document.createElement('div');
  item.className = 'feature-item';
  item.id = `feat-${id}`;
  item.style.display = 'flex';
  item.style.justifyContent = 'space-between';
  item.style.alignItems = 'center';
  
  item.innerHTML = `
    <div class="feat-info" style="cursor:pointer; flex: 1;">
      <i class="fa-solid ${getTypeIcon(type)}"></i>
      <span>${label}</span>
    </div>
    <div class="feat-actions" style="display: flex; gap: 8px; align-items: center;">
      <input type="color" value="${currentColor}" 
             style="border:none; width:24px; height:24px; cursor:pointer; padding:0; background:transparent;" 
             onchange="changeFeatureColor(${id}, this.value, '${type}')" 
             title="Đổi màu sắc">
      <button class="feat-del-btn" onclick="deleteFeature(${id})" title="Xóa">
        <i class="fa-solid fa-times"></i>
      </button>
    </div>
  `;

  // Click để zoom
  item.querySelector('.feat-info').addEventListener('click', function() {
    if (layer) {
      if (layer.getLatLng) map.setView(layer.getLatLng(), 15);
      else if (layer.getBounds) map.fitBounds(layer.getBounds(), { padding: [30, 30] });
      layer.openPopup && layer.openPopup();
    }
  });

  container.appendChild(item);
}

// --- NÂNG CẤP LOGIC: Đưa đối tượng lên trên cùng ---
async function bringFeatureToFront(id) {
    const layer = featureMap[id];
    if (!layer || !layer.bringToFront) return;

    // 1. Đưa layer lên trên cùng của bản đồ
    layer.bringToFront();

    // 2. Đẩy phần tử HTML lên ĐẦU danh sách Sidebar
    const item = document.getElementById(`feat-${id}`);
    const list = document.getElementById('features-list');
    if (item && list) list.insertBefore(item, list.firstChild);

    // 3. Cập nhật chỉ số zIndex (dùng thời gian thực để làm số lớn nhất) và lưu DB
    try {
        const geojson = layer.toGeoJSON();
        geojson.properties = geojson.properties || {};
        geojson.properties.zIndex = Date.now(); // Càng lưu muộn, số càng to -> Càng nằm trên

        await supabaseClient.from('web_map_features').update({ geojson: geojson }).eq('id', id);
    } catch(e) { console.error("Lỗi lưu zIndex:", e); }
}

// --- NÂNG CẤP LOGIC: Đưa đối tượng xuống dưới cùng ---
async function sendFeatureToBack(id) {
    const layer = featureMap[id];
    if (!layer || !layer.bringToBack) return;

    // 1. Đưa layer xuống dưới cùng của bản đồ
    layer.bringToBack();

    // 2. Đẩy phần tử HTML xuống CUỐI danh sách Sidebar
    const item = document.getElementById(`feat-${id}`);
    const list = document.getElementById('features-list');
    if (item && list) list.appendChild(item);

    // 3. Cập nhật chỉ số zIndex (số âm để nằm dưới cùng) và lưu DB
    try {
        const geojson = layer.toGeoJSON();
        geojson.properties = geojson.properties || {};
        geojson.properties.zIndex = -Date.now(); // Số âm càng nhỏ -> Càng nằm dưới

        await supabaseClient.from('web_map_features').update({ geojson: geojson }).eq('id', id);
    } catch(e) { console.error("Lỗi lưu zIndex:", e); }
}
