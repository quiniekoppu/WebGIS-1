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
  const coordsEl = document.getElementById('coords');
  if (coordsEl) coordsEl.textContent = `📍 Lat: ${lat} | Lng: ${lng}`;
});

// Cập nhật zoom level
map.on('zoomend', function() {
  const zoomEl = document.getElementById('zoom-level');
  if (zoomEl) zoomEl.textContent = `Zoom: ${map.getZoom()}`;
});

// Click bản đồ để thêm marker nhanh (khi tool marker đang active)
map.on('click', function(e) {
  if (window.activeDrawTool === 'marker') {
    if (typeof addMarker === 'function') addMarker(e.latlng);
  }
});

async function loadSavedLayers() {
    const { data: layers, error } = await supabaseClient
        .from('map_layers')
        .select('*');

    if (error) {
        console.error("Lỗi tải layers:", error);
        return;
    }

    layers.forEach(async (layer) => {
        if (layer.layer_type === 'vector') {
            try {
                const res = await fetch(layer.file_url);
                const geojson = await res.json();
                L.geoJSON(geojson).addTo(map);
            } catch (err) {
                console.error("Lỗi đọc file vector:", err);
            }
        }
    });
}

async function syncDataFromDatabase() {
    try {
        // 1. Tải các đối tượng tự vẽ & bóc tách từ DB
        const { data: features, error: featError } = await supabaseClient
            .from('web_map_features')
            .select('*'); 

        if (featError) {
            console.error("❌ Lỗi tải dữ liệu features:", featError);
        } else if (features && Array.isArray(features)) { // Đảm bảo an toàn features là mảng
            
            // --- THUẬT TOÁN SẮP XẾP AN TOÀN ---
            features.sort((a, b) => {
                try {
                    // Xử lý an toàn nếu dữ liệu geojson bị lưu dạng chuỗi string thay vì JSON object
                    const geoA = typeof a.geojson === 'string' ? JSON.parse(a.geojson) : (a.geojson || {});
                    const geoB = typeof b.geojson === 'string' ? JSON.parse(b.geojson) : (b.geojson || {});
                    
                    const zA = geoA.properties?.zIndex || a.id || 0;
                    const zB = geoB.properties?.zIndex || b.id || 0;
                    return zA - zB; 
                } catch (e) {
                    return 0; // Nếu lỗi parse, giữ nguyên vị trí, không làm sập code
                }
            });

            // Loop qua danh sách ĐÃ SẮP XẾP và vẽ lên map
            features.forEach(f => {
                try {
                    // Parse dữ liệu an toàn
                    const geoData = typeof f.geojson === 'string' ? JSON.parse(f.geojson) : f.geojson;

                    const layerGroup = L.geoJSON(geoData, {
                        style: function(feature) {
                            const color = feature.properties?.customColor || CONFIG.drawColors?.stroke || '#3388ff';
                            return { color: color, fillColor: color, weight: 3, fillOpacity: 0.2 };
                        },
                        pointToLayer: (feature, latlng) => {
                            const color = feature.properties?.customColor || '#e53e3e';
                            return L.circleMarker(latlng, { 
                                radius: 6, color: 'white', weight: 2, fillColor: color, fillOpacity: 1 
                            });
                        }
                    });

                    layerGroup.eachLayer(layer => {
                        layer.feature = layer.feature || geoData; 
                        drawnItems.addLayer(layer);
                        layer.bindPopup(`<strong>${f.name}</strong><br><em>ID: #${f.id}</em>`);
                        
                        const dbId = f.id;
                        if (typeof featureMap !== 'undefined') featureMap[dbId] = layer;

                        if (typeof addFeatureToList === 'function') {
                            addFeatureToList(dbId, f.feature_type, f.name);
                        }

                        if (typeof featureCount !== 'undefined' && dbId > featureCount) {
                            featureCount = dbId;
                        }
                    });
                } catch (err) {
                    console.error("Lỗi xử lý hiển thị đối tượng ID:", f.id, err);
                }
            });
            console.log(`✅ Đã đồng bộ ${features.length} đối tượng vào Catalog.`);
        }

        // 2. Tải các đối tượng điểm kèm ảnh/video thực địa
        const { data: points, error: pointError } = await supabaseClient.from('web_map_points').select('*');
        if (pointError) {
            console.error("❌ Lỗi tải dữ liệu points:", pointError);
        } else if (points && Array.isArray(points)) {
            points.forEach(p => {
                try {
                    const coords = p.geom.replace('POINT(', '').replace(')', '').split(' ');
                    const marker = L.marker([coords[1], coords[0]]).addTo(map);
                    
                    let mediaHTML = '';
                    if (p.image_url) {
                        const isVideo = p.image_url.match(/\.(mp4|webm|ogg)$/i) || p.image_url.includes('/video/upload/');
                        if (isVideo) {
                            mediaHTML = `<br><video src="${p.image_url}" width="200" controls muted style="border-radius:6px; margin-top:8px;"></video>`;
                        } else {
                            mediaHTML = `<br><img src="${p.image_url}" width="200" style="border-radius:6px; margin-top:8px;">`;
                        }
                    }
                    
                    marker.bindPopup(`
                        <div style="text-align:center;">
                            <b style="font-size: 1.1em; color: #2d3748;">${p.name}</b>
                            ${mediaHTML}
                        </div>
                    `, { maxWidth: 220 });

                } catch (err) {
                    console.error("Lỗi parse điểm chụp:", p, err);
                }
            });
        }
    } catch (globalErr) {
        console.error("❌ Lỗi nghiêm trọng trong hàm syncDataFromDatabase:", globalErr);
    }
}

// Gọi hàm sau khi map khởi tạo xong
syncDataFromDatabase();
// Bạn có thể mở comment dòng dưới nếu muốn tự động load cả các Layer Raster/Vector đã lưu
loadSavedLayers();