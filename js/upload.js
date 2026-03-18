// ===== UPLOAD.JS - Upload Vector (GeoJSON) + Raster (GeoTIFF) =====

// -------- UPLOAD TABS --------
document.querySelectorAll('.upload-tab').forEach(tab => {
  tab.addEventListener('click', function() {
    document.querySelectorAll('.upload-tab').forEach(t => t.classList.remove('active'));
    this.classList.add('active');
    const target = this.dataset.tab;
    document.querySelectorAll('.upload-tab-content').forEach(c => c.classList.add('hidden'));
    document.getElementById(`tab-${target}`).classList.remove('hidden');
  });
});

// ======================================================
// VECTOR - GeoJSON Upload
// ======================================================
const uploadInput = document.getElementById('geojson-upload');
const uploadInfo  = document.getElementById('upload-info');

uploadInput.addEventListener('change', function(e) {
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
      loadGeoJSON(geojson, file.name);
    } catch (err) {
      uploadInfo.innerHTML = '<span style="color:#e53e3e">⚠ File JSON không hợp lệ</span>';
    }
  };
  reader.readAsText(file);
  this.value = '';
});

function loadGeoJSON(geojson, filename) {
  geojsonLayer.clearLayers();
  let featureCount = 0;

  const layer = L.geoJSON(geojson, {
    style: function() {
      return { color: '#7c3aed', fillColor: '#7c3aed', fillOpacity: 0.15, weight: 2 };
    },
    pointToLayer: function(feature, latlng) {
      return L.circleMarker(latlng, {
        radius: 7, fillColor: '#7c3aed', color: 'white',
        weight: 2, opacity: 1, fillOpacity: 0.9
      });
    },
    onEachFeature: function(feature, layer) {
      featureCount++;
      const props = feature.properties;
      if (props && Object.keys(props).length > 0) {
        let rows = '';
        for (const [k, v] of Object.entries(props)) {
          if (v !== null && v !== undefined && v !== '') {
            rows += `<tr><td>${k}</td><td>${v}</td></tr>`;
          }
        }
        if (rows) {
          layer.bindPopup(`
            <strong>📋 Thuộc tính</strong>
            <table style="margin-top:6px;width:100%;border-collapse:collapse;font-size:0.78rem">${rows}</table>
          `, { maxWidth: 280 });
        }
      }
    }
  }).addTo(geojsonLayer);

  const bounds = layer.getBounds();
  if (bounds.isValid()) map.fitBounds(bounds, { padding: [30, 30] });

  uploadInfo.innerHTML = `
    <div style="color:#38a169;margin-top:6px;font-size:0.8rem">
      ✅ <strong>${filename}</strong><br/>
      <span style="color:#718096">${featureCount} đối tượng</span>
    </div>`;

  showNotification(`Đã tải ${featureCount} đối tượng từ ${filename}`);
}

// ======================================================
// RASTER - GeoTIFF Upload (dùng GeoTIFF.js trực tiếp)
// ======================================================
const rasterInput    = document.getElementById('raster-upload');
const rasterInfo     = document.getElementById('raster-info');
const rasterControls = document.getElementById('raster-controls');
const rasterOpacity  = document.getElementById('raster-opacity');
const opacityVal     = document.getElementById('opacity-val');

let currentRasterLayer = null;

rasterInput.addEventListener('change', async function(e) {
  const file = e.target.files[0];
  if (!file) return;

  if (!file.name.match(/\.tiff?$/i)) {
    rasterInfo.innerHTML = '<span style="color:#e53e3e">⚠ Chỉ hỗ trợ file .tif hoặc .tiff</span>';
    return;
  }

  rasterInfo.innerHTML = `
    <div style="color:#718096;font-size:0.78rem;margin-top:6px">
      ⏳ Đang xử lý <strong>${file.name}</strong>...
    </div>`;

  try {
    const arrayBuffer = await file.arrayBuffer();
    await loadRaster(arrayBuffer, file.name);
  } catch (err) {
    console.error('Raster error:', err);
    rasterInfo.innerHTML = `<span style="color:#e53e3e">⚠ Lỗi: ${err.message}</span>`;
  }
  this.value = '';
});

