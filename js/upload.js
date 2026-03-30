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

    if (typeof saveLayerToSupabase === 'function') {
        saveLayerToSupabase(file, 'vector');
    }

    try {
        let geojson = null;

        if (ext === 'geojson' || ext === 'json') {
            const text = await file.text();
            geojson = JSON.parse(text);
        } else if (ext === 'kml') {
            const text = await file.text();
            const dom = new DOMParser().parseFromString(text, 'text/xml');
            geojson = toGeoJSON.kml(dom); 
        } else if (ext === 'zip') {
            const buffer = await file.arrayBuffer();
            geojson = await shp(buffer); 
            if (Array.isArray(geojson)) {
                let combinedFeatures = [];
                geojson.forEach(g => combinedFeatures = combinedFeatures.concat(g.features || []));
                geojson = { type: "FeatureCollection", features: combinedFeatures };
            }
        }

        if (!geojson || !geojson.features) throw new Error("Dữ liệu không hợp lệ hoặc rỗng.");
        if (uploadedVectorLayer) map.removeLayer(uploadedVectorLayer);

        if (geojson.features.length > 0) {
            const confirmSave = confirm(`Tìm thấy ${geojson.features.length} đối tượng từ file ${ext.toUpperCase()}. Bạn có muốn bóc tách và lưu tất cả vào Database không?`);
            if (confirmSave) {
                uploadInfo.innerHTML = `<div style="color:#d69e2e;font-size:0.8rem">⏳ Đang lưu ${geojson.features.length} đối tượng vào Database...</div>`;
                const insertData = geojson.features.map((feat, index) => {
                    const props = feat.properties || {};
                    const featureName = props.Name || props.name || props.Ten || props.TEN || props.id || `Đối tượng từ ${file.name} (#${index+1})`;
                    return {
                        name: featureName,
                        feature_type: feat.geometry ? feat.geometry.type : 'Unknown',
                        geojson: feat
                    };
                });
                const { error } = await supabaseClient.from('web_map_features').insert(insertData);
                if (error) throw error;
            }
        }

        let featureCount = 0;
        uploadedVectorLayer = L.geoJSON(geojson, {
            style: { color: '#7c3aed', fillColor: '#7c3aed', fillOpacity: 0.15, weight: 2 },
            pointToLayer: (feature, latlng) => L.circleMarker(latlng, { radius: 6, fillColor: '#7c3aed', color: 'white', weight: 2, opacity: 1, fillOpacity: 0.9 }),
            onEachFeature: function(feature, layer) {
                featureCount++;
                const props = feature.properties;
                if (props && Object.keys(props).length > 0) {
                    let rows = Object.entries(props)
                        .filter(([k, v]) => v !== null && v !== undefined && v !== '')
                        .map(([k, v]) => `<tr><td style="border-bottom:1px solid #e2e8f0; padding:4px;"><b>${k}</b></td><td style="border-bottom:1px solid #e2e8f0; padding:4px;">${v}</td></tr>`).join('');
                    if (rows) layer.bindPopup(`<strong style="color:#2d3748;">📋 Thuộc tính</strong><div style="max-height:200px; overflow-y:auto; margin-top:8px;"><table style="width:100%;font-size:0.8rem; border-collapse:collapse;">${rows}</table></div>`, { maxWidth: 300 });
                }
            }
        }).addTo(map);

        const bounds = uploadedVectorLayer.getBounds();
        if (bounds.isValid()) map.fitBounds(bounds, { padding: [30, 30] });

        uploadInfo.innerHTML = `<div style="color:#38a169;font-size:0.85rem">✅ <strong>${file.name}</strong> (${featureCount} đối tượng) - Đã xử lý xong.</div>`;

    } catch (err) {
        uploadInfo.innerHTML = `<span style="color:#e53e3e">⚠ Lỗi khi xử lý file: ${err.message}</span>`;
    }
    this.value = ''; 
});

// ======================================================
// 4. RASTER - CLOUD ARCHITECTURE (SUPABASE STORAGE + DB)
// ======================================================

let rasterIdCounter = 0;
const rasterLayerMap = {}; 

