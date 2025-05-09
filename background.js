// Copyright 2025 Brad Kulick
// All rights reserved.

/**
 * background.js (Offscreen Document Sentry & GA4 Handler)
 * Manages GA4 client/session IDs using chrome.storage.local.
 * Handles GA4 page view and event tracking requests from UI scripts.
 * Includes periodic alarm for sending rule/usage statistics.
 * Uses chrome.storage.sync ONLY for isLicensed, others use chrome.storage.local.
 * Loads pre-loaded bundles from /bundles/ directory on install/update.
 */

// --- Offscreen Document & Configuration ---
const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';
const PING_INTERVAL_MS = 20 * 1000;
const SESSION_EXPIRATION_MINUTES = 30; // GA4 session timeout
let creatingOffscreenPromise = null;
let keepAliveIntervalId = null;

// --- Periodic Alarm Configuration ---
const GENERIC_ALARM_NAME = 'genericAlarm'; // Renamed from RULE_STATS_ALARM_NAME

// --- Utility Functions ---
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/** Generates a simple v4-like UUID. */
function generateUuid() {
    // Implementation uses Math.random(), which is not cryptographically secure,
    // but sufficient for a unique client ID in this context.
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// --- GA4 ID Management (Using chrome.storage.local) ---

/**
 * Retrieves client_id from local storage, or generates/stores a new one.
 * Ensures persistence across browser sessions and service worker restarts.
 * @returns {Promise<string>} The client ID.
 */
async function getGaClientId() {
    try {
        // chrome.storage.local is preferred for persistent data like client ID.
        let { clientId } = await chrome.storage.local.get('clientId');
        if (!clientId) {
            clientId = generateUuid();
            // Store the newly generated ID persistently.
            await chrome.storage.local.set({ clientId });
            console.log("Background: Generated and stored new GA4 client ID:", clientId);
        }
        return clientId;
    } catch (error) {
        console.error("Background: Error getting/setting GA4 client ID:", error);
        reportErrorToSentry(error, { context: 'getGaClientId' }); // Report storage errors
        // Provide a fallback, though it won't be persistent if storage fails.
        return generateUuid();
    }
}

/**
 * Retrieves session_id from local storage, or starts a new session if expired/missing.
 * Updates the timestamp on activity to keep the session alive.
 * @returns {Promise<string>} The session ID.
 */
async function getGaSessionId() {
    try {
        let { sessionData } = await chrome.storage.local.get('sessionData');
        const now = Date.now();
        // Check if session data exists, has a timestamp, and hasn't expired.
        if (!sessionData || !sessionData.timestamp || (now - sessionData.timestamp > SESSION_EXPIRATION_MINUTES * 60 * 1000)) {
            // Start a new session if conditions met. Use timestamp as session ID for simplicity.
            sessionData = { sessionId: now.toString(), timestamp: now };
            await chrome.storage.local.set({ sessionData });
            console.log("Background: Started new GA4 session:", sessionData.sessionId);
        } else {
            // Session is active, update the timestamp to extend its life.
            sessionData.timestamp = now;
            await chrome.storage.local.set({ sessionData });
            // console.log("Background: Updated GA4 session timestamp for session:", sessionData.sessionId); // Optional: Verbose logging
        }
        return sessionData.sessionId;
    } catch (error) {
        console.error("Background: Error getting/setting GA4 session ID:", error);
        reportErrorToSentry(error, { context: 'getGaSessionId' }); // Report storage errors
        // Fallback session ID if storage fails.
        return Date.now().toString();
    }
}


// --- Offscreen Document Management ---

/** Checks if the offscreen document currently exists. */
async function hasOffscreenDocument() {
  try {
    // Use chrome.runtime.getContexts if available (more reliable).
    if (chrome.runtime.getContexts) {
        const contexts = await chrome.runtime.getContexts({
            contextTypes: ['OFFSCREEN_DOCUMENT'],
            documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)]
        });
        return contexts.length > 0;
    } else {
        // Fallback for older environments (less common now).
        console.warn("Background: chrome.runtime.getContexts not available. Using clients.matchAll fallback.");
        const matchedClients = await clients.matchAll();
        return matchedClients.some(client => client.url.endsWith(OFFSCREEN_DOCUMENT_PATH));
    }
  } catch (error) {
    // Log errors but assume document doesn't exist if check fails.
    console.warn("Background: Error checking for offscreen document:", error?.message);
    return false;
  }
}

