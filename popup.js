// Copyright 2025 Brad Kulick
// All rights reserved.

/**
 * popup.js (Copy-Only Share Button with UTMs)
 * Handles logic for the minimal popup UI.
 * Manages global enable/disable toggle (using chrome.storage.local).
 * Provides button to open options page.
 * Share button now *only* copies the CWS link (with UTM parameters) to the clipboard.
 * Sends 'view_popup_page' GA4 event on initialization.
 */

// --- Constants ---
// --- State Management ---
// Only need isEnabled state for the popup toggle (now from local storage)

// --- DOM Elements ---
const openOptionsBtn = document.querySelector('#open-options-btn');

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

// --- Event Handling ---
/** Opens the extension's options page */
function openOptionsPage() {
    if (chrome.runtime && chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage();
    } else {
        console.error("Popup: chrome.runtime.openOptionsPage is not available.");
    }
}

/** Sets up global event listeners for the popup */
function setupEventListeners() {
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