rasterInput.addEventListener('change', async function(e) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    rasterInfo.innerHTML = `<div style="color:#d69e2e;font-size:0.8rem">⏳ Đang tải ${files.length} file lên Supabase Cloud...</div>`;
    let hasError = false;

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const ext = file.name.split('.').pop().toLowerCase();
        const rId = ++rasterIdCounter;
        
        try {
            // 1. Tải file vật lý lên Supabase Storage
            const fileName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
            const { data: uploadData, error: uploadError } = await supabaseClient
                .storage
                .from('raster_files')
                .upload(`uploads/${fileName}`, file);

            if (uploadError) throw uploadError;

            // 2. Lấy link URL công khai của file vừa up
            const { data: urlData } = supabaseClient.storage.from('raster_files').getPublicUrl(`uploads/${fileName}`);
            const publicUrl = urlData.publicUrl;

            // 3. Xử lý hiển thị trên bản đồ
            let overlayLayer = null;
            let bounds = null;

            if (ext === 'tif' || ext === 'tiff') {
                // --- ĐOẠN MỚI: DÙNG SUPABASE SDK ĐỂ LÁCH LUẬT CORS ---
                // Cắt lấy đường dẫn gốc của file trong Storage
                const filePath = r.file_url.split('/raster_files/')[1]; 
                
                // Dùng đường ống nội bộ của Supabase để tải dữ liệu nhị phân
                const { data: fileBlob, error: downloadErr } = await supabaseClient.storage
                    .from('raster_files')
                    .download(filePath);
                
                if (downloadErr) throw new Error("Lỗi tải ngầm TIF: " + downloadErr.message);
                
                const arrayBuffer = await fileBlob.arrayBuffer();
                // --- KẾT THÚC ĐOẠN LÁCH LUẬT ---

                const tiff = await GeoTIFF.fromArrayBuffer(arrayBuffer);
                const image = await tiff.getImage();
                const rasters = await image.readRasters({ interleave: false });
                const canvas = document.createElement('canvas');
                canvas.width = image.getWidth(); canvas.height = image.getHeight();
                const ctx = canvas.getContext('2d');
                const imgData = ctx.createImageData(canvas.width, canvas.height);
                for (let j = 0; j < canvas.width * canvas.height; j++) {
                    imgData.data[j*4] = rasters[0][j]; imgData.data[j*4+1] = rasters[1][j];
                    imgData.data[j*4+2] = rasters[2][j]; imgData.data[j*4+3] = 255;
                }
                ctx.putImageData(imgData, 0, 0);
                overlayLayer = L.imageOverlay(canvas.toDataURL(), r.bounds, { opacity: 0.9, interactive: true });
            } else {
                
                bounds = map.getBounds();
                overlayLayer = L.imageOverlay(publicUrl, bounds, { opacity: 0.9, interactive: true });
            }

            if (overlayLayer) {
                overlayLayer.addTo(map);
                rasterLayerMap[rId] = overlayLayer;
                
                // HÀM NÀY BỊ THIẾU TRONG CODE CỦA BẠN NÊN GÂY LỖI
                addRasterToSidebar(rId, file.name);
                map.fitBounds(bounds);

                // 4. Lưu Metadata vào Database Supabase
                const { data: dbData, error: dbError } = await supabaseClient
                    .from('web_map_rasters')
                    .insert([{
                        name: file.name,
                        file_url: publicUrl,
                        bounds: bounds,
                        extension: ext
                    }]).select();

                if (dbError) throw dbError;
                
                // Gắn ID thật từ DB vào thẻ Sidebar
                const itemEl = document.getElementById(`raster-item-${rId}`);
                if (itemEl) itemEl.dataset.dbId = dbData[0].id;
            }

        } catch (err) {
            console.error("Lỗi Cloud Raster:", err);
            rasterInfo.innerHTML += `<div style="color:red; margin-top:5px;">❌ Lỗi file ${file.name}: ${err.message}</div>`;
            hasError = true;
        }
    }
    
    if (!hasError) {
        rasterInfo.innerHTML = `<div style="color:green">✅ Hoàn thành!</div>`;
        setTimeout(() => rasterInfo.innerHTML = '', 4000);
    }
    this.value = ''; 
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

    item.querySelector('.feat-info').addEventListener('click', () => {
        const layer = rasterLayerMap[id];
        if (layer && map.hasLayer(layer)) map.fitBounds(layer.getBounds());
    });

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

async function deleteRasterLayer(id) {
    if (!confirm('Xóa ảnh này vĩnh viễn?')) return;
    const item = document.getElementById(`raster-item-${id}`);
    const dbId = item ? item.dataset.dbId : null;

    if (rasterLayerMap[id]) map.removeLayer(rasterLayerMap[id]);
    delete rasterLayerMap[id];
    if (item) item.remove();

    if (dbId) {
        try {
            await supabaseClient.from('web_map_rasters').delete().eq('id', dbId);
        } catch (err) { console.error("Lỗi xóa DB:", err); }
    }

    if (document.getElementById('rasters-list').children.length === 0) {
        document.getElementById('rasters-list').innerHTML = '<p class="empty-msg">Chưa có ảnh nào</p>';
    }
}

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
        if (layer && layer.setZIndex) layer.setZIndex(100 + index); 
    });
}

