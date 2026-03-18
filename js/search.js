// ===== SEARCH.JS - Tìm kiếm địa điểm với Nominatim =====

let searchMarker = null;
let searchTimeout = null;

const searchInput = document.getElementById('search-input');
const searchBtn = document.getElementById('search-btn');
const searchResults = document.getElementById('search-results');

// Search khi bấm nút
searchBtn.addEventListener('click', doSearch);

// Search khi nhấn Enter
searchInput.addEventListener('keydown', function(e) {
  if (e.key === 'Enter') doSearch();
});

// Auto-suggest khi gõ (debounce 600ms)
searchInput.addEventListener('input', function() {
  clearTimeout(searchTimeout);
  const val = this.value.trim();
  if (val.length < 3) { searchResults.innerHTML = ''; return; }
  searchTimeout = setTimeout(() => fetchSearchResults(val), 600);
});

async function doSearch() {
  const query = searchInput.value.trim();
  if (!query) return;
  fetchSearchResults(query);
}

async function fetchSearchResults(query) {
  searchResults.innerHTML = '<p style="color:#718096;font-size:0.78rem;padding:6px">Đang tìm...</p>';

  try {
    const params = new URLSearchParams({
      q: query,
      format: 'json',
      limit: 5,
      addressdetails: 1
    });
    const res = await fetch(`${CONFIG.searchApi}?${params}`, {
      headers: { 'Accept-Language': 'vi,en' }
    });
    const data = await res.json();

    if (!data || data.length === 0) {
      searchResults.innerHTML = '<p style="color:#e53e3e;font-size:0.78rem;padding:6px">Không tìm thấy kết quả</p>';
      return;
    }

    renderSearchResults(data);
  } catch (err) {
    searchResults.innerHTML = '<p style="color:#e53e3e;font-size:0.78rem;padding:6px">Lỗi kết nối</p>';
    console.error('Search error:', err);
  }
}

function renderSearchResults(results) {
  searchResults.innerHTML = '';
  results.forEach(item => {
    const div = document.createElement('div');
    div.className = 'search-result-item';
    div.innerHTML = `
      <i class="fa-solid fa-location-dot"></i>
      <span>${item.display_name}</span>
    `;
    div.addEventListener('click', () => goToResult(item));
    searchResults.appendChild(div);
  });
}

function goToResult(item) {
  const lat = parseFloat(item.lat);
  const lng = parseFloat(item.lon);

  // Xóa marker cũ
  if (searchMarker) map.removeLayer(searchMarker);

  // Thêm marker mới
  searchMarker = L.marker([lat, lng], {
    icon: L.divIcon({
      className: '',
      html: `<div style="
        width: 16px; height: 16px;
        background: #e53e3e;
        border: 3px solid white;
        border-radius: 50%;
        box-shadow: 0 2px 8px rgba(0,0,0,0.4);
      "></div>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8]
    })
  }).addTo(map);

  searchMarker.bindPopup(`
    <strong>🔍 ${item.display_name.split(',')[0]}</strong><br/>
    ${item.display_name}<br/>
    <small>Lat: ${lat.toFixed(5)} | Lng: ${lng.toFixed(5)}</small>
  `).openPopup();

  // Zoom đến vị trí
  if (item.boundingbox) {
    const bb = item.boundingbox;
    map.fitBounds([
      [parseFloat(bb[0]), parseFloat(bb[2])],
      [parseFloat(bb[1]), parseFloat(bb[3])]
    ]);
  } else {
    map.setView([lat, lng], 14);
  }

  // Clear results
  searchResults.innerHTML = '';
  searchInput.value = item.display_name.split(',')[0];
}