/** Creates the offscreen document if it doesn't already exist. */
async function setupOffscreenDocument() {
  let docExists = false;
  try { docExists = await hasOffscreenDocument(); } catch(e) { /* Ignore error during check */ }

  // If document exists, ensure keep-alive is running and exit.
  if (docExists) {
    startKeepAlivePing(); // Ensure ping is running if doc exists
    return;
  }

  // Avoid multiple creation attempts simultaneously.
  if (creatingOffscreenPromise) {
    await creatingOffscreenPromise;
    // Re-check and start ping if creation succeeded during wait.
    if (await hasOffscreenDocument()) { startKeepAlivePing(); }
    return;
  }

  console.log("Background: Attempting to create offscreen document...");
  // Start the creation process.
  creatingOffscreenPromise = chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: [chrome.offscreen.Reason.BLOBS], // Reason required by Chrome API.
    justification: 'Delegate Sentry error reporting and GA4 event sending from the service worker to avoid its limitations.' // Justification required.
  });

  try {
    await creatingOffscreenPromise;
    console.log("Background: Offscreen document created successfully.");
    startKeepAlivePing(); // Start keep-alive after successful creation.
  } catch (error) {
    console.error(`Background: Failed to create offscreen document: ${error?.message || error}`);
    reportErrorToSentry(error, { context: 'setupOffscreenDocument' }); // Report creation errors
    stopKeepAlivePing(); // Stop ping if creation fails.
  } finally {
    // Reset promise regardless of outcome.
    creatingOffscreenPromise = null;
  }
}

/** Starts a periodic ping to keep the offscreen document alive. */
function startKeepAlivePing() {
    // Prevent multiple intervals.
    if (keepAliveIntervalId !== null) return;

    console.log("Background: Starting keep-alive ping interval.");
    keepAliveIntervalId = setInterval(async () => {
        let docStillExists = false;
        try { docStillExists = await hasOffscreenDocument(); } catch(e) { /* Ignore check error */ }

        // If document disappears, stop the ping.
        if (!docStillExists) {
            console.warn("Background: Keep-alive stopping, offscreen document is missing.");
            stopKeepAlivePing();
            // Optionally, try to recreate it immediately or on next event
            // setupOffscreenDocument();
            return;
        }

        // Send a simple message to the offscreen document.
        try {
            await chrome.runtime.sendMessage({ target: 'offscreen', type: 'ping' });
            // console.log("Background: Keep-alive ping sent successfully."); // Optional: Verbose logging
        } catch (error) {
            // If ping fails (e.g., document closed unexpectedly), stop the interval.
            console.warn(`Background: Keep-alive ping failed: ${error?.message}. Stopping ping interval.`);
            stopKeepAlivePing();
        }
    }, PING_INTERVAL_MS);
}

/** Stops the keep-alive ping interval. */
function stopKeepAlivePing() {
    if (keepAliveIntervalId !== null) {
        clearInterval(keepAliveIntervalId);
        keepAliveIntervalId = null;
        console.log("Background: Keep-alive ping interval stopped.");
    }
}

// Attempt initial setup shortly after the background script loads.
// It's good practice to ensure the offscreen document is ready
// soon after the service worker starts, especially if it's needed
// for early events like 'extension_installed' or error handling
// during initialization.
// Use a small delay to allow other initialization tasks to potentially complete.
setTimeout(setupOffscreenDocument, 1500);

// --- Analytics & Error Reporting via Offscreen Document ---

// Cache manifest version for reporting context.
let manifestVersion = 'unknown';
try {
    manifestVersion = chrome.runtime.getManifest()?.version || 'unknown';
} catch (e) {
    console.warn("Background: Could not retrieve manifest version.", e);
}

