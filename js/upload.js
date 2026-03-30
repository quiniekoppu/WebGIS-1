// ===== UPLOAD.JS - Upload Vector (GeoJSON) + Raster (GeoTIFF) + Image/Video to Cloud =====

// 1. -------- QUẢN LÝ TAB UPLOAD --------
document.querySelectorAll('.upload-tab').forEach(tab => {
    tab.addEventListener('click', function() {
        document.querySelectorAll('.upload-tab').forEach(t => t.classList.remove('active'));
        this.classList.add('active');
        const target = this.dataset.tab;
        document.querySelectorAll('.upload-tab-content').forEach(c => c.classList.add('hidden'));
        document.getElementById(`tab-${target}`).classList.remove('hidden');
    });
});

// 2. -------- BIẾN TOÀN CỤC CHO LỚP DỮ LIỆU --------
let uploadedVectorLayer = null;
let currentRasterLayer = null;

const geojsonInput = document.getElementById('geojson-upload');
const uploadInfo = document.getElementById('upload-info');
const rasterInput = document.getElementById('raster-upload');
const rasterInfo = document.getElementById('raster-info');
const rasterControls = document.getElementById('raster-controls');
const rasterOpacity = document.getElementById('raster-opacity');
const opacityVal = document.getElementById('opacity-val');

// ===================================================================
// 3. VECTOR - XỬ LÝ FILE GEOJSON/KML/SHAPEFILE VÀ BÓC TÁCH LƯU VÀO DB
// ===================================================================
geojsonInput.addEventListener('change', async function(e) {
    const file = e.target.files[0];
    if (!file) return;

    const ext = file.name.split('.').pop().toLowerCase();
    const allowedExts = ['geojson', 'json', 'kml', 'zip'];

    if (!allowedExts.includes(ext)) {
        uploadInfo.innerHTML = '<span style="color:#e53e3e">⚠ Chỉ hỗ trợ .geojson, .json, .kml hoặc .zip (Shapefile)</span>';
        return;
    }

    uploadInfo.innerHTML = `<div style="color:#d69e2e;font-size:0.8rem">⏳ Đang đọc và phiên dịch file <strong>${file.name}</strong>...</div>`;

    // Lưu trữ nguyên file gốc lên Storage để backup
    if (typeof saveLayerToSupabase === 'function') {
        saveLayerToSupabase(file, 'vector');
    }

    try {
        let geojson = null;

        // --- THUẬT TOÁN PHIÊN DỊCH ĐA ĐỊNH DẠNG ---
        if (ext === 'geojson' || ext === 'json') {
            const text = await file.text();
            geojson = JSON.parse(text);
        } 
        else if (ext === 'kml') {
            const text = await file.text();
            const dom = new DOMParser().parseFromString(text, 'text/xml');
            geojson = toGeoJSON.kml(dom); // Dùng thư viện togeojson
        } 
        else if (ext === 'zip') {
            const buffer = await file.arrayBuffer();
            geojson = await shp(buffer); // Dùng thư viện shpjs giải nén và đọc Shapefile
            
            // Xử lý trường hợp 1 file zip chứa nhiều layer shapefile bên trong
            if (Array.isArray(geojson)) {
                let combinedFeatures = [];
                geojson.forEach(g => combinedFeatures = combinedFeatures.concat(g.features || []));
                geojson = { type: "FeatureCollection", features: combinedFeatures };
            }
        }

        if (!geojson || !geojson.features) throw new Error("Dữ liệu không hợp lệ hoặc rỗng.");

        if (uploadedVectorLayer) map.removeLayer(uploadedVectorLayer);

        // --- THUẬT TOÁN BÓC TÁCH & LƯU VÀO DB (Đã làm ở bài trước) ---
        if (geojson.features.length > 0) {
            const confirmSave = confirm(`Tìm thấy ${geojson.features.length} đối tượng từ file ${ext.toUpperCase()}. Bạn có muốn bóc tách và lưu tất cả vào Database không?`);
            
            if (confirmSave) {
                uploadInfo.innerHTML = `<div style="color:#d69e2e;font-size:0.8rem">⏳ Đang lưu ${geojson.features.length} đối tượng vào Database...</div>`;
                
                const insertData = geojson.features.map((feat, index) => {
                    const props = feat.properties || {};
                    // Cố gắng tìm tên thông minh từ các cột phổ biến
                    const featureName = props.Name || props.name || props.Ten || props.TEN || props.id || `Đối tượng từ ${file.name} (#${index+1})`;
                    
                    return {
                        name: featureName,
                        feature_type: feat.geometry ? feat.geometry.type : 'Unknown',
                        geojson: feat
                    };
                });

                // Chèn hàng loạt vào DB
                const { error } = await supabaseClient.from('web_map_features').insert(insertData);
                if (error) throw error;
                console.log(`✅ Đã bóc tách và lưu ${geojson.features.length} đối tượng vào DB.`);
            }
        }

        // --- HIỂN THỊ LÊN BẢN ĐỒ LEAFLET ---
        let featureCount = 0;
        uploadedVectorLayer = L.geoJSON(geojson, {
            style: { color: '#7c3aed', fillColor: '#7c3aed', fillOpacity: 0.15, weight: 2 },
            pointToLayer: (feature, latlng) => L.circleMarker(latlng, {
                radius: 6, fillColor: '#7c3aed', color: 'white', weight: 2, opacity: 1, fillOpacity: 0.9
            }),
            onEachFeature: function(feature, layer) {
                featureCount++;
                const props = feature.properties;
                if (props && Object.keys(props).length > 0) {
                    let rows = Object.entries(props)
                        .filter(([k, v]) => v !== null && v !== undefined && v !== '')
                        .map(([k, v]) => `<tr><td style="border-bottom:1px solid #e2e8f0; padding:4px;"><b>${k}</b></td><td style="border-bottom:1px solid #e2e8f0; padding:4px;">${v}</td></tr>`).join('');
                    if (rows) {
                        layer.bindPopup(`<strong style="color:#2d3748;">📋 Thuộc tính</strong><div style="max-height:200px; overflow-y:auto; margin-top:8px;"><table style="width:100%;font-size:0.8rem; border-collapse:collapse;">${rows}</table></div>`, { maxWidth: 300 });
                    }
                }
            }
        }).addTo(map);

        // Zoom map vừa vặn với toàn bộ dữ liệu
        const bounds = uploadedVectorLayer.getBounds();
        if (bounds.isValid()) map.fitBounds(bounds, { padding: [30, 30] });

        uploadInfo.innerHTML = `<div style="color:#38a169;font-size:0.85rem">✅ <strong>${file.name}</strong> (${featureCount} đối tượng) - Đã xử lý xong.</div>`;

    } catch (err) {
        console.error(err);
        uploadInfo.innerHTML = `<span style="color:#e53e3e">⚠ Lỗi khi xử lý file: ${err.message}</span>`;
    }
    this.value = ''; // Reset input
});

