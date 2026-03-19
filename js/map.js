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

async function loadSavedLayers() {
    // SỬA LỖI: Đồng nhất sử dụng biến supabaseClient
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
                // Tải file GeoJSON từ URL và vẽ lên map
                const res = await fetch(layer.file_url);
                const geojson = await res.json();
                L.geoJSON(geojson).addTo(map);
            } catch (err) {
                console.error("Lỗi đọc file vector:", err);
            }
        } else if (layer.layer_type === 'raster') {
            // Vẽ lại Raster từ URL sử dụng ImageOverlay (Cần thêm logic xử lý ArrayBuffer nếu là file .tif gốc)
            console.log("Tìm thấy lớp Raster lưu trữ:", layer.layer_name);
            // Logic tái hiện Raster sẽ dùng lại hàm loadRaster() bạn đã có nhưng truyền URL thay vì File object
        }
    });
}

async function syncDataFromDatabase() {
    // 1. Tải các đối tượng tự vẽ
    const { data: features } = await supabaseClient.from('web_map_features').select('*');
    if (features) {
        features.forEach(f => {
            L.geoJSON(f.geojson).bindPopup(`<b>${f.name}</b>`).addTo(map);
        });
    }

    // 2. Tải các đối tượng điểm kèm ảnh/video thực địa
    const { data: points } = await supabaseClient.from('web_map_points').select('*');
    if (points) {
        points.forEach(p => {
            try {
                // Chuyển 'POINT(lng lat)' sang [lat, lng]
                const coords = p.geom.replace('POINT(', '').replace(')', '').split(' ');
                const marker = L.marker([coords[1], coords[0]]).addTo(map);
                
                let mediaHTML = '';
                if (p.image_url) {
                    // SỬA LỖI: Thuật toán nhận diện Ảnh hay Video
                    const isVideo = p.image_url.match(/\.(mp4|webm|ogg)$/i) || p.image_url.includes('/video/upload/');
                    
                    if (isVideo) {
                        // Trả về thẻ Video nếu là video
                        mediaHTML = `
                            <br>
                            <video src="${p.image_url}" width="200" controls autoplay muted style="border-radius:6px; margin-top:8px;">
                                Trình duyệt của bạn không hỗ trợ video.
                            </video>
                        `;
                    } else {
                        // Trả về thẻ Img nếu là ảnh
                        mediaHTML = `
                            <br>
                            <img src="${p.image_url}" width="200" style="border-radius:6px; margin-top:8px;">
                        `;
                    }
                }
                
                marker.bindPopup(`
                    <div style="text-align:center;">
                        <b style="font-size: 1.1em; color: #2d3748;">${p.name}</b>
                        ${mediaHTML}
                    </div>
                `, { maxWidth: 220 }); // Set maxWidth để popup không bị vỡ giao diện

            } catch (err) {
                console.error("Lỗi parse điểm:", p, err);
            }
        });
    }
}

// Gọi hàm sau khi map khởi tạo xong
syncDataFromDatabase();
// Bạn có thể mở comment dòng dưới nếu muốn tự động load cả các Layer Raster/Vector đã lưu
loadSavedLayers();