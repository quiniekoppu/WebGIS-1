// db.js - Quản lý kết nối Database
require('dotenv').config();
const { Pool } = require('pg');

// Khởi tạo kết nối sử dụng biến môi trường
const pool = new Pool({
  connectionString: process.env.DATABASE_URL, 
});

module.exports = {
  query: (text, params) => pool.query(text, params),
};