async function loadRaster(arrayBuffer, filename) {
  // Xóa raster cũ
  if (currentRasterLayer) {
    map.removeLayer(currentRasterLayer);
    currentRasterLayer = null;
  }

  // --- 1. Đọc GeoTIFF ---
  const tiff = await GeoTIFF.fromArrayBuffer(arrayBuffer);
  const image = await tiff.getImage();

  const width  = image.getWidth();
  const height = image.getHeight();
  const nBands = image.getSamplesPerPixel();
  const bbox   = image.getBoundingBox(); // [minX, minY, maxX, maxY]
  const geoKeys = image.getGeoKeys();

  // Đọc tất cả raster data
  const rasters = await image.readRasters({ interleave: false });

  // --- 2. Xác định CRS và reproject bbox về WGS84 ---
  let [minX, minY, maxX, maxY] = bbox;

  // EPSG code từ GeoKeys
  const epsgCode = geoKeys.ProjectedCSTypeGeoKey
    || geoKeys.GeographicTypeGeoKey
    || 4326;

  // Nếu không phải WGS84/4326 thì reproject
  if (epsgCode !== 4326 && epsgCode !== 32767 && typeof proj4 !== 'undefined') {
    try {
      const fromProj = `EPSG:${epsgCode}`;
      const toProj   = 'EPSG:4326';
      const sw = proj4(fromProj, toProj, [minX, minY]);
      const ne = proj4(fromProj, toProj, [maxX, maxY]);
      minX = sw[0]; minY = sw[1];
      maxX = ne[0]; maxY = ne[1];
    } catch(e) {
      console.warn('Proj4 reproject failed, using raw bbox:', e);
    }
  }

  const bounds = L.latLngBounds([[minY, minX], [maxY, maxX]]);

  // --- 3. Render raster lên canvas ---
  const canvas = document.createElement('canvas');
  canvas.width  = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(width, height);
  const pixels  = imgData.data;

  // Lấy nodata value
  const noDataVal = image.getGDALNoData();

  if (nBands >= 3) {
    // --- RGB / RGBA ---
    const [r, g, b, a] = rasters;
    for (let i = 0; i < width * height; i++) {
      const rv = r[i], gv = g[i], bv = b[i];
      const idx = i * 4;
      if (noDataVal !== null && (rv === noDataVal || isNaN(rv))) {
        pixels[idx + 3] = 0; // transparent
      } else {
        pixels[idx]     = Math.max(0, Math.min(255, Math.round(rv)));
        pixels[idx + 1] = Math.max(0, Math.min(255, Math.round(gv)));
        pixels[idx + 2] = Math.max(0, Math.min(255, Math.round(bv)));
        pixels[idx + 3] = a ? Math.round(a[i]) : 255;
      }
    }
  } else {
    // --- Single band: normalize + colormap ---
    const band = rasters[0];
    let min = Infinity, max = -Infinity;

    for (let i = 0; i < band.length; i++) {
      const v = band[i];
      if (noDataVal !== null && v === noDataVal) continue;
      if (isNaN(v) || v === null) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }

    const range = max - min || 1;

    for (let i = 0; i < width * height; i++) {
      const v   = band[i];
      const idx = i * 4;

      if ((noDataVal !== null && v === noDataVal) || isNaN(v) || v === null || v === undefined) {
        pixels[idx + 3] = 0;
        continue;
      }

      const t   = Math.max(0, Math.min(1, (v - min) / range));
      const col = viridisColor(t);
      pixels[idx]     = col[0];
      pixels[idx + 1] = col[1];
      pixels[idx + 2] = col[2];
      pixels[idx + 3] = 220;
    }
  }

  ctx.putImageData(imgData, 0, 0);

  // --- 4. Tạo Leaflet ImageOverlay từ canvas ---
  const dataURL = canvas.toDataURL('image/png');

  currentRasterLayer = L.imageOverlay(dataURL, bounds, {
    opacity: parseFloat(rasterOpacity.value),
    interactive: false
  }).addTo(map);

  map.fitBounds(bounds, { padding: [20, 20] });

  // --- 5. Hiển thị thông tin ---
  rasterInfo.innerHTML = `
    <div style="color:#38a169;margin-top:6px;font-size:0.78rem">
      ✅ <strong>${filename}</strong><br/>
      <span style="color:#718096">
        ${nBands} band · ${width} × ${height} px<br/>
        CRS: EPSG:${epsgCode}<br/>
        Min: ${image.getGDALNoData() ?? 'N/A'} | NoData: ${noDataVal ?? 'N/A'}
      </span>
    </div>`;

  rasterControls.classList.remove('hidden');
  showNotification(`Đã tải raster: ${filename} (${width}×${height}px)`);
}

// --- Opacity slider ---
rasterOpacity.addEventListener('input', function() {
  const val = parseFloat(this.value);
  opacityVal.textContent = Math.round(val * 100) + '%';
  if (currentRasterLayer) currentRasterLayer.setOpacity(val);
});

// --- Xóa raster ---
document.getElementById('raster-remove-btn').addEventListener('click', function() {
  if (currentRasterLayer) {
    map.removeLayer(currentRasterLayer);
    currentRasterLayer = null;
  }
  rasterInfo.innerHTML = '';
  rasterControls.classList.add('hidden');
  showNotification('Đã xóa lớp raster');
});

// --- Viridis colormap (tím → xanh lá → vàng) ---
function viridisColor(t) {
  // Lookup table viridis 8 điểm
  const lut = [
    [68,  1,  84],
    [72,  40, 120],
    [62,  74, 137],
    [49, 104, 142],
    [38, 130, 142],
    [31, 158, 137],
    [53, 183, 121],
    [110,206,  88],
    [181,222,  43],
    [253,231,  37]
  ];
  const idx = t * (lut.length - 1);
  const lo  = Math.floor(idx);
  const hi  = Math.min(lo + 1, lut.length - 1);
  const f   = idx - lo;
  return [
    Math.round(lut[lo][0] + f * (lut[hi][0] - lut[lo][0])),
    Math.round(lut[lo][1] + f * (lut[hi][1] - lut[lo][1])),
    Math.round(lut[lo][2] + f * (lut[hi][2] - lut[lo][2]))
  ];
}
