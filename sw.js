// sw.js — Network Only + Push Notifications
// Không cache gì cả. HTML luôn được fetch mới từ mạng.
// Lý do: student.html cập nhật thường xuyên; app cần Firebase nên không thể offline.

const CACHE_NAME = 'ta2hieu-v1';

// ── Student ID lưu trong bộ nhớ SW (tồn tại chừng nào SW còn sống) ──
var _studentId   = null;
var _dbBaseUrl   = 'https://quanlyhocvien-b1796-default-rtdb.asia-southeast1.firebasedatabase.app';
var _pollTimer   = null;

// Cài đặt: xoá cache cũ nếu có
self.addEventListener('install', function(event) {
  self.skipWaiting();
});

// Activate: xoá tất cả cache cũ
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.map(function(key) {
          return caches.delete(key);
        })
      );
    }).then(function() {
      return self.clients.claim();
    }).then(function() {
      // Báo tất cả tab đang mở reload để lấy code mới
      return self.clients.matchAll({ type: 'window', includeUncontrolled: true })
        .then(function(clients) {
          clients.forEach(function(c) {
            c.postMessage({ type: 'SW_UPDATED' });
          });
        });
    })
  );
});

// Fetch: luôn đi thẳng ra mạng, không dùng cache
self.addEventListener('fetch', function(event) {
  event.respondWith(fetch(event.request));
});

/* ══════════════════════════════════════════════════════════════
   NHẬN MESSAGE TỪ TRANG CHÍNH
   ══════════════════════════════════════════════════════════════ */
self.addEventListener('message', function(event) {
  var data = event.data;
  if (!data || !data.type) return;

  // ── SET_STUDENT: trang chính báo studentId sau khi login ──
  if (data.type === 'SET_STUDENT') {
    _studentId = data.studentId;
    startPolling(); // bắt đầu poll Firebase để nhận notification khi app đóng
    return;
  }

  // ── SHOW_NOTIFICATION: trang chính gọi trực tiếp (khi app đang mở) ──
  if (data.type === 'SHOW_NOTIFICATION') {
    event.waitUntil(
      self.registration.showNotification(data.title || 'Tiếng Anh² Hiếu', {
        body:     data.body  || 'Bạn có thông báo mới.',
        icon:     data.icon  || '/student-site/apple-touch-icon.png',
        badge:    data.icon  || '/student-site/apple-touch-icon.png',
        tag:      data.tag   || 'ta2hieu-general',
        renotify: true,
        data:     { url: data.url || '/student-site/' }
      })
    );
    return;
  }

  // ── CHECK_EVENING_REMINDER: trang chính ping lúc 8pm ──
  if (data.type === 'CHECK_EVENING_REMINDER') {
    var pendingHw = data.pendingHw || 0;
    if (pendingHw <= 0) return;
    var now = new Date();
    if (now.getHours() !== 20 || now.getMinutes() > 5) return;
    var todayTag = 'evening-reminder-' + now.toISOString().slice(0, 10);
    event.waitUntil(
      self.registration.getNotifications({ tag: todayTag }).then(function(existing) {
        if (existing.length > 0) return;
        return self.registration.showNotification('Tiếng Anh² Hiếu 🌙', {
          body:  'Còn ' + pendingHw + ' bài chưa hoàn thành — tranh thủ làm tối nay nhé!',
          icon:  '/student-site/apple-touch-icon.png',
          badge: '/student-site/apple-touch-icon.png',
          tag:   todayTag,
          data:  { url: '/student-site/' }
        });
      })
    );
    return;
  }
});

/* ══════════════════════════════════════════════════════════════
   BACKGROUND POLLING — SW tự fetch Firebase REST khi app đóng
   Mỗi 3 phút check notifications/{studentId} có gì mới không
   ══════════════════════════════════════════════════════════════ */
function startPolling() {
  if (_pollTimer) return; // đã đang poll rồi
  _pollTimer = setInterval(pollNotifications, 3 * 60 * 1000); // 3 phút
  pollNotifications(); // check ngay lần đầu
}

function pollNotifications() {
  if (!_studentId) return;

  // Check xem có client nào đang mở không — nếu có thì trang chính tự xử lý
  self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then(function(clients) {
      // Có tab student site đang mở → không cần SW poll (tránh double notification)
      var hasOpenTab = clients.some(function(c) {
        return c.url.indexOf('/student-site') !== -1;
      });
      if (hasOpenTab) return;

      // Không có tab mở → SW tự fetch Firebase REST API
      var url = _dbBaseUrl + '/notifications/' + _studentId + '.json';
      return fetch(url)
        .then(function(res) { return res.json(); })
        .then(function(data) {
          if (!data) return;
          var promises = [];
          Object.keys(data).forEach(function(key) {
            var n = data[key];
            if (!n || n.seen) return; // đã seen rồi, bỏ qua
            // Đánh dấu seen trước (PATCH request)
            var patchUrl = _dbBaseUrl + '/notifications/' + _studentId + '/' + key + '/seen.json';
            promises.push(
              fetch(patchUrl, { method: 'PUT', body: 'true' })
            );
            // Hiện notification
            promises.push(
              self.registration.showNotification(n.title || 'Tiếng Anh² Hiếu', {
                body:     n.body || 'Thầy vừa gửi thông báo.',
                icon:     '/student-site/apple-touch-icon.png',
                badge:    '/student-site/apple-touch-icon.png',
                tag:      'manual-' + key,
                renotify: true,
                data:     { url: '/student-site/' }
              })
            );
          });
          return Promise.all(promises);
        })
        .catch(function(err) {
          console.warn('[SW poll error]', err);
        });
    });
}

/* ══════════════════════════════════════════════════════════════
   PUSH EVENT — nhận push thật từ FCM server (Cloud Function)
   Hoạt động kể cả khi app đóng hoàn toàn, kể cả iOS 16.4+
   ══════════════════════════════════════════════════════════════ */
self.addEventListener('push', function(event) {
  if(!event.data) return;

  var data = {};
  try { data = event.data.json(); } catch(e) { data = { title: 'Tiếng Anh² Hiếu', body: event.data.text() }; }

  var title = data.title || 'Tiếng Anh² Hiếu';
  var body  = data.body  || 'Bạn có thông báo mới.';
  var url   = data.url   || '/student-site/';
  var icon  = '/student-site/apple-touch-icon.png';

  event.waitUntil(
    self.registration.showNotification(title, {
      body:     body,
      icon:     icon,
      badge:    icon,
      tag:      'ta2hieu-push-' + Date.now(),
      renotify: true,
      data:     { url: url }
    })
  );
});

/* ══════════════════════════════════════════════════════════════
   NOTIFICATION CLICK — mở tab student site khi bấm vào thông báo
   ══════════════════════════════════════════════════════════════ */
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  var target = (event.notification.data && event.notification.data.url)
    ? event.notification.data.url
    : '/student-site/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(function(clients) {
        for (var i = 0; i < clients.length; i++) {
          var c = clients[i];
          if (c.url.indexOf('/student-site') !== -1 && 'focus' in c) {
            return c.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(target);
        }
      })
  );
});
