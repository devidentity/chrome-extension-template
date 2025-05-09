// Copyright 2025 Brad Kulick
// All rights reserved.

/**
 * background.js (Offscreen Document Sentry & GA4 Handler)
 * Manages extension state and logic. Uses an Offscreen Document
 * to delegate Sentry error reporting and GA4 event sending.
 * Manages GA4 client/session IDs using chrome.storage.local.
 * Includes GA4 lifecycle event tracking (install/update).
 * Handles GA4 page view and core action tracking requests from UI scripts.
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

// --- Added: Alarm Configuration ---
const RULE_STATS_ALARM_NAME = 'ruleStatsAlarm';
const RULE_STATS_ALARM_PERIOD_MINUTES = 1440; // Daily

// --- Added: Preloaded Bundle Configuration ---
// List of bundle filenames located in the /bundles/ directory
const PRELOADED_BUNDLE_FILES = [
    'xkcd-substitutions-series.json', // Updated filename
    'xkcd-substitutions-series-wavy.json', // Added wavy version
    'xkcd-others.json', // Added others file
    'cfb-top15-rivalries.json', // Added new CFB Rivalries bundle
    'english-is-hard.json' // Added new English is hard bundle
];


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
    justification: 'Delegate Sentry error reporting and GA4 event sending to avoid service worker limitations.' // Justification required.
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
    // Ensure the offscreen document is ready.
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
     await delay(200); // Small delay.

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
        await delay(200); // Small delay.

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
};

const defaultLocalSettings = {
    isEnabled: true,
    domainList: {
        // *** UPDATED DEFAULT VALUE ***
        type: 'blacklist', // Reverted to blacklist
        domains: [
            // *** UPDATED DOMAIN LIST ***
            'docs.google.com',
            '/.*\\.github\\.io/' // Regex for github pages
        ]
    },
    ruleBundles: [
      {
        id: 'default_buckeye', // Unique ID for this bundle
        name: 'Go Buckeyes!', // User-facing name - UPDATED NAME
        isDefault: true, // Flag indicating it's the primary default bundle
        source: 'hardcoded', // Indicates origin
        requiresLicense: false, // This primary default bundle is free
        rules: [ // The actual rules for this bundle
          // Note: Removed 'isDefault' from individual rules
          { id: 'default_TTUN_long', description: "Beat TTUN (Long Name)", find: 'University of Michigan', replace: 'TTUN', css: 'color: #BB0000; font-weight: bold;', isRegex: false, isCaseSensitive: false, isWholeWord: true, domainList: { type: 'inherit', domains: [] } },
          { id: 'default_TTUN_short', description: "Beat TTUN (Short Name)", find: 'Michigan', replace: 'TTUN', css: 'color: #BB0000; font-weight: bold;', isRegex: false, isCaseSensitive: false, isWholeWord: true, domainList: { type: 'inherit', domains: [] } },
          { id: 'default_m', description: "Go Buckeyes! Beat xichigan.", find: 'm', replace: 'x', css: 'color: #BB0000; font-weight: bold;', isRegex: false, isCaseSensitive: true, isWholeWord: false, domainList: { type: 'inherit', domains: [] } },
          { id: 'default_M', description: "Go Buckeyes! Beat Xichigan.", find: 'M', replace: 'X', css: 'color: #BB0000; font-weight: bold;', isRegex: false, isCaseSensitive: true, isWholeWord: false, domainList: { type: 'inherit', domains: [] } }
        ]
      }
    ],
    activeBundleId: 'default_buckeye', // ID of the bundle active by default
    disabledRuleIds: [] // Store as array for JSON compatibility
};


// Placeholder for license validation logic. Replace with actual validation.
const TEST_LICENSE_KEY = "03-MAY-2025";
async function validateLicenseKey(key) {
  console.log(`Simulating validation for key: ${key}`);
  try {
    // Simulate network delay.
    await new Promise(resolve => setTimeout(resolve, 500));
    // Simple check against a test key.
    return key === TEST_LICENSE_KEY;
  } catch (error) {
    console.error("Error during license validation simulation:", error);
    // Report simulation errors to Sentry if they occur.
    reportErrorToSentry(error, { function: 'validateLicenseKey', licenseKeyAttempt: key });
    throw error; // Re-throw to be handled by caller.
  }
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
        // Re-throw or handle as needed
        throw error;
    }
}

/**
 * Saves settings to chrome.storage.local (most settings).
 * @param {object} settingsToSave - An object containing keys/values to save to local storage.
 * @returns {Promise<void>}
 */