/**
 * Packages error details and sends them to the offscreen document for Sentry reporting.
 * Ensures the offscreen document is ready before sending.
 * @param {Error|string} error - The error object or error message string.
 * @param {object} [context={}] - Additional context to send with the error.
 */
async function reportErrorToSentry(error, context = {}) {
  console.log("Background: reportErrorToSentry invoked for error:", error?.message);
  let errorData;
  try {
    // Ensure the offscreen document is ready before attempting to message it.
    await setupOffscreenDocument();
    await delay(200); // Small delay to allow document setup/messaging channel to stabilize.

    // Prepare error data payload for Sentry.
    errorData = {
      message: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : 'Error',
      stack: error instanceof Error ? error.stack : undefined,
      context: context, // Include any additional context provided.
      appVersion: manifestVersion // Include extension version.
    };
    // Note: console.log messages here might not appear reliably if service worker is shutting down.
    console.log("Background: Attempting to send error message to offscreen:", errorData.message);
    // Send the error payload to the offscreen document.
    await chrome.runtime.sendMessage({
        target: 'offscreen',
        type: 'captureError',
        payload: errorData
    });
    console.log("Background: sendMessage for captureError completed.");
  } catch (messagingError) {
    // Log failure to send the message, including the original error.
    console.error("Background: Failed to send error message to offscreen:", messagingError, "Original error:", errorData?.message || error);
    // Avoid recursive error reporting loop if messaging itself fails.
  }
}

/**
 * Packages a simple message string and sends it to the offscreen document for Sentry reporting.
 * @param {string} messageText - The message to report.
 */
async function reportMessageToSentry(messageText) {
   try {
     // Ensure the offscreen document is ready.
     await setupOffscreenDocument();
     await delay(200); // Small delay to allow document setup.

     console.log("Background: Attempting to send simple message to offscreen:", messageText);
     // Send the message payload.
     await chrome.runtime.sendMessage({
        target: 'offscreen',
        type: 'captureMessage',
        payload: { message: messageText, appVersion: manifestVersion }
     });
   } catch (messagingError) {
     console.error("Background: Failed to send message to offscreen:", messagingError);
   }
}

/**
 * Packages a GA4 event, retrieves necessary IDs, and sends it to the offscreen document.
 * This function centralizes the process of getting IDs and messaging the offscreen doc.
 * @param {string} eventName - The name of the GA4 event (e.g., 'extension_installed').
 * @param {object} [eventParams={}] - Optional parameters specific to the event.
 */
async function reportGaEvent(eventName, eventParams = {}) {
    // Basic validation for event name
    if (!eventName || typeof eventName !== 'string') {
        console.error("Background: reportGaEvent called with invalid eventName:", eventName);
        reportErrorToSentry(new Error("Invalid GA event name"), { eventName: String(eventName) });
        return;
    }

    console.log(`Background: reportGaEvent invoked for event: ${eventName}`, eventParams);
    try {
        // Retrieve the persistent client ID and current/new session ID.
        const clientId = await getGaClientId();
        const sessionId = await getGaSessionId();

        // Ensure the offscreen document is ready.
        await setupOffscreenDocument();
        await delay(200); // Small delay to allow document setup.

        console.log(`Background: Attempting to send GA4 event '${eventName}' to offscreen.`);
        // Send the event data, including IDs, to the offscreen document.
        await chrome.runtime.sendMessage({
            target: 'offscreen',
            type: 'sendGaEvent', // Message type handled by offscreen.js
            payload: {
                name: eventName, // The GA4 event name
                params: {
                    // Pass the required IDs to the offscreen script.
                    client_id: clientId,
                    session_id: sessionId,
                    // Include standard GA4 parameters if available.
                    language: self.navigator?.language || 'unknown',
                    // Include any custom parameters passed into this function.
                    ...eventParams
                }
            }
        });
        console.log(`Background: sendMessage for GA4 event '${eventName}' completed.`);
    } catch (messagingError) {
        // Log messaging errors and report them to Sentry for debugging.
        console.error(`Background: Failed to send GA4 event '${eventName}' to offscreen:`, messagingError);
        reportErrorToSentry(messagingError, { context: `GA4 Messaging Failure for ${eventName}`, eventName: eventName });
    }
}


