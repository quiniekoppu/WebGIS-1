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

            // 3. Xử lý hiển thị trên bản đồ (Giống logic cũ)
            let overlayLayer = null;
            let bounds = null;

            if (ext === 'tif' || ext === 'tiff') {
                const arrayBuffer = await file.arrayBuffer();
                const tiff = await GeoTIFF.fromArrayBuffer(arrayBuffer);
                const image = await tiff.getImage(); 
                const bbox = image.getBoundingBox();
                bounds = [[bbox[1], bbox[0]], [bbox[3], bbox[2]]];
                
                // Vẽ tạm canvas để hiện ngay lập tức
                const rasters = await image.readRasters({ interleave: false });
                const canvas = document.createElement('canvas');
                canvas.width = image.getWidth(); canvas.height = image.getHeight();
                const ctx = canvas.getContext('2d');
                const imgData = ctx.createImageData(canvas.width, canvas.height);
                if (rasters.length >= 3) {
                    for (let j = 0; j < canvas.width * canvas.height; j++) {
                        imgData.data[j*4] = rasters[0][j]; imgData.data[j*4+1] = rasters[1][j];
                        imgData.data[j*4+2] = rasters[2][j]; imgData.data[j*4+3] = 255;
                    }
                }
                ctx.putImageData(imgData, 0, 0);
                overlayLayer = L.imageOverlay(canvas.toDataURL(), bounds, { opacity: 0.9, interactive: true });
            } else {
                bounds = map.getBounds();
                overlayLayer = L.imageOverlay(publicUrl, bounds, { opacity: 0.9, interactive: true });
            }

            if (overlayLayer) {
                overlayLayer.addTo(map);
                rasterLayerMap[rId] = overlayLayer;
                addRasterToSidebar(rId, file.name);
                map.fitBounds(bounds);

                // 4. Lưu Metadata vào Database Supabase để "ghi nhớ" vĩnh viễn
                const { data: dbData, error: dbError } = await supabaseClient
                    .from('web_map_rasters')
                    .insert([{
                        name: file.name,
                        file_url: publicUrl,
                        bounds: bounds,
                        extension: ext
                    }]).select();

                if (dbError) throw dbError;
                
                // Gắn ID thật từ DB vào thẻ Sidebar để xóa cho đúng
                const itemEl = document.getElementById(`raster-item-${rId}`);
                if (itemEl) itemEl.dataset.dbId = dbData[0].id;
            }
            if (!rasterInfo.innerHTML.includes('❌ Lỗi')) {
            rasterInfo.innerHTML = `<div style="color:green">✅ Hoàn thành!</div>`;
            setTimeout(() => rasterInfo.innerHTML = '', 4000);
        }
        } catch (err) {
            console.error("Lỗi Cloud Raster:", err);
            rasterInfo.innerHTML += `<div style="color:red">❌ Lỗi file ${file.name}: ${err.message}</div>`;
        }
    }
    rasterInfo.innerHTML = `<div style="color:green">✅ Hoàn thành!</div>`;
    this.value = ''; 
});

// Sửa lại hàm xóa để xóa trên Cloud
async function deleteRasterLayer(id) {
    if (!confirm('Xóa ảnh này vĩnh viễn?')) return;
    const item = document.getElementById(`raster-item-${id}`);
    const dbId = item.dataset.dbId;

    if (rasterLayerMap[id]) map.removeLayer(rasterLayerMap[id]);
    if (item) item.remove();

    if (dbId) {
        // Xóa trong Database (File trong Storage bạn có thể giữ lại làm backup hoặc xóa thêm tùy ý)
        await supabaseClient.from('web_map_rasters').delete().eq('id', dbId);
    }
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

            if (r.extension === 'tif' || r.extension === 'tiff') {
                // TIF cần fetch lại dữ liệu nhị phân để render canvas
                const res = await fetch(r.file_url);
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
                overlayLayer = L.imageOverlay(r.file_url, r.bounds, { opacity: 0.9, interactive: true });
            }

            if (overlayLayer) {
                overlayLayer.addTo(map);
                rasterLayerMap[rId] = overlayLayer;
                addRasterToSidebar(rId, r.name);
                document.getElementById(`raster-item-${rId}`).dataset.dbId = r.id;
            }
        }
    } catch (err) {
        console.warn("Chưa có dữ liệu Raster trên Cloud.");
    }
}