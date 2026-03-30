const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
//const db = require('./db');

const app = express();
app.use(cors());
app.use(express.json());

// Tạo thư mục 'uploads' nếu chưa có
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

// Cấu hình Multer để lưu file vào máy
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        // Lưu file với thời gian + tên gốc để tránh trùng lặp
        cb(null, Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_'));
    }
});
const upload = multer({ storage: storage });

// API 1: Lấy danh sách locations (Code cũ của bạn)
app.get('/api/locations', async (req, res) => {
  try {
    const result = await db.query('SELECT id, name, ST_AsGeoJSON(geom) as geometry FROM locations');
    const geojson = {
      type: "FeatureCollection",
      features: result.rows.map(row => ({
        type: "Feature",
        properties: { id: row.id, name: row.name },
        geometry: JSON.parse(row.geometry)
      }))
    };
    res.json(geojson);
  } catch (err) {
    console.error(err);
    res.status(500).send("Server Error");
  }
});

// API 2: Upload nhiều file Raster
app.post('/api/upload-raster', upload.array('files', 10), (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: "Không có file nào được tải lên" });
        }
        
        // Trả về danh sách thông tin file đã lưu
        const savedFiles = req.files.map(file => ({
            originalName: file.originalname,
            savedName: file.filename,
            url: `http://localhost:3000/uploads/${file.filename}`,
            size: file.size
        }));

        res.json({ success: true, files: savedFiles });
    } catch (error) {
        console.error("Upload error:", error);
        res.status(500).json({ error: "Lỗi lưu file trên server" });
    }
});

// Phục vụ thư mục 'uploads' thành file tĩnh để frontend có thể đọc ảnh bằng URL
app.use('/uploads', express.static(uploadDir));

app.listen(3000, () => console.log('Server running on port 3000'));

// =========================================================
// DATABASE MINI CHO RASTER (Lưu siêu dữ liệu vào file JSON)
// =========================================================
const dbPath = path.join(__dirname, 'raster_metadata.json');

// Khởi tạo file JSON nếu chưa có
if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, '[]');
}

// 1. API Lấy danh sách ảnh đã lưu
app.get('/api/rasters', (req, res) => {
    try {
        const data = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        res.json(data);
    } catch (err) { res.status(500).json({ error: "Lỗi đọc DB" }); }
});

// 2. API Lưu thông tin ảnh mới (Tọa độ, Tên, URL)
app.post('/api/rasters', (req, res) => {
    try {
        const data = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        data.push(req.body); // Thêm ảnh mới vào mảng
        fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "Lỗi ghi DB" }); }
});

// 3. API Xóa thông tin ảnh
app.delete('/api/rasters/:id', (req, res) => {
    try {
        let data = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        data = data.filter(r => r.id !== req.params.id); // Lọc bỏ ảnh bị xóa
        fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "Lỗi xóa DB" }); }
});