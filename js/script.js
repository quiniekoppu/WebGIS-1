async function handleUpload() {
    const fileInput = document.getElementById('image-input');
    const name = document.getElementById('point-name').value;
    const file = fileInput.files[0];

    if (!file || !name) return alert("Vui lòng nhập tên và chọn ảnh!");

    try {
        // BƯỚC 1: Upload ảnh lên Cloudinary
        const formData = new FormData();
        formData.append('file', file);
        formData.append('upload_preset', 'webgis_uploads'); // Tên preset bạn tạo ở bước 1

        const cloudRes = await fetch('https://api.cloudinary.com/v1_1/YOUR_CLOUD_NAME/image/upload', {
            method: 'POST',
            body: formData
        });
        const cloudData = await cloudRes.json();
        const imageUrl = cloudData.secure_url; // Đây là link ảnh online

        // BƯỚC 2: Lưu link ảnh và thông tin vào Supabase
        const supabaseUrl = 'https://your-project.supabase.co/rest/v1/map_locations';
        const supabaseKey = 'YOUR_SUPABASE_ANON_KEY';

        const dbRes = await fetch(supabaseUrl, {
            method: 'POST',
            headers: {
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=representation'
            },
            body: JSON.stringify({
                name: name,
                image_url: imageUrl,
                // Giả sử bạn lấy tọa độ từ bản đồ Leaflet
                geom: `SRID=4326;POINT(${currentLng} ${currentLat})` 
            })
        });

        if (dbRes.ok) {
            alert("Đã lưu dữ liệu và ảnh thành công!");
            location.reload(); // Tải lại trang để thấy điểm mới
        }
    } catch (error) {
        console.error("Lỗi:", error);
    }
}

// Giả sử 'data' là mảng các điểm lấy từ Supabase
data.forEach(point => {
    // Chuyển đổi format tọa độ từ database nếu cần
    // (Tùy vào cách bạn fetch dữ liệu, ví dụ dùng PostgREST của Supabase)
    
    const lat = point.lat; 
    const lng = point.lng;

    // Nội dung hiển thị khi click vào điểm trên bản đồ
    const popupContent = `
        <div style="width: 200px">
            <b>${point.name}</b><br>
            ${point.image_url ? 
                `<img src="${point.image_url}" style="width:100%; margin-top:5px; border-radius:5px">` 
                : '<i>Không có ảnh</i>'}
        </div>
    `;

    L.marker([lat, lng])
     .addTo(map)
     .bindPopup(popupContent);
});