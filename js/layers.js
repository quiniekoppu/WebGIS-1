// ===== LAYERS.JS - Quản lý lớp bản đồ nền =====

/**
 * Chuyển đổi basemap
 * @param {string} layerKey - key trong CONFIG.tileLayers
 */
function switchBasemap(layerKey) {
  const cfg = CONFIG.tileLayers[layerKey];
  if (!cfg) return;

  // Xóa layer cũ
  map.removeLayer(currentBaseLayer);

  // Thêm layer mới (bên dưới các layer khác)
  currentBaseLayer = L.tileLayer(cfg.url, cfg.options);
  currentBaseLayer.addTo(map);
  currentBaseLayer.bringToBack();

  // Cập nhật UI
  document.querySelectorAll('.basemap-item').forEach(el => {
    el.classList.toggle('active', el.dataset.layer === layerKey);
  });

  showNotification(`Đã chuyển sang bản đồ: ${layerKey.toUpperCase()}`);
}

// Gắn sự kiện click cho các basemap item
document.querySelectorAll('.basemap-item').forEach(item => {
  item.addEventListener('click', function() {
    switchBasemap(this.dataset.layer);
  });
});