// --- Global Error Handlers (Report to Sentry) ---
// Catch unhandled errors within the service worker context.
self.onerror = (message, source, lineno, colno, error) => {
  console.log("Background: Global self.onerror triggered.");
  console.error("Background: onerror details:", message, error);
  // Avoid reporting known test errors if necessary.
  if (!error?.message?.includes("Sentry Offscreen Test Error")) {
      reportErrorToSentry(error || new Error(message), { source, lineno, colno, handler: 'onerror' });
  } else {
      console.log("Background: Global onerror ignored known test error.");
  }
  return true; // Prevent default browser error handling.
};

// Catch unhandled promise rejections.
self.onunhandledrejection = (event) => {
  console.log("Background: Global self.onunhandledrejection triggered.");
  console.error("Background: onunhandledrejection reason:", event.reason);
  reportErrorToSentry(event.reason || new Error('Unhandled promise rejection'), { handler: 'onunhandledrejection' });
  event.preventDefault(); // Prevent default handling.
};


// --- Core Extension Logic ---

// Default settings definitions, separated by storage area
const defaultSyncSettings = {
    isLicensed: false
}; // Added closing brace for defaultSyncSettings

const defaultLocalSettings = { // Corrected placement
    isEnabled: true,
    domainList: {
        type: 'blacklist',
        domains: [
            'docs.google.com',
            '/.*\\.github\\.io/' // Regex example
        ]
    },
    ruleBundles: [
    ], // Empty array for template
    activeBundleId: null, // No default active bundle in template
    disabledRuleIds: [] // Store as array for JSON compatibility
};

// Basic placeholder license validation logic.
async function validateLicenseKey(key) {
  console.log(`Simulating validation for key: ${key}`);
    // Simulate network delay.
    await new Promise(resolve => setTimeout(resolve, 500));
    // Placeholder: Replace with actual license validation logic
    // For template, just simulate a valid key
    return key === 'TEST_LICENSE_KEY_VALID';
  } catch (error) {
    // Report simulation errors to Sentry if they occur.
    reportErrorToSentry(error, { function: 'validateLicenseKey', licenseKeyAttempt: key });
    return false; // Indicate failure
  }
// --- Saving Functions (Directly call storage APIs) ---
// Note: Debouncing is removed here as saving is less frequent and handled by UI scripts now.
// Background only saves on install/update and license validation.

/**
 * Saves settings to chrome.storage.sync (currently only isLicensed).
 * @param {object} settingsToSave - An object containing keys/values to save to sync storage.
 * @returns {Promise<void>}
 */
async function saveSyncSettings(settingsToSave) {
    // Filter to only save keys defined in defaultSyncSettings to prevent unexpected writes
    const filteredSettings = {};
    if (settingsToSave.hasOwnProperty('isLicensed')) {
        filteredSettings.isLicensed = settingsToSave.isLicensed;
    }

    if (Object.keys(filteredSettings).length === 0) {
        console.log("Background: No sync settings provided to saveSyncSettings.");
        return; // Nothing to save
    }

    try {
        await chrome.storage.sync.set(filteredSettings);
        console.log("Sync settings saved.", filteredSettings);
    } catch (error) {
        console.error("Error saving sync settings:", error);
        reportErrorToSentry(new Error(`Sync storage error: ${error.message}`), { context: 'saveSyncSettings', keys: Object.keys(filteredSettings) });
        throw error;
    }
}

/**
 * Saves settings to chrome.storage.local (most settings).
 * @param {object} settingsToSave - An object containing keys/values to save to local storage.
 * @returns {Promise<void>}
 */
