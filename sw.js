// ============================================
// SERVICE WORKER
//
// This exists for two reasons:
// 1. Notifications — Android Chrome refuses to show a notification
//    straight from a webpage, it insists on going through a service
//    worker like this one instead.
// 2. Installability — phones require a service worker with a "fetch"
//    handler below before they'll offer "Add to Home Screen".
// ============================================

// Take control right away instead of waiting for a page reload
self.addEventListener("install", function (event) {
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(self.clients.claim());
});

// Required for installability. For now this just fetches normally over
// the network — no offline support yet, that's a possible future upgrade.
self.addEventListener("fetch", function (event) {
  event.respondWith(fetch(event.request));
});

// When someone taps a notification, bring the app to the front
self.addEventListener("notificationclick", function (event) {
  event.notification.close();

  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then(function (clientList) {
      for (const client of clientList) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow("./");
      }
    })
  );
});