// ======================================================
// 4. RASTER - UPLOAD NHIỀU FILE, LƯU NODE.JS VÀ QUẢN LÝ
// ======================================================

// Biến toàn cục lưu trữ các lớp raster đang hiển thị
let rasterIdCounter = 0;
const rasterLayerMap = {}; // { id: L.imageOverlay }

rasterInput.addEventListener('change', async function(e) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    rasterInfo.innerHTML = `<div style="color:#d69e2e;font-size:0.8rem">⏳ Đang gửi ${files.length} file lên Node Server...</div>`;

    // 1. Đẩy file lên Node.js Backend để lưu vào máy
    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
        formData.append('files', files[i]);
    }

    try {
        const response = await fetch('http://localhost:3000/api/upload-raster', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) throw new Error("Lỗi khi upload lên Server Node.js");
        const data = await response.json();

        rasterInfo.innerHTML = `<div style="color:#38a169;font-size:0.8rem">✅ Đã lưu ${data.files.length} file vào máy. Đang xử lý hiển thị...</div>`;

        // 2. Xử lý hiển thị từng file lên bản đồ Leaflet
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const ext = file.name.split('.').pop().toLowerCase();
            const rId = ++rasterIdCounter;
            
            // Tìm URL đã lưu trên server trả về
            const serverFileInfo = data.files.find(f => f.originalName === file.name);
            const savedUrl = serverFileInfo ? serverFileInfo.url : URL.createObjectURL(file);

            let overlayLayer = null;

            if (ext === 'tif' || ext === 'tiff') {
                // Đọc TIFF bằng GeoTIFF.js
                const arrayBuffer = await file.arrayBuffer();
                const tiff = await GeoTIFF.fromArrayBuffer(arrayBuffer);
                const image = await tiff.getImage(); 
                const bbox = image.getBoundingBox();
                
                // Đơn giản hóa: Chuyển TIFF thành canvas URL để hiển thị nhanh
                const width = image.getWidth();
                const height = image.getHeight();
                const rasters = await image.readRasters({ interleave: false });
                
                const canvas = document.createElement('canvas');
                canvas.width = width; canvas.height = height;
                const ctx = canvas.getContext('2d');
                const imgData = ctx.createImageData(width, height);
                const pixels = imgData.data;

                // Xử lý màu (giả định RGB cho nhanh)
                if (rasters.length >= 3) {
                    for (let j = 0; j < width * height; j++) {
                        pixels[j*4] = rasters[0][j];
                        pixels[j*4+1] = rasters[1][j];
                        pixels[j*4+2] = rasters[2][j];
                        pixels[j*4+3] = 255;
                    }
                }
                ctx.putImageData(imgData, 0, 0);
                
                const bounds = [[bbox[1], bbox[0]], [bbox[3], bbox[2]]];
                overlayLayer = L.imageOverlay(canvas.toDataURL(), bounds, { opacity: 0.9, interactive: true });
                map.fitBounds(bounds);

            } else if (ext === 'jpg' || ext === 'jpeg' || ext === 'png') {
                // Ảnh thường không có tọa độ, ép vào giữa màn hình
                const bounds = map.getBounds();
                overlayLayer = L.imageOverlay(savedUrl, bounds, { opacity: 0.9, interactive: true });
                map.fitBounds(bounds);

            } else if (ext === 'dat') {
                alert(`Đã lưu file ${file.name} vào máy chủ, nhưng trình duyệt không thể vẽ định dạng .dat trực tiếp.`);
                continue; // Bỏ qua hiển thị
            }

            // Nếu tạo được layer, thêm vào map và sinh giao diện Sidebar
            if (overlayLayer) {
                overlayLayer.addTo(map);
                rasterLayerMap[rId] = overlayLayer;
                addRasterToSidebar(rId, file.name);
            }
        }

        setTimeout(() => rasterInfo.innerHTML = '', 3000);

    } catch (err) {
        console.error(err);
        rasterInfo.innerHTML = `<span style="color:#e53e3e">⚠ Lỗi: ${err.message}. Nhớ bật server.js nhé!</span>`;
    }
    
    this.value = ''; // Reset
});