async function saveLocalSettings(settingsToSave) {
    // Filter to only save keys defined in defaultLocalSettings
    const localKeys = ['isEnabled', 'domainList', 'ruleBundles', 'activeBundleId', 'disabledRuleIds'];
    const filteredSettings = {};
    let settingsChanged = false;

    for (const key of localKeys) {
        if (settingsToSave.hasOwnProperty(key)) {
            filteredSettings[key] = settingsToSave[key];
            settingsChanged = true;
        }
    }

    if (!settingsChanged) {
        console.log("Background: No local settings provided to saveLocalSettings.");
        return; // Nothing to save
    }

    try {
        await chrome.storage.local.set(filteredSettings);
        console.log("Local settings saved.", filteredSettings);
        // Notify content scripts about the changes
        notifyContentScriptSettingsChanged();
    } catch (error) {
        console.error("Error saving local settings:", error);
        reportErrorToSentry(new Error(`Local storage error: ${error.message}`), { context: 'saveLocalSettings', keys: Object.keys(filteredSettings) });
        throw error;
    }
}

/** Notifies content scripts that settings have changed */
function notifyContentScriptSettingsChanged() {
    // Query all tabs - necessary because we don't know which tab the user might switch to
    chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
            // Ensure the tab has an ID before trying to send a message
            if (tab.id) {
                chrome.tabs.sendMessage(tab.id, { type: "settingsUpdated" }, response => { // Changed action to type for consistency
                    // Check for lastError to avoid console spam if content script isn't injected/listening
                    if (chrome.runtime.lastError) {
                        // Common error: "Receiving end does not exist" - safe to ignore.
                    }
                });
            }
        });
    });
}

// --- Installation / Update / Startup Handler ---

/** Creates the periodic alarm for sending stats if it doesn't exist */
async function ensurePeriodicAlarm() { // Renamed for clarity - ensures it exists or creates
    try {
        const alarm = await chrome.alarms.get(GENERIC_ALARM_NAME);
        if (!alarm) {
            chrome.alarms.create(GENERIC_ALARM_NAME, {
                periodInMinutes: 1440, // Daily - example period
                delayInMinutes: 5 // Optional: Delay first run slightly after install/startup
            });
            console.log(`Background: Created daily alarm '${GENERIC_ALARM_NAME}'.`);
        } else {
            console.log(`Background: Alarm '${GENERIC_ALARM_NAME}' already exists.`);
        }
    } catch (error) {
        console.error(`Background: Error creating alarm '${GENERIC_ALARM_NAME}':`, error);
        reportErrorToSentry(error, { context: 'createStatsAlarm' });
}
} // Corrected function closing brace

// Run alarm creation on startup
createStatsAlarm();

