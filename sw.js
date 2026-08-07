// ============================================
// SERVICE WORKER
//
// For now, this only exists so notifications work reliably on every
// browser (Android Chrome in particular refuses to show a notification
// straight from a webpage — it insists on going through a service worker
// like this one instead). This file will do more later, when we make the
// app properly installable on your phone.
// ============================================

// Take control right away instead of waiting for a page reload
self.addEventListener("install", function (event) {
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(self.clients.claim());
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