async function saveLocalSettings(settingsToSave) {
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
        // Notify content scripts about the changes as these affect replacements directly
        notifyContentScriptSettingsChanged();
    } catch (error) {
        console.error("Error saving local settings:", error);
        reportErrorToSentry(new Error(`Local storage error: ${error.message}`), { context: 'saveLocalSettings', keys: Object.keys(filteredSettings) });
        // Re-throw or handle as needed
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
                chrome.tabs.sendMessage(tab.id, { action: "settingsUpdated" }, response => {
                    // Check for lastError to avoid console spam if content script isn't injected/listening
                    if (chrome.runtime.lastError) {
                        // Common error: "Receiving end does not exist" - safe to ignore.
                    }
                });
            }
        });
    });
}

// --- Added: Preloaded Bundle Processing ---

/**
 * Fetches, processes, and adds preloaded bundles from the /bundles/ directory
 * to local storage if they don't already exist based on name and source.
 */
async function processPreloadedBundles() {
    console.log("Background: Processing preloaded bundles...");
    let currentStorage;
    try {
        currentStorage = await chrome.storage.local.get('ruleBundles');
    } catch (error) {
        console.error("Background: Error fetching current bundles for preloading:", error);
        reportErrorToSentry(error, { context: 'processPreloadedBundles - initial get' });
        return; // Cannot proceed without current state
    }

    const existingBundles = currentStorage?.ruleBundles || [];
    const bundlesToAdd = [];

    for (const filename of PRELOADED_BUNDLE_FILES) {
        const bundleUrl = chrome.runtime.getURL(`bundles/${filename}`);
        console.log(`Background: Attempting to fetch preloaded bundle: ${bundleUrl}`); // Log the URL
        try {
            const response = await fetch(bundleUrl);
            if (!response.ok) {
                throw new Error(`Failed to fetch ${filename}: ${response.statusText}`);
            }

            const bundleDataArray = await response.json(); // Assume file contains an array of bundles

            // Process each bundle defined within the file
            for (const bundleData of bundleDataArray) {
                 if (!bundleData || typeof bundleData.name !== 'string' || !Array.isArray(bundleData.rules)) {
                     console.warn(`Background: Skipping invalid bundle structure at index ${bundleDataArray.indexOf(bundleData)} in file ${filename}.`);
                     continue;
                 }

                 // Check if a bundle with the same name and 'preloaded' source already exists
                 const alreadyExists = existingBundles.some(
                     b => b.name === bundleData.name && b.source === 'preloaded'
                 );

                 if (!alreadyExists) {
                     console.log(`Background: Preparing to add preloaded bundle: ${bundleData.name}`);
                     // Sanitize rules and generate new IDs
                     const processedRules = bundleData.rules.map(rule => ({
                         description: rule.description || '',
                         find: rule.find || '',
                         replace: rule.replace || '',
                         css: rule.css || '',
                         isRegex: rule.isRegex || false,
                         isCaseSensitive: rule.isCaseSensitive || false,
                         isWholeWord: rule.isWholeWord || false,
                         // Safely handle domainList, defaulting if missing or invalid
                         domainList: (rule.domainList && typeof rule.domainList === 'object' && Array.isArray(rule.domainList.domains))
                             ? { type: rule.domainList.type || 'inherit', domains: rule.domainList.domains.map(d => String(d)) }
                             : { type: 'inherit', domains: [] },
                         id: generateUuid() // Generate unique ID for each rule
                         // Note: Explicitly ignoring rule.isDefault if present in the import file
                     }));

                     // Create the new bundle object for storage
                     const newBundle = {
                         id: generateUuid(), // Generate unique ID for the bundle
                         name: bundleData.name,
                         isDefault: false, // Never default
                         source: 'preloaded', // Mark as preloaded
                         // Read requiresLicense from file, default to false if missing or not boolean
                         requiresLicense: typeof bundleData.requiresLicense === 'boolean' ? bundleData.requiresLicense : false,
                         rules: processedRules
                         // Note: Explicitly ignoring bundle.id, bundle.isDefault, bundle.source, bundle.requiresLicense
                         // if present in the import file, as we are creating a new user bundle.
                     };
                     bundlesToAdd.push(newBundle);
                 } else {
                      console.log(`Background: Preloaded bundle "${bundleData.name}" already exists. Skipping.`);
                 }
            } // End loop through bundles in file

        } catch (error) {
            console.error(`Background: Error processing preloaded bundle file ${filename}:`, error);
            reportErrorToSentry(error, { context: 'processPreloadedBundles', filename: filename });
        }
    } // End loop through filenames

    // If new bundles were found, save them
    if (bundlesToAdd.length > 0) {
        console.log(`Background: Adding ${bundlesToAdd.length} new preloaded bundle(s) to storage.`);
        const combinedBundles = [...existingBundles, ...bundlesToAdd];
        try {
            // Use saveLocalSettings to save the updated array and notify content scripts
            await saveLocalSettings({ ruleBundles: combinedBundles });
            console.log("Background: Successfully saved updated bundles including preloaded ones.");
        } catch (error) {
             console.error("Background: Error saving combined bundles after preloading:", error);
             // Error already reported by saveLocalSettings
        }
    } else {
        console.log("Background: No new preloaded bundles to add.");
    }
}


