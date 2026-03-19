// ===== UPLOAD.JS - Upload Vector (GeoJSON) + Raster (GeoTIFF) + Image to Cloud =====

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

// ELEMENT SELECTORS
const geojsonInput = document.getElementById('geojson-upload');
const uploadInfo = document.getElementById('upload-info');
const rasterInput = document.getElementById('raster-upload');
const rasterInfo = document.getElementById('raster-info');
const rasterControls = document.getElementById('raster-controls');
const rasterOpacity = document.getElementById('raster-opacity');
const opacityVal = document.getElementById('opacity-val');

// ======================================================
// 3. VECTOR - XỬ LÝ GEOJSON
// ======================================================
geojsonInput.addEventListener('change', function(e) {
  const file = e.target.files[0];
  if (!file) return;

  if (!file.name.match(/\.(geojson|json)$/i)) {
    uploadInfo.innerHTML = '<span style="color:#e53e3e">⚠ Chỉ hỗ trợ file .geojson hoặc .json</span>';
    return;
  }

  const reader = new FileReader();
  reader.onload = function(ev) {
    try {
      const geojson = JSON.parse(ev.target.result);
      
      // Xóa lớp cũ nếu có
      if (uploadedVectorLayer) map.removeLayer(uploadedVectorLayer);

      let featureCount = 0;
      uploadedVectorLayer = L.geoJSON(geojson, {
        style: { color: '#7c3aed', fillColor: '#7c3aed', fillOpacity: 0.15, weight: 2 },
        pointToLayer: (feature, latlng) => L.circleMarker(latlng, {
          radius: 7, fillColor: '#7c3aed', color: 'white', weight: 2, opacity: 1, fillOpacity: 0.9
        }),
        onEachFeature: function(feature, layer) {
          featureCount++;
          const props = feature.properties;
          if (props && Object.keys(props).length > 0) {
            let rows = Object.entries(props)
              .filter(([k, v]) => v !== null && v !== undefined && v !== '')
              .map(([k, v]) => `<tr><td><b>${k}</b></td><td>${v}</td></tr>`).join('');
            
            if (rows) {
              layer.bindPopup(`<strong>📋 Thuộc tính</strong><table style="width:100%;font-size:0.75rem">${rows}</table>`, { maxWidth: 280 });
            }
          }
        }
      }).addTo(map);

      // Zoom tới vùng dữ liệu
      const bounds = uploadedVectorLayer.getBounds();
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [30, 30] });

      uploadInfo.innerHTML = `<div style="color:#38a169;font-size:0.8rem">✅ <strong>${file.name}</strong> (${featureCount} đối tượng)</div>`;
      if(typeof showNotification === 'function') showNotification(`Đã tải ${featureCount} đối tượng`);

    } catch (err) {
      uploadInfo.innerHTML = '<span style="color:#e53e3e">⚠ File JSON không hợp lệ</span>';
      console.error(err);
    }
  };
  reader.readAsText(file);
  this.value = '';
});
// ======================================================
// 4. RASTER - XỬ LÝ GEOTIFF (SỬ DỤNG GEOTIFF.JS)
// ======================================================
rasterInput.addEventListener('change', async function(e) {
  const file = e.target.files[0];
  if (!file) return;

  if (!file.name.match(/\.tiff?$/i)) {
    rasterInfo.innerHTML = '<span style="color:#e53e3e">⚠ Chỉ hỗ trợ file .tif hoặc .tiff</span>';
    return;
  }

  rasterInfo.innerHTML = `<div style="color:#718096;font-size:0.78rem">⏳ Đang xử lý <strong>${file.name}</strong>...</div>`;

  try {
    const arrayBuffer = await file.arrayBuffer();
    
    // Xóa raster cũ
    if (currentRasterLayer) map.removeLayer(currentRasterLayer);

    const tiff = await GeoTIFF.fromArrayBuffer(arrayBuffer);
    const image = await tiff.getImage();
    const width = image.getWidth();
    const height = image.getHeight();
    const nBands = image.getSamplesPerPixel();
    const bbox = image.getBoundingBox();
    const geoKeys = image.getGeoKeys();
    const rasters = await image.readRasters({ interleave: false });

    // Reproject BBox nếu không phải EPSG:4326
    let [minX, minY, maxX, maxY] = bbox;
    const epsgCode = geoKeys.ProjectedCSTypeGeoKey || geoKeys.GeographicTypeGeoKey || 4326;

    if (epsgCode !== 4326 && typeof proj4 !== 'undefined') {
      try {
        const sw = proj4(`EPSG:${epsgCode}`, 'EPSG:4326', [minX, minY]);
        const ne = proj4(`EPSG:${epsgCode}`, 'EPSG:4326', [maxX, maxY]);
        minX = sw[0]; minY = sw[1]; maxX = ne[0]; maxY = ne[1];
      } catch(e) { console.warn('Reproject failed:', e); }
    }

    const bounds = [[minY, minX], [maxY, maxX]];

    // Vẽ lên Canvas
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(width, height);
    const pixels = imgData.data;
    const noDataVal = image.getGDALNoData();

    if (nBands >= 3) {
      const [r, g, b, a] = rasters;
      for (let i = 0; i < width * height; i++) {
        const idx = i * 4;
        pixels[idx] = r[i]; pixels[idx+1] = g[i]; pixels[idx+2] = b[i];
        pixels[idx+3] = a ? a[i] : (noDataVal !== null && r[i] === noDataVal ? 0 : 255);
      }
    } else {
      const band = rasters[0];
      let min = Math.min(...band.filter(v => v !== noDataVal)), max = Math.max(...band.filter(v => v !== noDataVal));
      const range = max - min || 1;
      for (let i = 0; i < width * height; i++) {
        const idx = i * 4;
        if (band[i] === noDataVal || isNaN(band[i])) { pixels[idx+3] = 0; continue; }
        const t = (band[i] - min) / range;
        const col = viridisColor(t);
        pixels[idx] = col[0]; pixels[idx+1] = col[1]; pixels[idx+2] = col[2]; pixels[idx+3] = 220;
      }
    }

    ctx.putImageData(imgData, 0, 0);
    currentRasterLayer = L.imageOverlay(canvas.toDataURL(), bounds, {
      opacity: parseFloat(rasterOpacity.value), interactive: false
    }).addTo(map);

    map.fitBounds(bounds);
    rasterInfo.innerHTML = `<div style="color:#38a169">✅ <strong>${file.name}</strong><br><small>EPSG:${epsgCode} | ${width}x${height}px</small></div>`;
    rasterControls.classList.remove('hidden');

  } catch (err) {
    rasterInfo.innerHTML = `<span style="color:#e53e3e">⚠ Lỗi: ${err.message}</span>`;
  }
  this.value = '';
});