// ===================================================================
// GIAO DIỆN QUẢN LÝ RASTER (Kéo thả, Ẩn hiện, Đổi tên)
// ===================================================================

function addRasterToSidebar(id, fileName) {
    const container = document.getElementById('rasters-list');
    const emptyMsg = container.querySelector('.empty-msg');
    if (emptyMsg) emptyMsg.remove();

    const item = document.createElement('div');
    item.className = 'feature-item raster-item';
    item.id = `raster-item-${id}`;
    item.draggable = true; 
    item.style.display = 'flex';
    item.style.justifyContent = 'space-between';
    item.style.alignItems = 'center';

    item.innerHTML = `
      <div style="display:flex; align-items:center; flex:1; overflow:hidden;">
          <div class="raster-drag-handle" style="color: #cbd5e0; padding-right: 12px; cursor: grab;">
            <i class="fa-solid fa-grip-vertical"></i>
          </div>
          <div class="feat-info" style="cursor:pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
            <i class="fa-solid fa-image" style="color:#38a169;"></i>
            <span id="raster-name-${id}" style="font-weight: 500; font-size:0.85rem;">${fileName}</span>
          </div>
      </div>
  
      <div class="feat-actions" style="display: flex; gap: 8px; align-items: center; padding-left: 8px;">
        <input type="range" min="0" max="1" step="0.1" value="0.9" title="Độ trong suốt" style="width: 40px; cursor: pointer;" oninput="changeRasterOpacity(${id}, this.value)">
        <button onclick="renameRasterLayer(${id})" title="Đổi tên" style="background:none; border:none; cursor:pointer; color:#3182ce;"><i class="fa-solid fa-pen"></i></button>
        <button id="toggle-raster-${id}" onclick="toggleRasterLayer(${id})" title="Ẩn/Hiện" style="background:none; border:none; cursor:pointer; color:#4a5568;"><i class="fa-solid fa-eye"></i></button>
        <button onclick="deleteRasterLayer(${id})" title="Xóa" style="background:none; border:none; cursor:pointer; color:#e53e3e;"><i class="fa-solid fa-times"></i></button>
      </div>
    `;

    // Zoom tới ảnh khi click tên
    item.querySelector('.feat-info').addEventListener('click', () => {
        const layer = rasterLayerMap[id];
        if (layer && map.hasLayer(layer)) map.fitBounds(layer.getBounds());
    });

    // Sự kiện kéo thả Z-Index
    item.addEventListener('dragstart', () => item.classList.add('dragging-raster'));
    item.addEventListener('dragend', () => {
        item.classList.remove('dragging-raster');
        updateRasterZIndexOrder();
    });

    container.insertBefore(item, container.firstChild);
    updateRasterZIndexOrder();
}

