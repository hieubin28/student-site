// sw.js — Network Only
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
    })
  );
});

// Fetch: luôn đi thẳng ra mạng, không dùng cache
self.addEventListener('fetch', function(event) {
  event.respondWith(fetch(event.request));
});
