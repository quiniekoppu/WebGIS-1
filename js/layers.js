// ===== LAYERS.JS - Quản lý lớp bản đồ nền =====

/**
 * Hàm thực hiện logic chuyển đổi lớp bản đồ nền trên cấu trúc Leaflet
 * @param {string} layerKey - Khóa (key) của layer được định nghĩa trong CONFIG.tileLayers
 */
function switchBasemap(layerKey) {
    const layerConfig = CONFIG.tileLayers[layerKey];
    if (!layerConfig) return;

    // 1. Xóa bản đồ nền hiện tại nếu đang tồn tại trên map
    if (typeof currentBaseLayer !== 'undefined' && currentBaseLayer !== null) {
        map.removeLayer(currentBaseLayer);
    }

    // 2. KIỂM TRA: NẾU LÀ CHẾ ĐỘ "KHÔNG CÓ NỀN" (CT Map / none)
    if (layerConfig.url === 'CT Map' || layerConfig.url === 'none') {
        // Đổi màu nền của thẻ <div> chứa map thành màu xám nhạt để dễ nhìn các nét vẽ
        document.getElementById('map').style.backgroundColor = '#f8f9fa'; 
        currentBaseLayer = null; // Đặt về null vì không có ảnh nền nào cả
        return; // Dừng hàm tại đây
    } 
    
    // 3. NẾU LÀ CÁC BẢN ĐỒ CÓ ẢNH (OSM, Satellite, Topo...)
    // Trả lại màu nền xám mặc định của Leaflet để phòng khi mạng lag chưa load xong ảnh
    document.getElementById('map').style.backgroundColor = '#cad2d3'; 
    
    // Khởi tạo layer ảnh mới và đẩy vào map
    currentBaseLayer = L.tileLayer(layerConfig.url, layerConfig.options).addTo(map);
    
    // RẤT QUAN TRỌNG: Đưa lớp nền xuống dưới cùng để không che khuất các đối tượng tự vẽ
    currentBaseLayer.bringToBack();
}

// ==============================================================
// GẮN SỰ KIỆN GIAO DIỆN (Chỉ chạy 1 lần duy nhất khi mở web)
// ==============================================================
document.addEventListener("DOMContentLoaded", () => {
    const basemapItems = document.querySelectorAll('.basemap-item');
    
    basemapItems.forEach(item => {
        item.addEventListener('click', function() {
            // 1. Xóa class 'active' ở tất cả các nút để bỏ viền sáng
            basemapItems.forEach(el => el.classList.remove('active'));
            
            // 2. Thêm class 'active' cho đúng cái nút vừa được click
            this.classList.add('active');

            // 3. Lấy key của layer từ thuộc tính data-layer (VD: data-layer="osm")
            const layerKey = this.dataset.layer;
            
            // 4. Gọi hàm xử lý logic bản đồ ở trên
            switchBasemap(layerKey);
        });
    });
});