// Điều khiển Opacity & Xóa Raster
rasterOpacity.addEventListener('input', function() {
  const val = parseFloat(this.value);
  opacityVal.textContent = Math.round(val * 100) + '%';
  if (currentRasterLayer) currentRasterLayer.setOpacity(val);
});

document.getElementById('raster-remove-btn').addEventListener('click', function() {
  if (currentRasterLayer) map.removeLayer(currentRasterLayer);
  currentRasterLayer = null;
  rasterInfo.innerHTML = '';
  rasterControls.classList.add('hidden');
});

// ======================================================
// 5. CLOUD UPLOAD - LƯU ĐỊA ĐIỂM & ẢNH (SUPABASE + CLOUDINARY)
// ======================================================
async function handleUpload() {
  const name = document.getElementById('point-name').value;
  const fileInput = document.getElementById('image-input');
  const file = fileInput.files[0];
  const btn = document.querySelector("#upload-form button");

  if (!name || !file) return alert("Vui lòng điền tên và chọn ảnh!");

  btn.innerText = "Đang lưu...";
  btn.disabled = true;

  try {
    // A. Upload to Cloudinary
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', CLOUDINARY_PRESET);

    const cloudRes = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_NAME}/image/upload`, {
      method: 'POST', body: formData
    });
    const cloudData = await cloudRes.json();

    // B. Save to Supabase
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
    } else {
      throw new Error("Không thể lưu vào database");
    }
  } catch (err) {
    alert("Lỗi upload: " + err.message);
    console.error(err);
  } finally {
    btn.innerText = "Lưu địa điểm & Ảnh";
    btn.disabled = false;
  }
}

// HÀM BỔ TRỢ: Colormap Viridis
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