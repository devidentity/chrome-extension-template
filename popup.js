// Copyright 2025 Brad Kulick
// All rights reserved.

/**
 * popup.js (Copy-Only Share Button with UTMs)
 * Handles logic for the minimal popup UI.
 * Manages global enable/disable toggle (using chrome.storage.local).
 * Provides button to open options page.
 * Share button now *only* copies the CWS link (with UTM parameters) to the clipboard.
 * Sends 'view_popup_page' GA4 event on initialization.
 * Sends 'global_toggle_changed' GA4 event when the toggle state is saved.
 * Sends 'share_attempted' GA event with UTM medium.
 */

// --- Constants ---
const DEBOUNCE_DELAY = 350; // Delay for debouncing storage saves
// Base CWS URL (UTM parameters will be added dynamically)
const CWS_BASE_URL = "https://chrome.google.com/webstore/detail/glcojplfgdgjboobhadopanojgfjpehj";
// UTM Parameters
const UTM_SOURCE = "extension";
const UTM_CAMPAIGN = "in_app_share";


// --- State Management ---
// Only need isEnabled state for the popup toggle (now from local storage)
let currentSettings = { isEnabled: true };
let savePopupTimeout; // Debounce timer for saving settings

// --- DOM Elements ---
const enabledToggle = document.querySelector('#enabled-toggle');
const openOptionsBtn = document.querySelector('#open-options-btn');
const shareBtn = document.querySelector('#share-btn'); // Button text changed in HTML
const shareStatus = document.querySelector('#share-status');

// --- Utility Functions ---

/**
 * Constructs the share URL with appropriate UTM parameters.
 * @param {string} medium - The utm_medium value (e.g., 'share_popup').
 * @returns {string} The full CWS URL with UTM parameters.
 */
function getShareUrlWithUtm(medium) {
    try {
        const url = new URL(CWS_BASE_URL);
        url.searchParams.set('utm_source', UTM_SOURCE);
        url.searchParams.set('utm_medium', medium); // Use the provided medium
        url.searchParams.set('utm_campaign', UTM_CAMPAIGN);
        return url.toString();
    } catch (error) {
        console.error("Error constructing UTM URL:", error);
        // Fallback to base URL if construction fails
        return CWS_BASE_URL;
    }
}


