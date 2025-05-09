// offscreen.js
// Runs in the hidden offscreen document.
// Initializes Sentry. Handles messages for Sentry & GA4 reporting.
// Reads GA4 client/session IDs from message payload.

// --- Configuration ---
const SENTRY_DSN = "https://f5560443c33e63ec4f1cd7075b8581a3@o4509142515449856.ingest.us.sentry.io/4509142555557888";
const GA4_MEASUREMENT_ID = "G-9K7F60SKFD"; // GA4 Measurement ID
const GA4_API_SECRET = "8EMh_pCsQOGGjVLmEEsxYg"; // GA4 API Secret
const SENTRY_FLUSH_TIMEOUT = 3000;
// Session expiration constant (no longer used directly here, managed by background)
// const SESSION_EXPIRATION_MINUTES = 30;

// --- Sentry Initialization ---
try {
  if (typeof Sentry !== 'undefined') {
    Sentry.init({
      dsn: SENTRY_DSN,
      initialScope: { tags: { context: 'offscreen' } },
    });
    console.log("Offscreen: Sentry initialized successfully.");
  } else { console.error("Offscreen: Sentry SDK object not found."); }
} catch (error) { console.error("Offscreen: Error initializing Sentry:", error); }

// --- GA4 Measurement Protocol Sending Function ---

/**
 * Sends an event to GA4 using the Measurement Protocol.
 * Assumes clientId and sessionId are provided in eventParams.
 * @param {string} eventName - The name of the event.
 * @param {object} eventParams - Parameters for the event, MUST include clientId and sessionId.
 */
async function sendGaEventViaMP(eventName, eventParams = {}) {
  if (!GA4_MEASUREMENT_ID || !GA4_API_SECRET) {
    console.warn("Offscreen: GA4 Measurement ID or API Secret not configured.");
    return;
  }

  // --- FIXED: Extract IDs from parameters sent by background script ---
  const clientId = eventParams.client_id;
  const sessionId = eventParams.session_id;

  if (!clientId || !sessionId) {
      console.error(`Offscreen: Missing clientId (${clientId}) or sessionId (${sessionId}) in GA4 event params for '${eventName}'. Cannot send event.`);
      // Optionally report this issue to Sentry
      reportErrorToSentry(new Error("Missing client/session ID for GA4 event"), { eventName });
      return;
  }
  // --- End Fix ---

  try {
    // Construct the Measurement Protocol v2 payload
    const payload = {
      // Use IDs received from background script
      client_id: clientId,
      non_personalized_ads: false,
      events: [{
        name: eventName,
        params: {
          // Pass session ID received from background
          session_id: sessionId,
          engagement_time_msec: "1", // Minimal engagement time
          // Remove client_id and session_id from event-specific params if they exist
          ...Object.fromEntries(Object.entries(eventParams).filter(([key]) => key !== 'client_id' && key !== 'session_id'))
        }
      }]
    };

    const url = `https://www.google-analytics.com/mp/collect?measurement_id=${GA4_MEASUREMENT_ID}&api_secret=${GA4_API_SECRET}`;

    console.log(`Offscreen: Sending GA4 event '${eventName}' with client ID ${clientId.substring(0, 8)}... and session ID ${sessionId}...`);

    const response = await fetch(url, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) {
      const responseBody = await response.text();
      console.error(`Offscreen: GA4 MP request failed (${response.status}). Event: ${eventName}. Response:`, responseBody);
      reportErrorToSentry(new Error(`GA4 MP request failed: ${response.status}`), { eventName, responseStatus: response.status, responseBody });
    } else {
       console.log(`Offscreen: GA4 MP request for '${eventName}' successful.`);
    }

  } catch (error) {
    console.error(`Offscreen: Error sending GA4 event '${eventName}':`, error);
    reportErrorToSentry(error, { eventName, context: 'sendGaEventViaMP' });
  }
}

