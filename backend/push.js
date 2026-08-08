/* ============================================
   PUSH NOTIFICATIONS (Stage 8)
   Sends real push notifications via Firebase Cloud
   Messaging, using the service account key stored in
   Script Properties. Works even when the PWA is closed.
============================================ */

// Sends one push notification to the registered device.
// Safe to call even if nothing is registered yet — it just does nothing.
function sendPushNotification(title, body){
  try{
    const props = PropertiesService.getScriptProperties();
    const deviceToken = props.getProperty("PWA_PUSH_TOKEN");
    if(!deviceToken) return;

    const accessToken = getFirebaseAccessToken();
    if(!accessToken) return;

    const serviceAccount = JSON.parse(props.getProperty("FIREBASE_SERVICE_ACCOUNT"));
    const url = "https://fcm.googleapis.com/v1/projects/" + serviceAccount.project_id + "/messages:send";

    const payload = {
      message: {
        token: deviceToken,
        data: { title: title, body: body }
      }
    };

    const response = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: "Bearer " + accessToken },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    logAI("PUSH_SENT", response.getContentText());

  }catch(err){
    logAI("PUSH_ERROR", err.toString());
  }
}

// Exchanges the private service account key for a short-lived (1 hour)
// permission slip, by building and signing a JWT — this is the
// "cryptographic signing" step I mentioned. Apps Script's Utilities
// class can do RSA signing natively, so no extra library is needed.
function getFirebaseAccessToken(){
  try{
    const props = PropertiesService.getScriptProperties();
    const serviceAccount = JSON.parse(props.getProperty("FIREBASE_SERVICE_ACCOUNT"));

    const now    = Math.floor(Date.now() / 1000);
    const expiry = now + 3600;

    const header = { alg: "RS256", typ: "JWT" };
    const claimSet = {
      iss:   serviceAccount.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud:   "https://oauth2.googleapis.com/token",
      exp:   expiry,
      iat:   now
    };

    const encodedHeader = Utilities.base64EncodeWebSafe(JSON.stringify(header));
    const encodedClaim  = Utilities.base64EncodeWebSafe(JSON.stringify(claimSet));
    const signatureInput = encodedHeader + "." + encodedClaim;

    const signatureBytes = Utilities.computeRsaSha256Signature(signatureInput, serviceAccount.private_key);
    const encodedSignature = Utilities.base64EncodeWebSafe(signatureBytes);

    const jwt = signatureInput + "." + encodedSignature;

    const response = UrlFetchApp.fetch("https://oauth2.googleapis.com/token", {
      method: "post",
      contentType: "application/x-www-form-urlencoded",
      payload: {
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt
      },
      muteHttpExceptions: true
    });

    const result = JSON.parse(response.getContentText());
    return result.access_token || null;

  }catch(err){
    logAI("PUSH_TOKEN_ERROR", err.toString());
    return null;
  }
}

// Quick manual test — run this directly from the Apps Script editor
// to confirm everything works, without waiting for a real transaction.
function testPushNotification(){
  sendPushNotification("🔔 Test Notification", "If you see this, push notifications are working!");
}