// Make the listener async to allow awaiting operations
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log("Background: onInstalled listener started. Reason:", details.reason);

  try {
    // Handle first installation.
    if (details.reason === 'install') {
        console.log("Background: Reason is 'install'. Applying default settings.");
        // Send GA4 install event BEFORE applying settings to potentially capture early errors
        reportGaEvent('extension_installed', { install_reason: details.reason });

        // Set sync defaults
        await chrome.storage.sync.set(defaultSyncSettings);
        console.log("Default sync settings applied.");

        // Set local defaults. Handle potential errors during storage ops.
        await chrome.storage.local.set(defaultLocalSettings);
        console.log("Default local settings applied.");

        // Ensure the alarm is created on install.
        await ensurePeriodicAlarm();

        // Process preloaded bundles on first install
    }
    // Handle extension updates.
    else if (details.reason === 'update') {
        const previousVersion = details.previousVersion || 'unknown';
        console.log("Background: Reason is 'update'. Previous version:", previousVersion);
        // *** Send GA4 update event immediately ***
        reportGaEvent('extension_updated', {
            update_reason: details.reason,
            previous_version: previousVersion
        });
        // Ensure alarm exists after update.
        await ensurePeriodicAlarm();

        // Check and apply defaults if missing (handles migration to split storage)
        const syncKeysToCheck = Object.keys(defaultSyncSettings);
        const localKeysToCheck = Object.keys(defaultLocalSettings);

        const currentSync = await chrome.storage.sync.get(syncKeysToCheck);
        const syncToSet = {};
        for (const key of syncKeysToCheck) {
            if (currentSync[key] === undefined) {
                syncToSet[key] = defaultSyncSettings[key];
            }
        }
        if (Object.keys(syncToSet).length > 0) {
            await chrome.storage.sync.set(syncToSet);
            console.log("Applied missing sync defaults on update:", syncToSet);
        }

        const currentLocal = await chrome.storage.local.get(localKeysToCheck);
        const localToSet = {};
        for (const key of localKeysToCheck) {
            // Check if the key is missing in local storage.
            if (currentLocal[key] === undefined) {
                 // Special handling: If ruleBundles exists in sync but not local (migration case)
                 if (key === 'ruleBundles') {
                     // Check if ruleBundles exists in sync storage
                     const syncResult = await chrome.storage.sync.get('ruleBundles');
                     if (syncResult && syncResult.ruleBundles) {
                         localToSet.ruleBundles = syncResult.ruleBundles;
                         // Remove from sync after successful migration to local
                         await chrome.storage.sync.remove('ruleBundles');
                         console.log("Migrated ruleBundles from sync to local on update.");
                         continue; // Skip applying default if migrated
                     }
                 }
                 // Apply default if not found in local and not migrated
                 localToSet[key] = defaultLocalSettings[key];
            }
        }
         if (Object.keys(localToSet).length > 0) {
            await chrome.storage.local.set(localToSet);
            console.log("Applied missing local defaults on update:", localToSet);
        }

        // Load/update preloaded bundles on update as well
        await processPreloadedBundles();

    } // Corrected else if block closing brace
    // Handle browser updates or Chrome updates (usually less critical for tracking).
    else if (details.reason === 'chrome_update' || details.reason === 'shared_module_update') {
         console.log(`Background: onInstalled reason: ${details.reason}. No specific action taken.`);
         // Optionally, you could send a generic 'browser_updated' event if useful.
         // reportGaEvent('browser_updated', { update_reason: details.reason });
         // Ensure alarm exists after these updates too
         await ensurePeriodicAlarm();
    // Log any other unexpected reasons.
    else {
         console.log("Background: onInstalled - Unhandled reason:", details.reason);
         // Process preloads here too as a fallback
         await ensurePeriodicAlarm(); // Ensure alarm is set for any unhandled reason
         await processPreloadedBundles();
    }

  } catch (error) {
      // Catch errors from the try block (e.g., storage error during install).
      console.error("Background: Caught error inside onInstalled listener:", error);
      reportErrorToSentry(error, { event: 'onInstalled', reason: details.reason });
      // Optionally attempt to send a GA event indicating failure, though it might also fail.
      // reportGaEvent('install_update_error', { reason: details.reason, error_message: error.message });
  } finally {
      // Ensure the offscreen document exists or is created after handling install/update.
      console.log("Background: Calling setupOffscreenDocument from onInstalled finally block.");
      setupOffscreenDocument();
  }
});


// --- Alarm Listener for Periodic Stats ---
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === GENERIC_ALARM_NAME) {
        console.log(`Background: Alarm '${GENERIC_ALARM_NAME}' triggered. Example periodic task...`);
        try {
            // Fetch necessary settings for the stats event.
            const syncSettings = await chrome.storage.sync.get(['isLicensed']);
            const localSettings = await chrome.storage.local.get(['isEnabled', 'domainList', 'ruleBundles']);

            // Check for errors after *both* fetches
            if (chrome.runtime.lastError) {
                // Note: lastError is often overwritten quickly. This might not catch all errors.
                // Consider wrapping each .get() in its own try/catch if more granular error handling is needed.
                throw new Error(`Storage read error: ${chrome.runtime.lastError.message}`);
            }

            // Combine loaded settings with defaults for reporting.
            const currentIsLicensed = syncSettings?.isLicensed ?? defaultSyncSettings.isLicensed;
            const currentIsEnabled = localSettings?.isEnabled ?? defaultLocalSettings.isEnabled;
            const currentDomainList = localSettings?.domainList ?? defaultLocalSettings.domainList;
            const currentBundles = localSettings?.ruleBundles ?? defaultLocalSettings.ruleBundles;

            // --- Prepare GA4 Event Parameters ---
            const statsParams = { // Renamed variable for clarity
                is_enabled: currentIsEnabled,
                is_licensed: currentIsLicensed,
                global_domain_filter_type: currentDomainList?.type || 'disabled',
            };

            console.log("Background: Calculated stats:", statsParams);

            // --- Send GA4 Event ---
            await reportGaEvent('rule_bundle_stats', statsParams);
            console.log("Background: Sent rule_bundle_stats event.");

         } catch (error) {
            console.error(`Background: Error during alarm '${GENERIC_ALARM_NAME}':`, error); // Use GENERIC_ALARM_NAME
            reportErrorToSentry(error, { context: 'onAlarmHandler', alarmName: RULE_STATS_ALARM_NAME });
        }
    }
});


