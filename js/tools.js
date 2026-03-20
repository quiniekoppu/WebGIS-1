// ===== TOOLS.JS - Công cụ vẽ, đo đạc và quản lý đối tượng =====

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
async function addMarker(latlng) {
  const id = ++featureCount;
  const marker = L.marker(latlng, {
    icon: L.divIcon({
      className: '',
      html: `<div style="
        width:14px;height:14px;
        background:${CONFIG.drawColors?.stroke || '#e53e3e'};
        border:2px solid white;
        border-radius:50%;
        box-shadow:0 2px 6px rgba(0,0,0,0.3)
      "></div>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7]
    })
  });

  // 1. Hỏi tên Điểm
  let featureName = window.prompt(`Nhập tên cho Điểm vừa đánh dấu:`, `Điểm mới`);
  if (featureName === null) return; // Hủy nếu bấm Cancel
  if (featureName.trim() === "") featureName = `Điểm mới`;

  const popupContent = `
    <strong>📍 ${featureName}</strong><br/>
    Lat: ${latlng.lat.toFixed(5)}<br/>
    Lng: ${latlng.lng.toFixed(5)}
  `;
  marker.bindPopup(popupContent);
  drawnItems.addLayer(marker);

  featureMap[id] = marker;
  addFeatureToList(id, 'marker', featureName);
  deactivateAllTools();

  // 2. Lưu vào Database
  const featureData = {
      name: featureName,
      feature_type: 'marker',
      geojson: marker.toGeoJSON()
  };

  try {
      const { error } = await supabaseClient
          .from('web_map_features')
          .insert([featureData]);
      
      if (!error) {
          console.log("✅ Đã lưu Điểm vào DB");
          if (typeof showNotification === 'function') showNotification('Đã lưu Điểm vào cơ sở dữ liệu!');
      } else {
          throw error;
      }
  } catch (err) {
      console.error("❌ Lỗi lưu Điểm:", err);
      alert("Lỗi: Không thể lưu Điểm vào CSDL.");
  }
}

// -------- ACTIVATE TOOL --------
function activateTool(toolName) {
  // Tắt tool hiện tại
  deactivateAllTools();

  if (toolName === 'marker') {
    window.activeDrawTool = 'marker';
    document.getElementById('tool-marker').classList.add('active');
    map.getContainer().style.cursor = 'crosshair';
    if (typeof showNotification === 'function') showNotification('Click lên bản đồ để đặt điểm');
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

    let featureName = window.prompt(`Nhập tên cho đối tượng ${getTypeLabel(type)} vừa vẽ:`, `Đối tượng ${type} mới`);
    if (featureName === null) {
        drawnItems.removeLayer(layer);
        return; 
    }
    if (featureName.trim() === "") featureName = `Đối tượng ${type} mới`;

    let info = `<strong>${featureName}</strong><br/>`;
    let geojson; // Khai báo biến chứa dữ liệu

    if (type === 'polyline') {
      const dist = calculatePolylineLength(layer);
      info += `Độ dài: <b>${formatDistance(dist)}</b>`;
      geojson = layer.toGeoJSON();
    } else if (type === 'polygon') {
      const area = L.GeometryUtil.geodesicArea(layer.getLatLngs()[0]);
      info += `Diện tích: <b>${formatArea(area)}</b>`;
      geojson = layer.toGeoJSON();
    } else if (type === 'circle') {
      const r = layer.getRadius();
      info += `Bán kính: <b>${formatDistance(r)}</b>`;
      
      // Chuyển hình tròn thành Đa giác
      geojson = generateCirclePolygonGeoJSON(layer.getLatLng(), r);
      geojson.properties = geojson.properties || {};
      geojson.properties.isCircle = true; 
      geojson.properties.radius = r;
    }

    // 🔥 QUAN TRỌNG: Gắn cứng dữ liệu vào layer để không bị hàm mặc định ghi đè
    layer.feature = geojson;

    layer.bindPopup(info);
    layer.openPopup();

    featureMap[id] = layer;
    addFeatureToList(id, type, featureName);
    deactivateAllTools();

    const featureData = {
        name: featureName,
        feature_type: type === 'circle' ? 'polygon' : type,
        geojson: geojson
    };

    try {
        const { error } = await supabaseClient.from('web_map_features').insert([featureData]);
        if (!error) {
            console.log(`✅ Đã lưu ${featureData.feature_type} vào DB`);
            if (typeof showNotification === 'function') showNotification('Đã lưu vào cơ sở dữ liệu!');
        } else throw error;
    } catch (err) { console.error("❌ Lỗi lưu đối tượng:", err); }
});

// -------- MEASURE (ĐO ĐẠC KHOẢNG CÁCH) --------
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
  if (typeof showNotification === 'function') showNotification('Click để thêm điểm đo. Double-click để kết thúc');

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
  if (typeof showNotification === 'function') showNotification(`Khoảng cách: ${formatDistance(total)}`);
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

// -------- CLEAR (NÂNG CẤP: XÓA TẤT CẢ TỪ DB) --------
document.getElementById('tool-clear').addEventListener('click', async function() {
  if (!confirm('⚠️ NGUY HIỂM: Bạn có chắc chắn muốn xóa TẤT CẢ đối tượng đã vẽ khỏi Database? Hành động này không thể hoàn tác!')) return;
  
  try {
    const { error } = await supabaseClient
      .from('web_map_features')
      .delete()
      .gt('id', 0); 

    if (error) throw error;

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

// -------- TOOL BUTTONS BINDING --------
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

function getTypeIcon(type) {
  const icons = { marker: 'fa-location-dot', polyline: 'fa-minus', polygon: 'fa-vector-square', circle: 'fa-circle' };
  return icons[type] || 'fa-map-pin';
}

function updateFeaturesList() {
  const container = document.getElementById('features-list');
  container.innerHTML = '<p class="empty-msg">Chưa có đối tượng nào</p>';
}

// -------- HIỂN THỊ SIDEBAR --------
function addFeatureToList(id, type, label) {
  const container = document.getElementById('features-list');
  const emptyMsg = container.querySelector('.empty-msg');
  if (emptyMsg) emptyMsg.remove();

  let currentColor = '#3388ff'; 
  let isVisible = true; 

  const layer = featureMap[id];
  if (layer && layer.feature && layer.feature.properties) {
      if (layer.feature.properties.customColor) currentColor = layer.feature.properties.customColor;
      if (layer.feature.properties.isVisible === false) isVisible = false; 
  } else if (type === 'marker') {
      currentColor = '#e53e3e';
  }

  const eyeIcon = isVisible ? 'fa-eye' : 'fa-eye-slash';
  const eyeColor = isVisible ? '#4a5568' : '#a0aec0';

  const item = document.createElement('div');
  item.className = 'feature-item';
  item.id = `feat-${id}`;
  item.draggable = true; // BẬT TÍNH NĂNG KÉO THẢ
  item.style.display = 'flex';
  item.style.justifyContent = 'space-between';
  item.style.alignItems = 'center';
  
  // --- TÌM ĐOẠN item.innerHTML = `...` TRONG HÀM addFeatureToList VÀ THAY BẰNG ĐOẠN NÀY ---
  item.innerHTML = `
    <div style="display:flex; align-items:center; flex:1;">
        <div class="feat-drag-handle" style="color: #cbd5e0; padding-right: 12px; cursor: grab;">
          <i class="fa-solid fa-grip-vertical"></i>
        </div>
        <div class="feat-info" style="cursor:pointer; opacity: ${isVisible ? '1' : '0.5'}; transition: 0.3s;" id="feat-info-${id}">
          <i class="fa-solid ${getTypeIcon(type)}"></i>
          <span>${label}</span>
        </div>
    </div>

    <div class="feat-actions" style="display: flex; gap: 8px; align-items: center;">
      <button class="feat-action-btn" onclick="reprojectFeature(${id})" title="Chuyển tọa độ (VN2000 -> WGS84)" style="background:none; border:none; cursor:pointer; color:#d69e2e;">
        <i class="fa-solid fa-satellite-dish"></i>
      </button>

      <button class="feat-action-btn" onclick="toggleFeatureVisibility(${id})" title="Ẩn/Hiện layer" style="background:none; border:none; cursor:pointer; color:${eyeColor};" id="toggle-btn-${id}">
        <i class="fa-solid ${eyeIcon}"></i>
      </button>
      <input type="color" value="${currentColor}" 
             style="border:none; width:24px; height:24px; cursor:pointer; padding:0; background:transparent;" 
             onchange="changeFeatureColor(${id}, this.value, '${type}')" 
             title="Đổi màu sắc">
      <button class="feat-del-btn" onclick="deleteFeature(${id})" title="Xóa" style="border:none; background:none; cursor:pointer; color:#e53e3e;">
        <i class="fa-solid fa-times"></i>
      </button>
    </div>
  `;

  // --- SỰ KIỆN KÉO THẢ CHO TỪNG ITEM ---
  item.addEventListener('dragstart', () => {
      item.classList.add('dragging');
      item.style.opacity = '0.4'; // Làm mờ khi đang kéo
  });

  item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      item.style.opacity = '1';
      // KHI THẢ CHUỘT RA: Gọi hàm tính toán lại vị trí và lưu DB
      updateOrderAfterDrag();
  });

  item.querySelector('.feat-info').addEventListener('click', function() {
    if (layer && drawnItems.hasLayer(layer)) {
      if (layer.getLatLng) map.setView(layer.getLatLng(), 15);
      else if (layer.getBounds) map.fitBounds(layer.getBounds(), { padding: [30, 30] });
      layer.openPopup && layer.openPopup();
    }
  });

  container.insertBefore(item, container.firstChild);
}

// -------- LOGIC XÓA ĐỐI TƯỢNG TỪ DB --------
async function deleteFeature(id) {
  if (!confirm('Bạn có chắc chắn muốn xóa đối tượng này khỏi bản đồ và Cơ sở dữ liệu?')) return;

  try {
    const { error } = await supabaseClient
      .from('web_map_features')
      .delete()
      .eq('id', id);

    if (error) throw error;

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
    }
  } catch (err) {
    console.error("❌ Lỗi khi xóa đối tượng:", err);
    alert("Lỗi: Không thể xóa đối tượng khỏi cơ sở dữ liệu.");
  }
}

// -------- LOGIC ĐỔI MÀU & LƯU DB --------
async function changeFeatureColor(id, newColor, type) {
    const layer = featureMap[id];
    if (!layer) return;

    if (layer.setStyle) {
        layer.setStyle({ color: newColor, fillColor: newColor });
    } else if (type === 'marker' && layer.setIcon) {
        // Cập nhật icon marker
        layer.setIcon(L.divIcon({
            className: '',
            html: `<div style="width:14px;height:14px;background:${newColor};border:2px solid white;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,0.3)"></div>`,
            iconSize: [14, 14], iconAnchor: [7, 7]
        }));
    }

    // 🔥 Ưu tiên lấy dữ liệu đã nhớ thay vì tạo lại
    const geojson = layer.feature || layer.toGeoJSON();
    geojson.properties = geojson.properties || {};
    geojson.properties.customColor = newColor; 
    layer.feature = geojson; // Cập nhật lại vào bộ nhớ

    try {
        await supabaseClient.from('web_map_features').update({ geojson: geojson }).eq('id', id);
    } catch (err) { console.error("❌ Lỗi cập nhật màu:", err); }
}

// -------- LOGIC ĐƯA LÊN TRÊN & LƯU DB --------
async function bringFeatureToFront(id) {
    const layer = featureMap[id];
    if (!layer || !layer.bringToFront) return;

    layer.bringToFront();

    const item = document.getElementById(`feat-${id}`);
    const list = document.getElementById('features-list');
    if (item && list) list.insertBefore(item, list.firstChild);

    try {
        const geojson = layer.toGeoJSON();
        geojson.properties = geojson.properties || {};
        geojson.properties.zIndex = Date.now(); 

        await supabaseClient.from('web_map_features').update({ geojson: geojson }).eq('id', id);
    } catch(e) { console.error("Lỗi lưu zIndex:", e); }
}

// -------- LOGIC ĐƯA XUỐNG DƯỚI & LƯU DB --------
async function sendFeatureToBack(id) {
    const layer = featureMap[id];
    if (!layer || !layer.bringToBack) return;
    
    layer.bringToBack();

    const item = document.getElementById(`feat-${id}`);
    const list = document.getElementById('features-list');
    if (item && list) list.appendChild(item);
    
    try {
        const geojson = layer.toGeoJSON();
        geojson.properties = geojson.properties || {};
        geojson.properties.zIndex = -Date.now(); 

        await supabaseClient.from('web_map_features').update({ geojson: geojson }).eq('id', id);
    } catch(e) { console.error("Lỗi lưu zIndex:", e); }
}

// -------- LOGIC ẨN/HIỆN & LƯU DB --------
async function toggleFeatureVisibility(id) {
    const layer = featureMap[id];
    if (!layer) return;

    const btn = document.getElementById(`toggle-btn-${id}`);
    const icon = btn.querySelector('i');
    const infoText = document.getElementById(`feat-info-${id}`);
    const isCurrentlyVisible = drawnItems.hasLayer(layer);

    if (isCurrentlyVisible) {
        drawnItems.removeLayer(layer);
        icon.classList.replace('fa-eye', 'fa-eye-slash');
        btn.style.color = '#a0aec0'; infoText.style.opacity = '0.5';
    } else {
        drawnItems.addLayer(layer);
        icon.classList.replace('fa-eye-slash', 'fa-eye');
        btn.style.color = '#4a5568'; infoText.style.opacity = '1';
    }

    // 🔥 Ưu tiên lấy dữ liệu đã nhớ
    const geojson = layer.feature || layer.toGeoJSON();
    geojson.properties = geojson.properties || {};
    geojson.properties.isVisible = !isCurrentlyVisible; 
    layer.feature = geojson;

    try {
        await supabaseClient.from('web_map_features').update({ geojson: geojson }).eq('id', id);
    } catch(e) { console.error("Lỗi lưu trạng thái Ẩn/Hiện:", e); }
}

// -------- HÀM BỔ TRỢ: CHUYỂN HÌNH TRÒN THÀNH ĐA GIÁC (POLYGON) --------
function generateCirclePolygonGeoJSON(center, radiusMeters, numSegments = 64) {
    const coords = [];
    const earthRadius = 6378137; // Bán kính trái đất tính bằng mét
    const pi = Math.PI;

    // Đổi vĩ độ, kinh độ sang Radian
    const lat0 = center.lat * pi / 180;
    const lng0 = center.lng * pi / 180;

    // Tính toán tọa độ của 64 đỉnh bao quanh hình tròn
    for (let i = 0; i < numSegments; i++) {
        const angle = (360 / numSegments * i) * pi / 180;
        const dx = radiusMeters * Math.cos(angle);
        const dy = radiusMeters * Math.sin(angle);

        const lat = lat0 + (dy / earthRadius);
        const lng = lng0 + (dx / (earthRadius * Math.cos(lat0)));

        // Đổi lại sang Degree và push vào mảng [lng, lat]
        coords.push([lng * 180 / pi, lat * 180 / pi]);
    }
    
    // Điểm cuối cùng phải trùng với điểm đầu tiên để khép kín vùng Polygon
    coords.push(coords[0]); 

    return {
        type: "Feature",
        geometry: {
            type: "Polygon",
            coordinates: [coords]
        },
        properties: {}
    };
}

// ===================================================================
// NÂNG CẤP KÉO THẢ: VÙNG CHỨA ITEM VÀ ĐỒNG BỘ Z-INDEX XUỐNG DATABASE
// ===================================================================

const featuresListContainer = document.getElementById('features-list');
if (featuresListContainer) {
    // Xử lý hiệu ứng chèn item khi đang di chuột kéo
    featuresListContainer.addEventListener('dragover', e => {
        e.preventDefault(); // Cho phép thả
        const afterElement = getDragAfterElement(featuresListContainer, e.clientY);
        const draggable = document.querySelector('.dragging');
        if (draggable) {
            if (afterElement == null) {
                featuresListContainer.appendChild(draggable);
            } else {
                featuresListContainer.insertBefore(draggable, afterElement);
            }
        }
    });
}

// Hàm tính toán xem vị trí chuột đang nằm trên hay dưới phần tử nào
function getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.feature-item:not(.dragging)')];
    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

// --- THUẬT TOÁN ĐỒNG BỘ: Tính toán lại Z-Index và lưu hàng loạt ---
async function updateOrderAfterDrag() {
    const items = document.querySelectorAll('.feature-item');
    const updatePromises = [];

    // Lặp danh sách TỪ DƯỚI LÊN TRÊN để set thứ tự Z-Index (Layer ở trên cùng = list.firstChild)
    const reversedItems = Array.from(items).reverse();
    
    reversedItems.forEach((item, index) => {
        const id = parseInt(item.id.replace('feat-', ''));
        const layer = featureMap[id];
        
        if (layer) {
            const newZIndex = index * 10; // Đáy = 0, càng lên trên Z-Index càng to (10, 20, 30...)

            // 1. Thay đổi thứ tự trực tiếp trên Map
            if (layer.bringToFront) {
                layer.bringToFront(); // Vector (Polyline, Polygon, Circle)
            }
            if (layer.setZIndexOffset) {
                layer.setZIndexOffset(newZIndex); // Marker (Điểm)
            }

            // 2. Chèn thuộc tính Z-Index mới vào GeoJSON
            const geojson = layer.feature || layer.toGeoJSON();
            geojson.properties = geojson.properties || {};
            geojson.properties.zIndex = newZIndex;
            layer.feature = geojson; // Cập nhật tham chiếu local

            // 3. Đưa vào mảng Promise để chạy lưu Database hàng loạt
            updatePromises.push(
                supabaseClient.from('web_map_features').update({ geojson: geojson }).eq('id', id)
            );
        }
    });

    // 4. Chạy lưu hàng loạt vào Supabase
    try {
        if (updatePromises.length > 0) {
            await Promise.all(updatePromises);
            console.log("✅ Đã cập nhật toàn bộ thứ tự Z-Index sau khi kéo thả!");
        }
    } catch (err) {
        console.error("❌ Lỗi khi đồng bộ Z-Index:", err);
    }
}

// ===================================================================
// THUẬT TOÁN CHUYỂN ĐỔI HỆ TỌA ĐỘ (CÓ AUTO-DETECT EPSG)
// ===================================================================

async function reprojectFeature(id) {
    const layer = featureMap[id];
    if (!layer) return;

    // Lấy dữ liệu GeoJSON hiện tại
    const geojson = layer.feature || layer.toGeoJSON();
    let suggestedEpsg = "3405"; // Mặc định gợi ý VN2000

    // --- TỰ ĐỘNG XÁC ĐỊNH HỆ TỌA ĐỘ (AUTO-DETECT) ---
    // 1. Đọc từ metadata thuộc tính "crs" của file GeoJSON (nếu phần mềm QGIS/ArcGIS có lưu)
    if (geojson.crs && geojson.crs.properties && geojson.crs.properties.name) {
        const crsName = geojson.crs.properties.name;
        const match = crsName.match(/EPSG::(\d+)/) || crsName.match(/EPSG:(\d+)/);
        if (match) suggestedEpsg = match[1];
    } else {
        // 2. Quét thông minh qua tọa độ: Nếu kinh độ 100-110, vĩ độ 8-24 -> Khả năng cao đã là WGS84
        const coords = geojson.geometry?.coordinates;
        let sample = coords;
        // Đào sâu vào mảng để lấy 1 cặp tọa độ [X, Y] đầu tiên
        while (sample && sample.length > 0 && Array.isArray(sample[0])) sample = sample[0];
        
        if (sample && sample.length >= 2) {
            const x = sample[0];
            const y = sample[1];
            // Nếu X nằm trong khoảng -180 đến 180 và Y nằm trong khoảng -90 đến 90
            if (x >= -180 && x <= 180 && y >= -90 && y <= 90) {
                suggestedEpsg = "4326";
            }
        }
    }

    // Chặn lại nếu dữ liệu đã là WGS84 chuẩn
    if (suggestedEpsg === "4326") {
        alert("Dữ liệu này đã ở hệ tọa độ chuẩn WGS84 (EPSG:4326) hoặc tọa độ hợp lệ, không cần chuyển đổi nữa.");
        return;
    }

    // 3. Hỏi người dùng xác nhận lại mã hệ thống đã nhận diện
    const epsgCode = prompt(
        "Hệ thống tự động nhận diện mã EPSG gốc của dữ liệu này là:\n(Bạn có thể sửa lại nếu thấy hệ thống đoán chưa đúng)", 
        suggestedEpsg
    );
    
    if (!epsgCode) return; // Hủy nếu người dùng bấm Cancel

    try {
        if (typeof showNotification === 'function') showNotification('⏳ Đang tải thuật toán tọa độ...');

        const res = await fetch(`https://epsg.io/${epsgCode}.proj4`);
        if (!res.ok) throw new Error(`Không tìm thấy mã EPSG:${epsgCode} trên hệ thống quốc tế.`);
        const proj4String = await res.text();

        proj4.defs(`EPSG:${epsgCode}`, proj4String);

        // Hàm đệ quy chuyển đổi tọa độ
        function transformCoords(coords) {
            if (typeof coords[0] === 'number') {
                const transformed = proj4(`EPSG:${epsgCode}`, 'EPSG:4326', [coords[0], coords[1]]);
                return [transformed[0], transformed[1]];
            } else {
                return coords.map(c => transformCoords(c));
            }
        }

        if (geojson.geometry && geojson.geometry.coordinates) {
            geojson.geometry.coordinates = transformCoords(geojson.geometry.coordinates);
        }

        // Cập nhật lên bản đồ
        drawnItems.removeLayer(layer);
        
        const newLayerGroup = L.geoJSON(geojson, {
            style: function(feature) {
                const color = feature.properties?.customColor || CONFIG.drawColors?.stroke || '#3388ff';
                return { color: color, fillColor: color, weight: 3, fillOpacity: 0.2 };
            },
            pointToLayer: (feature, latlng) => {
                const color = feature.properties?.customColor || '#e53e3e';
                return L.circleMarker(latlng, { radius: 6, color: 'white', weight: 2, fillColor: color, fillOpacity: 1 });
            }
        });

        let newLayer;
        newLayerGroup.eachLayer(l => newLayer = l); 
        
        if (!newLayer) throw new Error("Lỗi tái tạo hình học sau khi tính toán.");

        newLayer.feature = geojson;
        if (layer.getPopup()) newLayer.bindPopup(layer.getPopup().getContent());
        
        drawnItems.addLayer(newLayer);
        featureMap[id] = newLayer; 

        if (newLayer.getBounds) map.fitBounds(newLayer.getBounds(), { padding: [30, 30] });
        else if (newLayer.getLatLng) map.setView(newLayer.getLatLng(), 15);

        // Lưu DB
        const { error } = await supabaseClient.from('web_map_features').update({ geojson: geojson }).eq('id', id);
        if (error) throw error;

        if (typeof showNotification === 'function') showNotification(`✅ Đã bay về chuẩn WGS84 thành công!`);

    } catch (error) {
        console.error("Lỗi chuyển tọa độ:", error);
        alert("Lỗi: " + error.message);
    }
}