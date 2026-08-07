// ============================================
// SERVICE WORKER
//
// This exists for three reasons:
// 1. Notifications — Android Chrome refuses to show a notification
//    straight from a webpage, it insists on going through a service
//    worker like this one instead.
// 2. Installability — phones require a service worker with a "fetch"
//    handler below before they'll offer "Add to Home Screen".
// 3. Real background push (Stage 8) — Firebase delivers push messages
//    to this file even when the app itself is fully closed, so this is
//    the only place that can actually show that notification.
// ============================================

// Firebase's own scripts, loaded into the service worker. None of the
// config values below are secret — same reasoning as in index.html.
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyA6hs87aWKZrPdaUe1mG9rEUUfVOAnQpCg",
  authDomain: "fin-app-76c40.firebaseapp.com",
  projectId: "fin-app-76c40",
  storageBucket: "fin-app-76c40.firebasestorage.app",
  messagingSenderId: "921605499750",
  appId: "1:921605499750:web:2598d9d58206f95580b6a7"
});

const messaging = firebase.messaging();

// Fires when a push arrives while the app is closed/in the background.
// This is what makes the notification actually appear on your phone.
messaging.onBackgroundMessage(function (payload) {
  const title = (payload.notification && payload.notification.title) || "Fin App";
  const body  = (payload.notification && payload.notification.body) || "";
  self.registration.showNotification(title, { body: body });
});

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