// --- Message Listener for Inter-component Communication ---
// Handles messages from popup.js, options.js, or content scripts.
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Handle license validation requests (typically from options.js).
  if (request.action === "validateLicense") {
    validateLicenseKey(request.key)
      .then(isValid => {
          if (isValid) {
              // If valid, save the updated license status to sync storage
              // No need to await here, let it save in the background
              saveSyncSettings({ isLicensed: true });
          }
          // Send successful response back to options.js.
          sendResponse({ success: true, isValid: isValid });
      })
      .catch(error => {
          // Log the error and send failure response back.
          console.error("License validation failed:", error);
          reportErrorToSentry(error, { context: 'validateLicense message handler' }); // Report validation errors
          sendResponse({ success: false, error: error?.message || 'Validation failed' });
      });
    // Return true to indicate asynchronous response.
    return true; // Indicate async response for validateLicense
} // Corrected closing brace for validateLicense handler

  // Handle Generic GA4 Event tracking requests
  if (request.action === "trackGaEvent" && request.payload?.eventName) {
      const eventName = request.payload.eventName;
      // Extract optional parameters, defaulting to an empty object if none provided
      const eventParams = request.payload.params || {};
      console.log(`Background: Received trackGaEvent request for: ${eventName}`, eventParams);

      // Call the existing reportGaEvent function with name and params.
      // No need to await here, let it run in the background.
      reportGaEvent(eventName, eventParams);

      // Send a simple acknowledgement response (optional).
      sendResponse({ success: true, message: `GA event ${eventName} queued.` });
      // Return false as the response is synchronous or fire-and-forget.
      return false;
  }

  // Handle generic error reporting requests (if options/popup want to report)
  if (request.action === "reportError" && request.payload) {
       console.log("Background: Received reportError request.");
       const { source, message, error: errorDetails, context } = request.payload;
       const errorToReport = new Error(errorDetails?.message || message || 'Unknown error from UI');
       if (errorDetails?.name) errorToReport.name = errorDetails.name; // Corrected conditional assignment
       // No need to await here
       reportErrorToSentry(errorToReport, { source, ...context });
       sendResponse({ success: true });
       return false; // Synchronous response
   }


    // Handle GA4 Page View tracking requests (typically from popup.js or options.js)
    if (request.action === "trackPageView" && request.payload?.pagePath) {
        const pagePath = request.payload.pagePath;
        const pageTitle = request.payload.pageTitle || pagePath; // Use path as title if none provided
        console.log(`Background: Received trackPageView request for: ${pagePath}`);

        // Use the existing reportGaEvent function for page views.
        // GA4 page views are just events with specific parameters ('page_view' event name).
        reportGaEvent('page_view', {
            page_path: pagePath,
            page_title: pageTitle,
            // Add other relevant page view parameters if needed
            // For example: screen_resolution, viewport_size etc.
            // Refer to GA4 Measurement Protocol documentation for standard parameters.
        });

        sendResponse({ success: true, message: `GA page view ${pagePath} queued.` });
        return false; // Synchronous response
    }

  // Return false if the message is not handled here or response is synchronous.
  // This allows other listeners (like the one in offscreen.js) to potentially handle the message.
  return false;
});
console.log("Scarlet Swap background script loaded (Sentry & GA4 Offscreen enabled). Storage split implemented. Preload logic added.");