function changeRasterOpacity(id, value) {
    if (rasterLayerMap[id]) rasterLayerMap[id].setOpacity(value);
}

function toggleRasterLayer(id) {
    const layer = rasterLayerMap[id];
    if (!layer) return;
    const btn = document.getElementById(`toggle-raster-${id}`);
    const icon = btn.querySelector('i');
    
    if (map.hasLayer(layer)) {
        map.removeLayer(layer);
        icon.classList.replace('fa-eye', 'fa-eye-slash');
        btn.style.color = '#a0aec0';
    } else {
        map.addLayer(layer);
        icon.classList.replace('fa-eye-slash', 'fa-eye');
        btn.style.color = '#4a5568';
        updateRasterZIndexOrder();
    }
}

function renameRasterLayer(id) {
    const nameSpan = document.getElementById(`raster-name-${id}`);
    const newName = prompt("Đổi tên hiển thị lớp ảnh:", nameSpan.innerText);
    if (newName && newName.trim()) nameSpan.innerText = newName.trim();
}

function deleteRasterLayer(id) {
    if (!confirm('Xóa ảnh này khỏi bản đồ? (Ảnh gốc vẫn lưu trong thư mục uploads của Node.js)')) return;
    if (rasterLayerMap[id]) {
        map.removeLayer(rasterLayerMap[id]);
        delete rasterLayerMap[id];
        const item = document.getElementById(`raster-item-${id}`);
        if (item) item.remove();
        
        if (document.getElementById('rasters-list').children.length === 0) {
            document.getElementById('rasters-list').innerHTML = '<p class="empty-msg">Chưa có ảnh nào</p>';
        }
    }
}

// Logic Kéo Thả (Z-Index)
const rasterContainer = document.getElementById('rasters-list');
if (rasterContainer) {
    rasterContainer.addEventListener('dragover', e => {
        e.preventDefault();
        const afterElement = getRasterDragAfterElement(rasterContainer, e.clientY);
        const draggable = document.querySelector('.dragging-raster');
        if (draggable) {
            if (afterElement == null) rasterContainer.appendChild(draggable);
            else rasterContainer.insertBefore(draggable, afterElement);
        }
    });
}

function getRasterDragAfterElement(container, y) {
    const elements = [...container.querySelectorAll('.raster-item:not(.dragging-raster)')];
    return elements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) return { offset: offset, element: child };
        else return closest;
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

function updateRasterZIndexOrder() {
    const items = document.querySelectorAll('.raster-item');
    const reversedItems = Array.from(items).reverse(); 
    reversedItems.forEach((item, index) => {
        const id = parseInt(item.id.replace('raster-item-', ''));
        const layer = rasterLayerMap[id];
        // Đặt Z-Index cao hơn BaseMap (mặc định 1) nhưng thấp hơn Vector (mặc định 400)
        if (layer && layer.setZIndex) layer.setZIndex(100 + index); 
    });
}

