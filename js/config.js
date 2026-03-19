// ===== CONFIG.JS - Cấu hình ứng dụng WebGIS =====

const CONFIG = {
  // Tọa độ trung tâm mặc định (Việt Nam)
  defaultCenter: [16.0, 106.0],
  defaultZoom: 6,

  // Tile layers
  tileLayers: {
    osm: {
      url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      options: {
        attribution: '© <a href="https://www.openstreetmap.org">OpenStreetMap</a> contributors',
        maxZoom: 19
      }
    },
    satellite: {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      options: {
        attribution: '© Esri, Maxar, GeoEye',
        maxZoom: 19
      }
    },
    topo: {
      url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
      options: {
        attribution: '© OpenTopoMap contributors',
        maxZoom: 17
      }
    },
    dark: {
      url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      options: {
        attribution: '© CartoDB',
        maxZoom: 19
      }
    }
  },

  // Màu sắc vẽ
  drawColors: {
    stroke: '#1a6eb5',
    fill: '#1a6eb5',
    fillOpacity: 0.2
  },

  // Nominatim search API
  searchApi: 'https://nominatim.openstreetmap.org/search'
};

const SUPABASE_URL = "https://nhvbplfxdojltzyhmkum.supabase.co";
const SUPABASE_KEY = "Quiin's Project";
const CLOUDINARY_NAME = "Quiin";
const CLOUDINARY_PRESET = "webgis_uploads";

// Khởi tạo client dùng chung
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

