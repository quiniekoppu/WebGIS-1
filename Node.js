const multer = require('multer');
const path = require('path');

// Cấu hình lưu trữ
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/'); // Thư mục lưu file (phải tạo thư mục này trước)
  },
  filename: function (req, file, cb) {
    // Đặt tên file: Thời gian hiện tại + tên gốc để tránh trùng lặp
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

// Bộ lọc file (Chỉ cho phép .geojson hoặc .zip của Shapefile)
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['.geojson', '.json', '.zip', '.kml'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowedTypes.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Định dạng file không hỗ trợ!'), false);
  }
};

const upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 } // Giới hạn 10MB
});