// ======================================================
// 5. CLOUD UPLOAD - LƯU ĐỊA ĐIỂM & ẢNH/VIDEO (CLOUDINARY + SUPABASE)
// ======================================================
async function handleUpload() {
    const name = document.getElementById('point-name').value;
    const fileInput = document.getElementById('image-input');
    const file = fileInput.files[0];
    const btn = document.querySelector("#upload-form button");

    if (!name || !file) return alert("Vui lòng điền tên và chọn file!");

    btn.innerText = "Đang lưu...";
    btn.disabled = true;

    try {
        // A. Tải file lên Cloudinary
        const formData = new FormData();
        formData.append('file', file);
        formData.append('upload_preset', CLOUDINARY_PRESET);

        // THAY ĐỔI: Sử dụng 'auto/upload' thay vì 'image/upload' để tự động hỗ trợ Video và Ảnh
        const cloudRes = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_NAME}/auto/upload`, {
            method: 'POST', body: formData
        });
        
        const cloudData = await cloudRes.json();

        // Bổ sung: Báo lỗi nếu Cloudinary từ chối upload (sai preset, file quá nặng,...)
        if (!cloudRes.ok) {
            throw new Error(cloudData.error?.message || "Lỗi khi upload lên Cloudinary");
        }

        // B. Lưu thông tin vào bảng 'web_map_points' trong Supabase
        const center = map.getCenter();
        const dbRes = await fetch(`${SUPABASE_URL}/rest/v1/web_map_points`, {
            method: 'POST',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: name,
                image_url: cloudData.secure_url, // Vẫn lưu vào cột image_url, nhưng lúc này link có thể là ảnh hoặc video
                geom: `POINT(${center.lng} ${center.lat})`
            })
        });

        if (dbRes.ok) {
            alert("Lưu thành công!");
            location.reload();
        } else {
            throw new Error("Không thể lưu vào database Supabase");
        }
    } catch (err) {
        alert("Lỗi: " + err.message);
        console.error(err);
    } finally {
        btn.innerText = "Lưu địa điểm & File";
        btn.disabled = false;
    }
}

// ======================================================
// HÀM BỔ TRỢ (HELPER FUNCTIONS)
// ======================================================

// Hàm tạo màu sắc cho Single Band Raster
function viridisColor(t) {
    const lut = [[68,1,84],[72,40,120],[62,74,137],[49,104,142],[38,130,142],[31,158,137],[53,183,121],[110,206,88],[181,222,43],[253,231,37]];
    const idx = t * (lut.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.min(lo + 1, lut.length - 1);
    const f = idx - lo;
    return [
        Math.round(lut[lo][0] + f * (lut[hi][0] - lut[lo][0])),
        Math.round(lut[lo][1] + f * (lut[hi][1] - lut[lo][1])),
        Math.round(lut[lo][2] + f * (lut[hi][2] - lut[lo][2]))
    ];
}

// Hàm lưu file gốc vào Supabase Storage và link vào bảng map_layers
async function saveLayerToSupabase(file, type, metadata = {}) {
    try {
        const fileName = `${type}_${Date.now()}_${file.name}`;
        const filePath = `uploads/${fileName}`;

        // Đẩy file lên Storage bucket 'gis_files'
        const { data: uploadData, error: uploadError } = await supabaseClient.storage
            .from('gis_files')
            .upload(filePath, file);

        if (uploadError) throw uploadError;
        
        // Lấy link URL công khai
        const { data: urlData } = supabaseClient.storage
            .from('gis_files')
            .getPublicUrl(filePath);

        // Chèn metadata vào bảng map_layers
        const { error: dbError } = await supabaseClient
            .from('map_layers')
            .insert([{
                layer_name: file.name,
                layer_type: type,
                file_url: urlData.publicUrl,
                metadata: metadata
            }]);

        if (dbError) throw dbError;
        console.log(`✅ Đã lưu bền vững lớp ${type}: ${file.name}`);
    } catch (err) {
        console.error("❌ Lỗi lưu trữ Supabase:", err.message);
    }
}