// ======================================================
// 5. CLOUD UPLOAD - LƯU ĐỊA ĐIỂM & ẢNH/VIDEO
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
        const formData = new FormData();
        formData.append('file', file);
        formData.append('upload_preset', CLOUDINARY_PRESET);

        const cloudRes = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_NAME}/auto/upload`, {
            method: 'POST', body: formData
        });
        const cloudData = await cloudRes.json();
        if (!cloudRes.ok) throw new Error(cloudData.error?.message || "Lỗi Cloudinary");

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
                image_url: cloudData.secure_url, 
                geom: `POINT(${center.lng} ${center.lat})`
            })
        });

        if (dbRes.ok) {
            alert("Lưu thành công!");
            location.reload();
        } else throw new Error("Không thể lưu vào database Supabase");
    } catch (err) {
        alert("Lỗi: " + err.message);
    } finally {
        btn.innerText = "Lưu địa điểm & File";
        btn.disabled = false;
    }
}

async function saveLayerToSupabase(file, type, metadata = {}) {
    try {
        const fileName = `${type}_${Date.now()}_${file.name}`;
        const filePath = `uploads/${fileName}`;

        const { data: uploadData, error: uploadError } = await supabaseClient.storage
            .from('gis_files')
            .upload(filePath, file);

        if (uploadError) throw uploadError;
        
        const { data: urlData } = supabaseClient.storage.from('gis_files').getPublicUrl(filePath);

        const { error: dbError } = await supabaseClient.from('map_layers').insert([{
            layer_name: file.name,
            layer_type: type,
            file_url: urlData.publicUrl,
            metadata: metadata
        }]);

        if (dbError) throw dbError;
    } catch (err) {
        console.error("Lỗi lưu trữ Supabase:", err.message);
    }
}

// ===================================================================
// THUẬT TOÁN KHÔI PHỤC RASTER TỪ DATABASE KHI TẢI LẠI TRANG
// ===================================================================
async function loadSavedRasters() {
    try {
        const { data: savedRasters, error } = await supabaseClient
            .from('web_map_rasters')
            .select('*');

        if (error) throw error;

        for (let r of savedRasters) {
            const rId = ++rasterIdCounter;
            let overlayLayer = null;

            // Ép đuôi file về chữ thường để không bị lỗi TIF viết hoa trong DB
            const ext = (r.extension || '').toLowerCase();

            if (ext === 'tif' || ext === 'tiff') {
                // TIF cần fetch lại dữ liệu nhị phân để render canvas
                const res = await fetch(r.file_url);
                
                // Nếu bị Supabase chặn, nó sẽ báo lỗi ở đây
                if (!res.ok) throw new Error("Bị Supabase chặn quyền tải file TIF ngầm (Lỗi CORS) hoặc file đã bị xóa.");
                
                const arrayBuffer = await res.arrayBuffer();
                const tiff = await GeoTIFF.fromArrayBuffer(arrayBuffer);
                const image = await tiff.getImage();
                const rasters = await image.readRasters({ interleave: false });
                const canvas = document.createElement('canvas');
                canvas.width = image.getWidth(); canvas.height = image.getHeight();
                const ctx = canvas.getContext('2d');
                const imgData = ctx.createImageData(canvas.width, canvas.height);
                for (let j = 0; j < canvas.width * canvas.height; j++) {
                    imgData.data[j*4] = rasters[0][j]; imgData.data[j*4+1] = rasters[1][j];
                    imgData.data[j*4+2] = rasters[2][j]; imgData.data[j*4+3] = 255;
                }
                ctx.putImageData(imgData, 0, 0);
                overlayLayer = L.imageOverlay(canvas.toDataURL(), r.bounds, { opacity: 0.9, interactive: true });
            } else {
                // Ảnh JPG/PNG thì ốp link thẳng vào luôn
                overlayLayer = L.imageOverlay(r.file_url, r.bounds, { opacity: 0.9, interactive: true });
            }

            if (overlayLayer) {
                overlayLayer.addTo(map);
                rasterLayerMap[rId] = overlayLayer;
                addRasterToSidebar(rId, r.name);
                
                // Nạp lại DB ID để chức năng xóa hoạt động bình thường
                const itemEl = document.getElementById(`raster-item-${rId}`);
                if (itemEl) itemEl.dataset.dbId = r.id;
            }
        }
    } catch (err) {
        console.error("❌ Lỗi khi khôi phục Raster lúc F5:", err);
        // HIỆN THÔNG BÁO LỖI LÊN MÀN HÌNH ĐỂ DỄ BẮT BỆNH
        alert("Có lỗi khi khôi phục ảnh TIF: " + err.message);
    }
}

setTimeout(() => {
    loadSavedRasters();
}, 500);