// --- Installation / Update / Startup Handler ---

/** Creates the periodic alarm for sending stats if it doesn't exist */
async function createStatsAlarm() {
    try {
        const alarm = await chrome.alarms.get(RULE_STATS_ALARM_NAME);
        if (!alarm) {
            chrome.alarms.create(RULE_STATS_ALARM_NAME, {
                periodInMinutes: RULE_STATS_ALARM_PERIOD_MINUTES,
                delayInMinutes: 5 // Optional: Delay first run slightly after install/startup
            });
            console.log(`Background: Created daily alarm '${RULE_STATS_ALARM_NAME}'.`);
        } else {
            console.log(`Background: Alarm '${RULE_STATS_ALARM_NAME}' already exists.`);
        }
    } catch (error) {
        console.error(`Background: Error creating alarm '${RULE_STATS_ALARM_NAME}':`, error);
        reportErrorToSentry(error, { context: 'createStatsAlarm' });
    }
}

// Run alarm creation on startup
createStatsAlarm();

// Make the listener async to allow awaiting operations
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log("Background: onInstalled listener started. Reason:", details.reason);

  try {
    // Handle first installation.
    if (details.reason === 'install') {
        console.log("Background: Reason is 'install'. Applying default settings.");

        // Set sync defaults
        await chrome.storage.sync.set(defaultSyncSettings);
        console.log("Default sync settings applied.");

        // Set local defaults
        await chrome.storage.local.set(defaultLocalSettings);
        console.log("Default local settings applied.");

        // Load preloaded bundles AFTER defaults are set
        await processPreloadedBundles();

        // *** Send GA4 install event AFTER settings and preloads are done ***
        reportGaEvent('extension_installed', { install_reason: details.reason });
        // Create the stats alarm on first install
        createStatsAlarm();
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
        // Ensure alarm exists after update
        createStatsAlarm();

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

    }
    // Handle browser updates or Chrome updates (usually less critical for tracking).
    else if (details.reason === 'chrome_update' || details.reason === 'shared_module_update') {
         console.log(`Background: onInstalled reason: ${details.reason}. No specific action taken.`);
         // Optionally, you could send a generic 'browser_updated' event if useful.
         // reportGaEvent('browser_updated', { update_reason: details.reason });
         // Ensure alarm exists after these updates too
         createStatsAlarm();
         // Process preloads just in case storage was cleared or corrupted
         await processPreloadedBundles();
    }
    // Log any other unexpected reasons.
    else {
         console.log("Background: onInstalled - Unhandled reason:", details.reason);
         // Process preloads here too as a fallback
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
    if (alarm.name === RULE_STATS_ALARM_NAME) {
        console.log(`Background: Alarm '${RULE_STATS_ALARM_NAME}' triggered. Collecting stats...`);
        try {
            // Load necessary settings from storage - fetch from correct areas
            const syncSettings = await chrome.storage.sync.get(['isLicensed']);
            const localSettings = await chrome.storage.local.get(['isEnabled', 'domainList', 'ruleBundles']);

            // Check for errors after *both* fetches
            if (chrome.runtime.lastError) {
                // Note: lastError is often overwritten quickly. This might not catch all errors.
                // Consider wrapping each .get() in its own try/catch if more granular error handling is needed.
                throw new Error(`Storage read error: ${chrome.runtime.lastError.message}`);
            }

            // Combine settings, giving priority to loaded values over defaults if needed
            const currentIsLicensed = syncSettings?.isLicensed ?? defaultSyncSettings.isLicensed;
            const currentIsEnabled = localSettings?.isEnabled ?? defaultLocalSettings.isEnabled;
            const currentDomainList = localSettings?.domainList ?? defaultLocalSettings.domainList;
            const currentBundles = localSettings?.ruleBundles ?? defaultLocalSettings.ruleBundles;


            // --- Calculate Stats ---
            const bundles = currentBundles; // Use loaded/defaulted bundles
            const bundleCount = bundles.length;
            let totalRules = 0;
            let customBundleCount = 0; // Bundles with source: 'user'
            let preloadedBundleCount = 0; // Bundles with source: 'preloaded'
            let hardcodedBundleCount = 0; // Bundles with source: 'hardcoded' (should be 1)
            const ruleCountsPerBundle = [];

            bundles.forEach(bundle => {
                const count = bundle.rules?.length || 0;
                totalRules += count;
                ruleCountsPerBundle.push(count);
                if (bundle.source === 'user') {
                    customBundleCount++;
                } else if (bundle.source === 'preloaded') {
                    preloadedBundleCount++;
                } else if (bundle.source === 'hardcoded') {
                    hardcodedBundleCount++;
                }
            });

            let maxRules = 0;
            let minRules = 0;
            let meanRules = 0;
            let medianRules = 0;

            if (bundleCount > 0) {
                ruleCountsPerBundle.sort((a, b) => a - b); // Sort for median calculation
                maxRules = ruleCountsPerBundle[bundleCount - 1] ?? 0; // Handle empty array case
                minRules = ruleCountsPerBundle[0] ?? 0; // Handle empty array case
                meanRules = totalRules / bundleCount;

                // Calculate median
                const mid = Math.floor(bundleCount / 2);
                if (bundleCount % 2 === 0 && bundleCount > 0) { // Even number of bundles
                    medianRules = ((ruleCountsPerBundle[mid - 1] ?? 0) + (ruleCountsPerBundle[mid] ?? 0)) / 2;
                } else if (bundleCount % 2 !== 0) { // Odd number of bundles
                    medianRules = ruleCountsPerBundle[mid] ?? 0;
                }
            }

            // --- Prepare GA4 Event Parameters ---
            const statsParams = {
                is_enabled: currentIsEnabled,
                is_licensed: currentIsLicensed,
                global_domain_filter_type: currentDomainList?.type || 'disabled',
                bundle_count_total: bundleCount,
                bundle_count_custom: customBundleCount,
                bundle_count_preloaded: preloadedBundleCount,
                bundle_count_hardcoded: hardcodedBundleCount,
                rule_count_total: totalRules,
                rule_count_max: maxRules,
                rule_count_min: minRules,
                rule_count_mean: parseFloat(meanRules.toFixed(2)) || 0, // Ensure NaN becomes 0
                rule_count_median: medianRules
            };

            console.log("Background: Calculated stats:", statsParams);

            // --- Send GA4 Event ---
            await reportGaEvent('rule_bundle_stats', statsParams);
            console.log("Background: Sent rule_bundle_stats event.");

        } catch (error) {
            console.error(`Background: Error during alarm '${RULE_STATS_ALARM_NAME}':`, error);
            reportErrorToSentry(error, { context: 'onAlarmHandler', alarmName: RULE_STATS_ALARM_NAME });
        }
    }
});


// --- Message Listener for Inter-component Communication ---
// Handles messages from popup.js, options.js, or content scripts.
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Handle license validation requests from options.js.
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
          sendResponse({ success: false, error: error.message || 'Validation failed' });
      });
    // Return true to indicate asynchronous response.
    return true; // Indicate async response for validateLicense
  }

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
       if(errorDetails?.name) errorToReport.name = errorDetails.name;
       // No need to await here
       reportErrorToSentry(errorToReport, { source, ...context });
       sendResponse({ success: true });
       return false; // Synchronous response
   }


  // Return false if the message is not handled here or response is synchronous.
  // This allows other listeners (like the one in offscreen.js) to potentially handle the message.
  return false;
});

console.log("Scarlet Swap background script loaded (Sentry & GA4 Offscreen enabled). Storage split implemented. Preload logic added.");
