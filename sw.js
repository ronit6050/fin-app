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

// Same URL as APPS_SCRIPT_URL in index.html — kept in sync manually,
// see that file's own comment on this constant if it ever changes.
const SW_APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbz3Hzmi_XNM_TRyz16sZrUWqIOjrBOfHAcyJheYLVi6YrRK1jhaYC38-CwxeqCU_n_v/exec";

// Fires when a push arrives while the app is closed/in the background.
// This is what makes the notification actually appear on your phone.
//
// quickConfirm (added 2026-09-19, see docs/features/quick-confirm-notification.md):
// when the backend already knows a confident note+category for this
// transaction, it adds a "Confirm" button right on the notification —
// tapping it saves the transaction with NO need to open the app at all
// (see the notificationclick handler below). payload.data is kept on
// the notification's own `data` so that handler can read it back.
messaging.onBackgroundMessage(function (payload) {
  const title = (payload.data && payload.data.title) || "Fin App";
  const body  = (payload.data && payload.data.body) || "";
  const options = { body: body, data: payload.data || {} };

  if (payload.data && payload.data.quickConfirm === "1") {
    options.actions = [{ action: "confirm", title: "Confirm" }];
  }

  self.registration.showNotification(title, options);
});

// Reads the signed-in user's Google sign-in proof back out of IndexedDB.
// Only IndexedDB, not localStorage, can be read from inside a service
// worker — index.html writes into this same little database every time
// someone signs in (search "syncAuthTokenForServiceWorker" there).
// Resolves to null (never throws) if nothing's there yet, or storage
// isn't available for some reason — the caller treats that as "can't
// confirm automatically, ask them to open the app instead."
function getStoredIdToken() {
  return new Promise(function (resolve) {
    try {
      const openReq = indexedDB.open("finAppAuth", 1);
      openReq.onupgradeneeded = function () {
        openReq.result.createObjectStore("tokens", { keyPath: "id" });
      };
      openReq.onsuccess = function () {
        try {
          const tx = openReq.result.transaction("tokens", "readonly");
          const getReq = tx.objectStore("tokens").get("current");
          getReq.onsuccess = function () {
            resolve(getReq.result ? getReq.result.idToken : null);
          };
          getReq.onerror = function () { resolve(null); };
        } catch (e) { resolve(null); }
      };
      openReq.onerror = function () { resolve(null); };
    } catch (e) { resolve(null); }
  });
}

// Does the actual save when "Confirm" is tapped — same "saveNote" action
// the Pending/History screens already use, just called directly from
// here instead of through an open page. Always finishes by showing a
// small result notification, so it's never silently unclear whether it
// worked.
function confirmFromNotification(data) {
  return getStoredIdToken().then(function (idToken) {
    if (!idToken) {
      return self.registration.showNotification("Couldn't save automatically", {
        body: "Open the app once to confirm you're signed in, then this button will work."
      });
    }

    return fetch(SW_APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({
        action:       "saveNote",
        idToken:      idToken,
        row:          Number(data.row),
        note:         data.note,
        category:     data.category,
        counterparty: data.counterparty,
        type:         data.type || undefined
      })
    })
      .then(function (response) { return response.json(); })
      .then(function (result) {
        if (result && result.ok) {
          return self.registration.showNotification("Saved", {
            body: "\"" + data.note + "\" (" + data.category + ")",
            tag:  "quick-confirm-" + data.row
          });
        }
        return self.registration.showNotification("Couldn't save automatically", {
          body: (result && result.error) ? result.error : "Open the app to add this note instead."
        });
      })
      .catch(function () {
        return self.registration.showNotification("Couldn't save automatically", {
          body: "No connection right now — open the app to add this note instead."
        });
      });
  });
}

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

// When someone taps a notification, bring the app to the front —
// UNLESS they tapped the "Confirm" button, in which case the whole
// point is to NOT open the app (see confirmFromNotification above).
self.addEventListener("notificationclick", function (event) {
  const data = event.notification.data || {};
  event.notification.close();

  if (event.action === "confirm") {
    event.waitUntil(confirmFromNotification(data));
    return;
  }

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