// --- Sentry Error Reporting Wrapper ---
async function reportErrorToSentry(error, context = {}) {
    // Basic implementation assumed from previous context
    if (typeof Sentry !== 'undefined' && Sentry.captureException) {
        Sentry.withScope(scope => {
            scope.setContext("GA4/Offscreen Error Context", context);
            Sentry.captureException(error);
        });
        console.log("Offscreen: Reported internal helper error to Sentry.");
        await Sentry.flush(SENTRY_FLUSH_TIMEOUT).catch(()=>{}); // Attempt flush
    } else {
        console.error("Offscreen: Sentry not available to report internal helper error.", error);
    }
}


// --- Message Listener ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Offscreen: Message listener invoked. Received:", message);
  if (message.target !== 'offscreen') return false;

  // --- Handle Keep-Alive Ping ---
  if (message.type === 'ping') { sendResponse({ pong: true }); return false; }

  // --- Handle Sentry Error Capture ---
  if (message.type === 'captureError' && message.payload) { /* ... Sentry capture logic from previous step ... */
    console.log("Offscreen: Received 'captureError'.");
    if (typeof Sentry !== 'undefined' && Sentry.captureException) {
      const errorData = message.payload; const syntheticError = new Error(errorData.message || 'Unknown'); syntheticError.name = errorData.name || 'Error'; if (errorData.stack) syntheticError.stack = errorData.stack;
      Sentry.withScope(scope => { if (errorData.context) scope.setContext("BG Error Context", errorData.context); if (errorData.appVersion) scope.setTag('app_version', errorData.appVersion); scope.setTag('errorSource', 'backgroundScript'); console.log("Offscreen: Calling Sentry.captureException..."); try { const eventId = Sentry.captureException(syntheticError); console.log("Offscreen: Sent error to Sentry. Event ID:", eventId); Sentry.flush(SENTRY_FLUSH_TIMEOUT).then(f => console.log("Offscreen: Sentry.flush done.", f)).catch(e => console.error("Offscreen: Sentry.flush error:", e)); } catch (e) { console.error("Offscreen: Error DURING Sentry.captureException call:", e); } }); sendResponse({ success: true });
    } else { console.error("Offscreen: Sentry SDK not available for captureException."); sendResponse({ success: false, error: "Sentry SDK not available" }); } return false;
  }

  // --- Handle Sentry Message Capture ---
  if (message.type === 'captureMessage' && message.payload) { /* ... Sentry message logic from previous step ... */
     console.log("Offscreen: Received 'captureMessage'.");
     if (typeof Sentry !== 'undefined' && Sentry.captureMessage) { Sentry.withScope(scope => { if (message.payload.appVersion) scope.setTag('app_version', message.payload.appVersion); scope.setTag('messageSource', 'backgroundScript'); console.log("Offscreen: Calling Sentry.captureMessage..."); const messageId = Sentry.captureMessage(message.payload.message || 'BG message'); console.log("Offscreen: Sent message to Sentry. Event ID:", messageId); Sentry.flush(SENTRY_FLUSH_TIMEOUT).then(f => console.log("Offscreen: Sentry.flush done.", f)).catch(e => console.error("Offscreen: Sentry.flush error:", e)); }); sendResponse({ success: true }); } else { console.error("Offscreen: Sentry SDK not available for captureMessage."); sendResponse({ success: false, error: "Sentry SDK not available" }); } return false;
  }

  // --- Handle GA4 Event Sending ---
  if (message.type === 'sendGaEvent' && message.payload) {
      console.log("Offscreen: Received 'sendGaEvent'. Payload:", message.payload);
      // Call async function but don't await here in listener
      // Pass the entire payload.params which should now include clientId and sessionId
      sendGaEventViaMP(message.payload.name, message.payload.params)
          .catch(e => console.error("Offscreen: sendGaEventViaMP failed:", e));
      sendResponse({ success: true, status: "GA4 event processing initiated" });
      return false; // Ack sent
  }

  // --- Handle Unknown Type ---
  if (message.type !== 'ping') { console.warn("Offscreen: Received unknown message type:", message.type); sendResponse({ success: false, error: "Unknown message type" }); }
  return false;
});

console.log("Offscreen script loaded and message listener attached (Sentry + GA4 - Reads IDs from message).");

