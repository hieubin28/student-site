// sw.js — Network Only + Push Notifications
// Không cache gì cả. HTML luôn được fetch mới từ mạng.
// Lý do: student.html cập nhật thường xuyên; app cần Firebase nên không thể offline.

const CACHE_NAME = 'ta2hieu-v1';

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
