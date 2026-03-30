// ===== UI.JS - Giao diện người dùng =====

// -------- SIDEBAR TOGGLE --------
const sidebarToggle = document.getElementById('sidebar-toggle');
const sidebar = document.getElementById('sidebar');

sidebarToggle.addEventListener('click', function() {
  sidebar.classList.toggle('collapsed');
  document.body.classList.toggle('sidebar-collapsed');

  const icon = this.querySelector('i');
  if (sidebar.classList.contains('collapsed')) {
    icon.className = 'fa-solid fa-chevron-right';
  } else {
    icon.className = 'fa-solid fa-bars';
  }

  // Resize bản đồ
  setTimeout(() => map.invalidateSize(), 350);
});

// -------- INFO PANEL --------
document.getElementById('info-close').addEventListener('click', function() {
  document.getElementById('info-panel').classList.add('hidden');
});

function showInfoPanel(title, htmlContent) {
  document.getElementById('info-title').textContent = title;
  document.getElementById('info-body').innerHTML = htmlContent;
  document.getElementById('info-panel').classList.remove('hidden');
}

// -------- NOTIFICATION --------
let notifTimeout = null;

function showNotification(message, duration = 2500) {
  // Xóa notification cũ
  const old = document.querySelector('.notification');
  if (old) old.remove();
  clearTimeout(notifTimeout);

  const notif = document.createElement('div');
  notif.className = 'notification';
  notif.textContent = message;
  document.body.appendChild(notif);

  notifTimeout = setTimeout(() => {
    notif.style.opacity = '0';
    notif.style.transition = 'opacity 0.3s';
    setTimeout(() => notif.remove(), 300);
  }, duration);
}

// -------- MAP RIGHT CLICK CONTEXT MENU --------
map.on('contextmenu', function(e) {
  const lat = e.latlng.lat.toFixed(6);
  const lng = e.latlng.lng.toFixed(6);

  showInfoPanel('📍 Thông tin vị trí', `
    <table>
      <tr><td>Latitude</td><td><strong>${lat}</strong></td></tr>
      <tr><td>Longitude</td><td><strong>${lng}</strong></td></tr>
      <tr><td>Zoom</td><td><strong>${map.getZoom()}</strong></td></tr>
    </table>
    <div style="margin-top:10px">
      <a href="https://www.google.com/maps?q=${lat},${lng}" target="_blank"
         style="color:#1a6eb5;font-size:0.8rem">
        <i class="fa-brands fa-google" style="margin-right:4px"></i>Mở trong Google Maps
      </a>
    </div>
  `);
});

// -------- KEYBOARD SHORTCUTS --------
document.addEventListener('keydown', function(e) {
  if (e.target.tagName === 'INPUT') return; // ignore khi đang nhập

  switch(e.key) {
    case 'm':
    case 'M':
      activateTool('marker');
      break;
    case 'l':
    case 'L':
      activateTool('polyline');
      break;
    case 'p':
    case 'P':
      activateTool('polygon');
      break;
    case 'd':
    case 'D':
      activateTool('measure');
      break;
    case '+':
    case '=':
      map.zoomIn();
      break;
    case '-':
      map.zoomOut();
      break;
  }
});

// -------- TOOLTIP KEYBOARD SHORTCUTS --------
showNotification('WebGIS sẵn sàng! Phím tắt: M=Điểm L=Đường P=Vùng D=Đo', 4000);