/** Shows a temporary status message near an element */
function showStatusMessage(element, message, isError = false, duration = 2500) {
    if (!element) return; // Exit if element doesn't exist
    element.textContent = message;
    element.style.color = isError ? 'red' : 'green'; // Use red for errors, green for success
    // Clear any existing timer for this element
    clearTimeout(element.timer);
    // Set a new timer to clear the message
    element.timer = setTimeout(() => { element.textContent = ''; }, duration);
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

// --- Storage Functions ---
/** Saves only the isEnabled state to local storage, debounced */
function savePopupSettings(notifyContent = true) {
    clearTimeout(savePopupTimeout); // Clear previous debounce timer
    savePopupTimeout = setTimeout(() => {
        // Prepare only the setting managed by the popup
        const settingsToSave = { isEnabled: currentSettings.isEnabled };
        // Save to chrome.storage.local
        chrome.storage.local.set(settingsToSave, () => {
            if (chrome.runtime.lastError) {
                console.error("Error saving popup settings (local):", chrome.runtime.lastError);
                reportErrorToBackground("Error saving popup settings (local)", chrome.runtime.lastError);
            } else {
                console.log("Popup settings saved (local):", settingsToSave);
                if (notifyContent) {
                    notifyContentScriptSettingsChanged(); // Notify content scripts of the change
                }

                // Send GA4 global_toggle_changed event
                reportEventToBackground('global_toggle_changed', {
                    enabled: currentSettings.isEnabled // Pass the new state as a parameter
                });
            }
        });
    }, DEBOUNCE_DELAY);
}

/** Loads only the isEnabled state needed for the popup from local storage */
function loadPopupSettings() {
    return new Promise((resolve, reject) => {
        // Only retrieve the 'isEnabled' key from local storage
        chrome.storage.local.get(['isEnabled'], (result) => {
            if (chrome.runtime.lastError) {
                console.error("Error loading popup settings (local):", chrome.runtime.lastError);
                currentSettings.isEnabled = true; // Default to enabled on error
                reportErrorToBackground("Error loading popup settings (local)", chrome.runtime.lastError);
                reject(chrome.runtime.lastError);
            } else {
                console.log("Popup settings loaded (local):", result);
                // Set state, defaulting to true if undefined or not a boolean
                currentSettings.isEnabled = typeof result.isEnabled === 'boolean' ? result.isEnabled : true;
                resolve();
            }
        });
    });
}

// --- UI Update Functions ---
// (No specific UI update function needed)

// --- Event Handling ---
/** Opens the extension's options page */
function openOptionsPage() {
    if (chrome.runtime && chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage();
    } else {
        console.error("Popup: chrome.runtime.openOptionsPage is not available.");
    }
}

/**
 * Handles the share button click - ONLY copies the link with UTM parameters.
 */
async function handleShare() {
    const medium = 'share_popup'; // Define medium for popup UTM parameter
    const shareUrl = getShareUrlWithUtm(medium); // Construct URL with UTM params

    // Check if base URL is valid (already includes check for placeholder)
    if (!CWS_BASE_URL || CWS_BASE_URL.includes("your-extension-id-here")) { // Check base URL validity
        showStatusMessage(shareStatus, "Share URL not configured.", true);
        console.warn("Share button clicked, but CWS_BASE_URL is not set.");
        return;
    }

    // Directly call the copy link function with the constructed URL
    console.log(`Popup share button: Attempting to copy link: ${shareUrl}`);
    copyLinkFallback(shareUrl, "Link copied to clipboard!"); // Pass URL to fallback

    // Report GA event for the copy action initiated from popup, including medium
    reportEventToBackground('share_attempted', { method: 'copy_link_popup', utm_medium: medium });
}

/** Copies the provided URL to the clipboard */
// Modified to accept urlToCopy argument
async function copyLinkFallback(urlToCopy, message = "Link copied to clipboard!") {
    // Check if clipboard API is available
    if (!navigator.clipboard) {
        showStatusMessage(shareStatus, 'Clipboard access denied or unavailable.', true);
        // Report GA event for copy failure?
        // reportEventToBackground('share_failed', { method: 'copy_link_popup', reason: 'clipboard_unavailable'});
        return;
    }
    try {
        // Use the passed URL with UTM parameters
        await navigator.clipboard.writeText(urlToCopy);
        console.log('Link copied to clipboard:', urlToCopy); // Log the actual copied URL
        showStatusMessage(shareStatus, message); // Show success message
        // Report GA event for copy success? (Might be redundant with share_attempted)
        // reportEventToBackground('share_copied', { method: 'copy_link_popup'});
    } catch (err) {
        console.error('Failed to copy link:', err);
        showStatusMessage(shareStatus, 'Failed to copy link.', true); // Show error message
        reportErrorToBackground("Failed to copy share link", err);
        // Report GA event for copy failure?
        // reportEventToBackground('share_failed', { method: 'copy_link_popup', reason: 'error'});
    }
}

/** Sets up global event listeners for the popup */
function setupEventListeners() {
    // Listener for the main enable/disable toggle
    if (enabledToggle) {
        enabledToggle.addEventListener('change', () => {
            currentSettings.isEnabled = enabledToggle.checked;
            savePopupSettings(true); // Save setting to local storage and notify content scripts (& send GA event)
        });
    }
    // Listener for the "Manage Rules & Settings" button
    if (openOptionsBtn) {
        openOptionsBtn.addEventListener('click', openOptionsPage);
    }
    // Listener for the share button (which now only copies)
    if (shareBtn) {
        shareBtn.addEventListener('click', handleShare);
    }
}

// --- Initialization ---
/** Initializes the popup UI and functionality */
async function initializePopup() {
    try {
        // Load the necessary setting (isEnabled) from local storage
        await loadPopupSettings();
        // Set the toggle state based on the loaded setting
        if (enabledToggle) {
             enabledToggle.checked = currentSettings.isEnabled;
        }
        // Attach event listeners to controls
        setupEventListeners();

        // Send GA4 Page View Event
        reportEventToBackground('view_popup_page');

        console.log("Popup initialized successfully.");

    } catch (error) {
        console.error("Failed to initialize popup:", error);
        const container = document.querySelector('.container');
        if (container) {
            container.innerHTML = '<p style="color: red; text-align: center;">Error loading popup. Please try again.</p>';
        }
        reportErrorToBackground("Fatal error initializing popup", error);
    }
}

// --- Storage Change Listener ---
/** Listens for external changes to 'isEnabled' in local storage and updates the toggle */
chrome.storage.onChanged.addListener((changes, namespace) => {
    // Only react to changes in 'local' storage for isEnabled
    if (namespace === 'local') {
        // Check if 'isEnabled' changed and if the new value is different from the current state
        if (changes.isEnabled && changes.isEnabled.newValue !== currentSettings.isEnabled) {
            console.log("Popup detected external enable change (local).");
            currentSettings.isEnabled = changes.isEnabled.newValue;
            // Update the toggle's checked state if it exists
            if (enabledToggle) {
                enabledToggle.checked = currentSettings.isEnabled;
            }
        }
    }
});

// --- Helper to report errors/events to background (Optional but Recommended) ---
/**
 * Sends error details to the background script for potential Sentry logging.
 */
async function reportErrorToBackground(message, error, context = {}) {
    try {
        if (chrome.runtime && chrome.runtime.sendMessage) {
            await chrome.runtime.sendMessage({
                action: "reportError",
                payload: { source: 'popup.js', message, error: { message: error?.message, name: error?.name }, context }
            });
        } else {
             console.warn("Popup: chrome.runtime.sendMessage not available, cannot report error to background.");
        }
    } catch (messagingError) {
        console.error("Popup: Failed to report error to background script:", messagingError, "Original error:", message, error);
    }
}

/**
 * Sends a GA event request to the background script.
 */
async function reportEventToBackground(eventName, params = {}) {
     try {
         if (chrome.runtime && chrome.runtime.sendMessage) {
             await chrome.runtime.sendMessage({
                 action: "trackGaEvent",
                 payload: { eventName: eventName, params: params }
             }, response => { // Optional callback
                 if (chrome.runtime.lastError) {
                     console.error(`Popup: Error sending GA event '${eventName}' message:`, chrome.runtime.lastError.message);
                 } else {
                     // Existing console log (uncommented in user's provided file)
                     console.log(`Popup: GA event '${eventName}' message acknowledged:`, response);
                 }
             });
         } else {
             console.warn(`Popup: chrome.runtime.sendMessage not available, cannot report GA event '${eventName}'.`);
         }
     } catch (messagingError) {
         console.error(`Popup: Failed to send GA event '${eventName}' to background:`, messagingError);
     }
 }

// Run initialization when the popup DOM is fully loaded
document.addEventListener('DOMContentLoaded', initializePopup);
