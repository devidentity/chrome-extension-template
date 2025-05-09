// Copyright 2025 Brad Kulick
// All rights reserved.

/**
 * options.js (Rule Bundles Update)
 * Handles logic for the extension's options page (options.html).
 * Manages rule bundles, allowing users to switch, add, remove, import, and export rules within bundles.
 * Sends GA4 events for various actions.
 * Uses chrome.storage.sync ONLY for isLicensed, others use chrome.storage.local.
 */

// --- Constants ---
// const PURCHASE_URL = "https://your-purchase-link.com"; // Keep commented if using test key
const DEBOUNCE_DELAY = 350;
// Base CWS URL (UTM parameters will be added dynamically)
const CWS_BASE_URL = "https://chrome.google.com/webstore/detail/glcojplfgdgjboobhadopanojgfjpehj";
// UTM Parameters
const UTM_SOURCE = "extension";
const UTM_CAMPAIGN = "in_app_share";
// --- ADDED: Placeholder for Feedback Form URL ---
const FEEDBACK_FORM_URL = "https://docs.google.com/forms/d/e/1FAIpQLSc2n-Uvv0RrGuz6zcDv_hpKfRggFolEF5d8txFWDwQbEXh_Zg/viewform";
// --- ADDED: Max length for displayed find text in summary ---
const MAX_FIND_DISPLAY_LENGTH = 40;


// --- State Management ---
let currentSettings = {
    // Settings from chrome.storage.sync
    isLicensed: false,
    // Settings from chrome.storage.local
    isEnabled: true,
    ruleBundles: [], // Array of { id: string, name: string, isDefault: boolean, source: string, requiresLicense: boolean, rules: [] }
    activeBundleId: null, // ID of the currently selected bundle
    domainList: { type: 'disabled', domains: [] }, // Default structure
    disabledRuleIds: new Set() // Global set of disabled rule IDs
};
// Separate debounce timers for sync and local storage saves
let saveSyncTimeout, saveLocalTimeout;
let draggedRuleElement = null; // Store the element being dragged
let dropIndicator = null; // Reference to the drop indicator element
let isSavingInternally = false; // Flag to prevent self-triggered UI refresh

// --- DOM Elements ---
const licenseStatusMessage = document.querySelector('#license-status-message');
const licenseForm = document.querySelector('#license-form');
const licenseKeyInput = document.querySelector('#license-key-input');
const activateLicenseBtn = document.querySelector('#activate-license-btn');
const activationStatus = document.querySelector('#activation-status');
const globalDomainFilterType = document.querySelector('#global-domain-filter-type');
const globalDomainListInput = document.querySelector('#global-domain-list-input');
const rulesListContainer = document.querySelector('#rules-list');
const addRuleBtn = document.querySelector('#add-rule-btn'); // Keep for adding rules *within* custom bundles
const ruleTemplate = document.querySelector('.rule-item-template');
const importBundlesBtn = document.querySelector('#import-bundles-btn'); // UPDATED ID
const exportActiveBundleBtn = document.querySelector('#export-active-bundle-btn'); // UPDATED ID
const importFileInput = document.querySelector('#import-file-input');
const shareBtn = document.querySelector('#share-btn'); // Button text is "Spread the Word!" in HTML
const feedbackBtn = document.querySelector('#feedback-btn');
const shareStatus = document.querySelector('#share-status');
const premiumFeaturesArea = document.querySelector('#premium-features-area');
// UPDATED: Bundle Management Elements
const bundleSelector = document.querySelector('#bundle-selector');
const copyBundleBtn = document.querySelector('#copy-bundle-btn'); // Changed from addBundleBtn
const renameBundleBtn = document.querySelector('#rename-bundle-btn');
const deleteBundleBtn = document.querySelector('#delete-bundle-btn'); // ID already correct
const exportAllBtn = document.querySelector('#export-all-btn'); // Added export all button


// --- Utility Functions ---

/** Generates a simple timestamp-based unique ID */
function generateUniqueID(prefix = 'id') {
    return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}


/**
 * Constructs the share URL with appropriate UTM parameters.
 * @param {string} medium - The utm_medium value (e.g., 'share_options').
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

/** Sends message to content scripts to reload settings */
function notifyContentScriptSettingsChanged() {
    chrome.tabs.query({}, (tabs) => { // Query all tabs
        tabs.forEach(tab => {
            if (tab.id) {
                chrome.tabs.sendMessage(tab.id, { action: "settingsUpdated" }, response => {
                    // Check for lastError to avoid console spam if content script isn't injected/listening
                    if (chrome.runtime.lastError) { /* Ignore errors like "Receiving end does not exist" */ }
                });
            }
        });
    });
}

/** Shows a status message below a related element */
function showOptionsStatusMessage(element, message, isError = false, duration = 2500) {
    if (!element) {
        console.warn("Attempted to show status message, but status element not found:", message);
        return;
    }
    element.textContent = message;
    element.style.color = isError ? 'red' : 'green';
    clearTimeout(element.timer); // Clear previous timer if any
    element.timer = setTimeout(() => {
        element.textContent = '';
    }, duration);
}


// --- Storage Functions ---

/** Saves only the isLicensed setting to sync storage, debounced */
function saveSyncSettings() {
    clearTimeout(saveSyncTimeout);
    saveSyncTimeout = setTimeout(() => {
        const settingsToSave = {
            isLicensed: currentSettings.isLicensed
        };
        isSavingInternally = true; // Prevent onChanged listener from re-triggering UI updates
        chrome.storage.sync.set(settingsToSave, () => {
            // Reset flag shortly after save completes
            setTimeout(() => { isSavingInternally = false; }, 100);
            if (chrome.runtime.lastError) {
                console.error("Error saving sync settings (isLicensed):", chrome.runtime.lastError);
                reportErrorToBackground("Error saving sync settings", chrome.runtime.lastError);
            } else {
                console.log("Sync settings saved.", settingsToSave);
                // No need to notify content script for just license change, UI updates handle it
            }
        });
    }, DEBOUNCE_DELAY);
}

/** Saves local settings (rules, active ID, domains, enabled state, disabled IDs), debounced */
function saveLocalSettings(notifyContent = true) {
    clearTimeout(saveLocalTimeout);
    saveLocalTimeout = setTimeout(() => {
        const settingsToSave = {
            // *** Ensure the most current isEnabled state is saved ***
            isEnabled: currentSettings.isEnabled,
            domainList: currentSettings.domainList,
            ruleBundles: currentSettings.ruleBundles,
            activeBundleId: currentSettings.activeBundleId,
            disabledRuleIds: Array.from(currentSettings.disabledRuleIds || new Set()) // Convert Set back to Array
        };
        isSavingInternally = true; // Prevent onChanged listener updates
        chrome.storage.local.set(settingsToSave, () => {
            // Reset flag shortly after save completes
            setTimeout(() => { isSavingInternally = false; }, 100);
            if (chrome.runtime.lastError) {
                console.error("Error saving local settings:", chrome.runtime.lastError);
                // Check for quota error specifically
                if (chrome.runtime.lastError.message.includes("QUOTA_BYTES")) {
                     alert("Error: Could not save rules. Storage quota exceeded. Try exporting existing bundles and removing some, or reduce the number/size of rules.");
                 }
                reportErrorToBackground("Error saving local settings", chrome.runtime.lastError);
            } else {
                console.log("Local settings saved.", settingsToSave);
                if (notifyContent) {
                    notifyContentScriptSettingsChanged();
                }
            }
        });
    }, DEBOUNCE_DELAY);
}


/** Loads all settings from storage (sync and local) */
function loadSettings() {
    return new Promise(async (resolve, reject) => {
        try {
            // Get sync settings (isLicensed)
            const syncResult = await chrome.storage.sync.get(['isLicensed']);
            // Get local settings (isEnabled, ruleBundles, activeBundleId, domainList, disabledRuleIds)
            const localResult = await chrome.storage.local.get(['isEnabled', 'ruleBundles', 'activeBundleId', 'domainList', 'disabledRuleIds']);

            // Safely assign loaded values or defaults
            currentSettings.isLicensed = typeof syncResult.isLicensed === 'boolean' ? syncResult.isLicensed : false;

            currentSettings.isEnabled = typeof localResult.isEnabled === 'boolean' ? localResult.isEnabled : true;
            // *** UPDATED DEFAULT VALUE ***
            currentSettings.domainList = localResult.domainList || { type: 'blacklist', domains: ['docs.google.com', '/.*\\.github\\.io/'] }; // Reverted type, updated domains
            currentSettings.disabledRuleIds = new Set(Array.isArray(localResult.disabledRuleIds) ? localResult.disabledRuleIds : []);

            // Load rule bundles and active ID from local storage
            // UPDATED: Default bundle structure
            currentSettings.ruleBundles = Array.isArray(localResult.ruleBundles) && localResult.ruleBundles.length > 0
               ? localResult.ruleBundles
               : [{ id: 'default_load_error', name: 'Default (Load Error)', isDefault: true, source: 'hardcoded', requiresLicense: false, rules: [] }];
            currentSettings.activeBundleId = localResult.activeBundleId || currentSettings.ruleBundles[0].id; // Default to first bundle if ID missing

            // Ensure activeBundleId actually exists, otherwise reset to the first bundle's ID
            if (!currentSettings.ruleBundles.some(b => b.id === currentSettings.activeBundleId)) {
                console.warn("Active bundle ID not found in loaded bundles, resetting to first bundle.");
                currentSettings.activeBundleId = currentSettings.ruleBundles[0]?.id || null;
            }

            // Data sanitization/migration for rules and bundles (can remain mostly the same)
            currentSettings.ruleBundles.forEach(bundle => {
                bundle.rules = Array.isArray(bundle.rules) ? bundle.rules : []; // Ensure rules is an array
                bundle.rules.forEach((rule, index) => {
                    // Ensure rule has necessary properties
                    if (!rule.domainList) rule.domainList = { type: 'inherit', domains: [] };
                    if (!rule.id) {
                        rule.id = generateUniqueID('rule'); // Use helper
                        console.warn(`Assigned new ID to rule at index ${index} in bundle ${bundle.id}`);
                    }
                    if (typeof rule.description === 'undefined') rule.description = '';
                    // REMOVED: rule.isDefault - now a bundle property
                    // Add other checks as needed
                });
                // Ensure bundle has necessary properties (NEW: source, requiresLicense)
                if (typeof bundle.isDefault === 'undefined') bundle.isDefault = false;
                if (!bundle.name) bundle.name = `Bundle ${bundle.id.slice(-4)}`;
                if (typeof bundle.source === 'undefined') {
                   // Attempt to guess source based on isDefault for older data
                   bundle.source = bundle.isDefault ? 'hardcoded' : 'user';
                   console.warn(`Bundle ${bundle.id} missing source, guessed '${bundle.source}'.`);
                }
                if (typeof bundle.requiresLicense === 'undefined') {
                   // Default pre-existing non-default bundles to NOT require license
                   bundle.requiresLicense = false;
                }
            });

            console.log("Processed settings state:", currentSettings);
            resolve();

        } catch (error) {
             console.error("Error loading settings:", error);
             // Define default state on error - Use defaults from background.js if possible
             // *** UPDATED DEFAULT VALUE ***
             currentSettings = {
                 isLicensed: false, // Sync default
                 isEnabled: true, // Local default
                 ruleBundles: [{ id: 'fallback_default', name: 'Default Rules (Error)', isDefault: true, source: 'hardcoded', requiresLicense: false, rules: [] }], // Local default
                 activeBundleId: 'fallback_default', // Local default
                 domainList: { type: 'blacklist', domains: ['docs.google.com', '/.*\\.github\\.io/'] }, // Local default (reverted type, updated domains)
                 disabledRuleIds: new Set() // Local default
             };
             reportErrorToBackground("Error loading settings", error);
             reject(error);
        }
    });
}

// --- UI Update Functions ---

/** Updates enabled/disabled state of controls within a single rule item based on license and bundle source */
function updateRuleItemUIState(ruleItemElement, isLicensed) {
    if (!ruleItemElement) return; // Guard against null element

    const ruleId = ruleItemElement.dataset.ruleId;
    // Find the bundle this rule belongs to
    const activeBundle = currentSettings.ruleBundles.find(b => b.id === currentSettings.activeBundleId);
    if (!activeBundle) {
        console.warn(`updateRuleItemUIState: Could not find active bundle ${currentSettings.activeBundleId}`);
        // Disable everything if bundle not found
        ruleItemElement.querySelectorAll('input, textarea, button, select, .drag-handle').forEach(el => {
            el.disabled = true;
            el.setAttribute('aria-disabled', 'true');
        });
        return;
    }

    // Determine permissions
    // Editability: Only user-created bundles are editable
    const isEditable = activeBundle.source === 'user';
    // Premium Features: Only available if licensed (applies within both editable and non-editable bundles)
    const allowPremiumFeatures = isLicensed;
    // Rule Removal: Only possible within user-created bundles (license check handled by button state)
    const allowRemove = activeBundle.source === 'user';
    // Rule Toggling: Always allowed for any rule in any bundle (basic feature)
    const allowToggle = true;
    // Dragging: Only allowed within user-created bundles (license check handled by button state)
    const allowDrag = activeBundle.source === 'user';

    // --- Update Basic Inputs (Description, Find, Replace) ---
    ruleItemElement.querySelectorAll('.description-input, .find-input, .replace-input').forEach(input => {
        if (input) {
            input.disabled = !isEditable; // Disable if not user bundle
            input.setAttribute('aria-disabled', String(!isEditable));
        }
    });

    // --- Update Premium Controls (Checkboxes, CSS, Domain Filter) ---
    ruleItemElement.querySelectorAll('.rule-options .premium-control, .per-rule-domain-filter .premium-control, .css-input.premium-control').forEach(control => {
        if (control) {
            // Control is disabled if premium features aren't allowed OR if the bundle isn't editable (for inputs like CSS/domain)
            const isDisabled = !allowPremiumFeatures || (!isEditable && (control.tagName === 'TEXTAREA' || control.tagName === 'SELECT'));
            control.disabled = isDisabled;
            control.setAttribute('aria-disabled', String(isDisabled));
        }
    });
    // Also disable the containers visually if needed via aria-disabled
    // Containers are disabled if premium features are locked OR if the bundle isn't editable
    const premiumContainerDisabled = !allowPremiumFeatures || !isEditable;
    ruleItemElement.querySelector('.rule-options')?.setAttribute('aria-disabled', String(premiumContainerDisabled));
    ruleItemElement.querySelector('.per-rule-domain-filter')?.setAttribute('aria-disabled', String(premiumContainerDisabled));

    // --- Update Remove Rule Button ---
    const removeBtn = ruleItemElement.querySelector('.remove-rule-btn');
     if(removeBtn) {
         // Disabled state depends on license (handled by global UI update)
         // Visibility depends on bundle source
         removeBtn.style.display = allowRemove ? 'block' : 'none';
         removeBtn.setAttribute('aria-disabled', String(!allowRemove || !isLicensed)); // Also consider license
     }

    // --- Update Rule Enable Toggle ---
    const enableToggleControl = ruleItemElement.querySelector('.rule-enable-toggle-control');
    const enableToggleInput = ruleItemElement.querySelector('.rule-enabled-toggle');
    if (enableToggleControl && enableToggleInput) {
        // Ensure ruleId exists before checking Set
        enableToggleInput.checked = ruleId ? !currentSettings.disabledRuleIds.has(ruleId) : true;
        // Toggle is always allowed, so never disabled based on permissions
        enableToggleControl.setAttribute('aria-disabled', 'false');
        enableToggleInput.disabled = false;
    }

     // --- Update Disabled Indicator in Summary ---
     const disabledIndicator = ruleItemElement.querySelector('.disabled-indicator');
     if (disabledIndicator) {
         disabledIndicator.style.display = (ruleId && currentSettings.disabledRuleIds.has(ruleId)) ? 'inline' : 'none';
     }

    // --- Update Draggable State ---
    const dragHandle = ruleItemElement.querySelector('.drag-handle');
    if (dragHandle) {
        // Draggable state depends on license (handled by global UI update)
        // Visibility depends on bundle source
        dragHandle.style.display = allowDrag ? 'inline-block' : 'none';
        dragHandle.draggable = allowDrag && isLicensed; // Draggable only if source=user AND licensed
        dragHandle.setAttribute('aria-disabled', String(!allowDrag || !isLicensed));
        dragHandle.style.cursor = (allowDrag && isLicensed) ? 'grab' : 'default';
    }

    // Update visibility of per-rule domain textarea based on select value and license/editability
    updatePerRuleDomainTextareaVisibility(ruleItemElement);
}


/** Updates the entire options page UI based on the global license state */
function updateGlobalUIState(isLicensed) {
    console.log("Updating global UI for license status:", isLicensed);
    const isDisabled = !isLicensed; // True if NOT licensed

    // Show/Hide License Form
    if (licenseForm) {
        licenseForm.style.display = isLicensed ? 'none' : 'block';
    }
    // Update License Status Box Message and Class
    if (licenseStatusMessage) {
        licenseStatusMessage.textContent = isLicensed ? 'Additional Features Unlocked' : 'Standard Features Active';
        licenseStatusMessage.className = isLicensed ? 'status-box licensed' : 'status-box unlicensed';
    }
    // Disable/Enable Premium Features Area (visually)
    if (premiumFeaturesArea) {
        premiumFeaturesArea.setAttribute('aria-disabled', String(isDisabled));
    }

    // Disable/Enable all controls marked as premium within sections AND bundle management
    document.querySelectorAll('.premium-section .premium-control, .bundle-management .premium-control').forEach(control => {
        if (control) {
            control.disabled = isDisabled;
            control.setAttribute('aria-disabled', String(isDisabled));
            // Store original title if not already stored
            if (!control.dataset.originalTitle) {
                control.dataset.originalTitle = control.title || '';
            }
        }
    });
     // Also store original title for the drag handle specifically
     document.querySelectorAll('.drag-handle').forEach(handle => {
         if (!handle.dataset.originalTitle) {
             handle.dataset.originalTitle = handle.title || '';
         }
     });
     // And the Add Rule button (which adds to custom bundles)
     if (addRuleBtn && !addRuleBtn.dataset.originalTitle) {
         addRuleBtn.dataset.originalTitle = addRuleBtn.title || '';
     }


    // Update bundle selector options based on license
    renderBundleSelector(); // Re-render to apply disabled state based on requiresLicense

    // Update UI state for all existing rule items based on the new license status
    // Note: This needs to happen *after* renderBundleSelector ensures the active bundle ID is correct
    rulesListContainer.querySelectorAll('.rule-item:not(.rule-item-template)').forEach(item => {
        updateRuleItemUIState(item, isLicensed);
    });

    // Update visibility and disabled state of Rename/Delete/Copy Bundle buttons
    updateBundleManagementButtons();

    // Update visibility of the "Add New Rule" button based on the active bundle
    updateAddRuleButtonVisibility(); // Ensure this is called after active bundle is set

    // Update all tooltips based on the new license state
    updateTooltipsForState(document.body, isLicensed);

    console.log("Finished updating global UI state.");
}

/** Shows or hides the per-rule domain list textarea based on select and license/editability */
function updatePerRuleDomainTextareaVisibility(ruleItemElement) {
    const typeSelect = ruleItemElement.querySelector('.rule-domain-filter-type');
    const textareaContainer = ruleItemElement.querySelector('.rule-domain-list-container');
    const textarea = ruleItemElement.querySelector('.rule-domain-list-input');
    if (!typeSelect || !textareaContainer || !textarea) return;

    // Find the bundle this rule belongs to
    const activeBundle = currentSettings.ruleBundles.find(b => b.id === currentSettings.activeBundleId);
    const isEditable = activeBundle?.source === 'user'; // Check if bundle is user-created

    // Textarea should be visible only if type is whitelist/blacklist
    const showTextarea = typeSelect.value === 'whitelist' || typeSelect.value === 'blacklist';
    textareaContainer.classList.toggle('hidden', !showTextarea);

    // Textarea should be enabled only if visible AND the user is licensed AND the bundle is editable
    textarea.disabled = !showTextarea || !currentSettings.isLicensed || !isEditable;
    textarea.setAttribute('aria-disabled', String(textarea.disabled));
}

/** Renders the list of rules for the currently active bundle */
function renderRuleList() {
    const activeBundle = currentSettings.ruleBundles.find(b => b.id === currentSettings.activeBundleId);
    const rules = activeBundle?.rules || [];
    console.log(`Rendering rule list for bundle "${activeBundle?.name || 'N/A'}" (Source: ${activeBundle?.source || 'N/A'}) with ${rules.length} rules.`);

    if (!rulesListContainer) { console.error("renderRuleList: rulesListContainer not found!"); return; }

    // Preserve scroll position if possible
    const scrollPosition = rulesListContainer.scrollTop;

    // Clear existing rule elements (but not the template or indicator)
    rulesListContainer.querySelectorAll('.rule-item:not(.rule-item-template)').forEach(item => item.remove());

    // Ensure drop indicator exists and is at the top (hidden initially)
    if (dropIndicator && !rulesListContainer.contains(dropIndicator)) {
        rulesListContainer.prepend(dropIndicator); // Add if missing
        dropIndicator.style.display = 'none'; // Ensure hidden
    }

    // Display message if no rules exist in the active bundle
    if (rules.length === 0) {
        // Add message if it doesn't exist
        if (!rulesListContainer.querySelector('.no-rules-message')) {
            const noRulesPara = document.createElement('p');
            noRulesPara.className = 'no-rules-message';
            // Adjust message based on whether the bundle is editable
            noRulesPara.textContent = (activeBundle?.source === 'user' && currentSettings.isLicensed)
                ? 'No rules defined in this bundle yet. Add one below!'
                : 'This bundle currently has no rules defined.';
            rulesListContainer.appendChild(noRulesPara);
        }
    } else {
         // Remove 'no rules' message if rules exist
         const noRulesMsg = rulesListContainer.querySelector('.no-rules-message');
         if(noRulesMsg) noRulesMsg.remove();

         // Create and append element for each rule in the active bundle
         rules.forEach((rule) => {
             try {
                 const ruleElement = createRuleElement(rule);
                 if (ruleElement) {
                     rulesListContainer.appendChild(ruleElement);
                 }
             } catch (error) {
                 console.error("renderRuleList: Error creating/appending rule element for rule:", rule, error);
                 reportErrorToBackground("Error rendering rule element", error, { ruleId: rule?.id, bundleId: currentSettings.activeBundleId });
            }
        });
    }

     // Restore scroll position
     rulesListContainer.scrollTop = scrollPosition;
    // Update visibility of the "Add New Rule" button based on the active bundle
    updateAddRuleButtonVisibility();
    console.log("Finished rendering rule list.");
}

/** Creates a DOM element for a single rule from template */
function createRuleElement(ruleData) {
    if (!ruleTemplate) { console.error("createRuleElement: ruleTemplate not found!"); return null; }
    if (!ruleData || typeof ruleData.id === 'undefined') {
        console.error("createRuleElement: Invalid ruleData or missing ID:", ruleData);
        // Create a dummy rule to avoid breaking the loop, but log error
        ruleData = { id: generateUniqueID('rule_invalid'), find: 'INVALID', replace: 'RULE' };
    }

    // Clone the template node
    const newRuleItem = ruleTemplate.cloneNode(true);
    const uniqueId = ruleData.id;

    // Configure the cloned element
    newRuleItem.classList.remove('rule-item-template');
    newRuleItem.style.display = 'block'; // Make it visible
    newRuleItem.dataset.ruleId = uniqueId;
    // REMOVED: data-is-default - editability now based on bundle source

    // Update IDs and labels for accessibility and functionality
    try {
        newRuleItem.querySelectorAll('[id*="{id}"]').forEach(el => { el.id = el.id.replace('{id}', uniqueId); });
        newRuleItem.querySelectorAll('[aria-describedby*="{id}"]').forEach(el => { el.setAttribute('aria-describedby', el.getAttribute('aria-describedby').replace('{id}', uniqueId)); });
        newRuleItem.querySelectorAll('label[for*="{id}"]').forEach(el => { el.setAttribute('for', el.getAttribute('for').replace('{id}', uniqueId)); });
    } catch (e) {
        console.error("Error updating IDs/labels for rule element:", uniqueId, e);
        reportErrorToBackground("Error updating IDs/labels", e, { ruleId: uniqueId });
    }

    // Populate summary elements
    const summaryDesc = newRuleItem.querySelector('.rule-display-description');
    const summaryFindReplace = newRuleItem.querySelector('.rule-display-find-replace');
    if (summaryDesc) summaryDesc.textContent = ruleData.description || `Rule ${uniqueId.slice(-4)}`;

    // --- UPDATED: Format find text display in summary ---
    if (summaryFindReplace) {
        let findDisplayText = ruleData.find || '?';
        if (ruleData.isRegex) {
            findDisplayText = 'Regex Pattern'; // Display "Regex Pattern" if it's a regex
        } else if (findDisplayText.length > MAX_FIND_DISPLAY_LENGTH) {
            // Truncate non-regex find text if too long
            findDisplayText = findDisplayText.substring(0, MAX_FIND_DISPLAY_LENGTH) + '...';
        }
        summaryFindReplace.textContent = `${findDisplayText} -> ${ruleData.replace || '?'}`;
    }
    // --- END UPDATED ---

    const disabledIndicator = newRuleItem.querySelector('.disabled-indicator');
    if (disabledIndicator) {
        disabledIndicator.style.display = currentSettings.disabledRuleIds.has(uniqueId) ? 'inline' : 'none';
    }

    // Populate input fields and controls
    const descInput = newRuleItem.querySelector('.description-input');
    const findInput = newRuleItem.querySelector('.find-input');
    const replaceInput = newRuleItem.querySelector('.replace-input');
    const cssInput = newRuleItem.querySelector('.css-input');
    const regexToggle = newRuleItem.querySelector('.regex-toggle');
    const caseToggle = newRuleItem.querySelector('.case-toggle');
    const wholeWordToggle = newRuleItem.querySelector('.whole-word-toggle');
    const domainTypeSelect = newRuleItem.querySelector('.rule-domain-filter-type');
    const domainListTextarea = newRuleItem.querySelector('.rule-domain-list-input');
    const enableToggleInput = newRuleItem.querySelector('.rule-enabled-toggle');

    // Set values safely, providing defaults
    if (descInput) descInput.value = ruleData.description || '';
    if (findInput) findInput.value = ruleData.find || '';
    if (replaceInput) replaceInput.value = ruleData.replace || '';
    if (cssInput) cssInput.value = ruleData.css || '';
    if (regexToggle) regexToggle.checked = ruleData.isRegex || false;
    if (caseToggle) caseToggle.checked = ruleData.isCaseSensitive || false;
    if (wholeWordToggle) wholeWordToggle.checked = ruleData.isWholeWord || false;

    // Handle nested domainList object carefully
    const ruleDomainList = ruleData.domainList || { type: 'inherit', domains: [] };
    if (domainTypeSelect) {
        domainTypeSelect.value = ruleDomainList.type || 'inherit';
    }
    if (domainListTextarea) {
        domainListTextarea.value = Array.isArray(ruleDomainList.domains) ? ruleDomainList.domains.join('\n') : '';
    }
    if (enableToggleInput) {
        enableToggleInput.checked = !currentSettings.disabledRuleIds.has(uniqueId);
    }

    // Add/Update Tooltips within the rule template
    const dragHandle = newRuleItem.querySelector('.drag-handle');
    if (dragHandle) {
        dragHandle.title = 'Drag to reorder rule (Unlockable feature, custom bundles only)';
        dragHandle.dataset.originalTitle = dragHandle.title; // Store original
    }
    const enableToggleControl = newRuleItem.querySelector('.rule-enable-toggle-control');
     if (enableToggleControl) {
         enableToggleControl.title = 'Enable or disable this specific rule';
         enableToggleControl.dataset.originalTitle = enableToggleControl.title;
     }
     if (descInput) {
         descInput.title = 'Optional name or description for this rule (Editable in custom bundles)';
         descInput.dataset.originalTitle = descInput.title;
     }
     if (findInput) {
         findInput.title = 'Text or pattern to find (Editable in custom bundles)';
         findInput.dataset.originalTitle = findInput.title;
     }
     if (replaceInput) {
         replaceInput.title = 'Text to replace the found text with (Editable in custom bundles)';
         replaceInput.dataset.originalTitle = replaceInput.title;
     }
     if (cssInput) {
         cssInput.title = 'Apply custom CSS styles (Unlockable feature, custom bundles only)';
         cssInput.dataset.originalTitle = cssInput.title;
     }
     const regexLabel = regexToggle?.closest('label');
     if (regexLabel) {
         regexLabel.title = 'Use Regular Expressions (Unlockable feature)';
         regexLabel.dataset.originalTitle = regexLabel.title;
     }
     const caseLabel = caseToggle?.closest('label');
     if (caseLabel) {
         caseLabel.title = 'Match Case Sensitivity (Unlockable feature)';
         caseLabel.dataset.originalTitle = caseLabel.title;
     }
     const wholeWordLabel = wholeWordToggle?.closest('label');
     if (wholeWordLabel) {
         wholeWordLabel.title = 'Match Whole Word Only (Unlockable feature)';
         wholeWordLabel.dataset.originalTitle = wholeWordLabel.title;
     }
     if (domainTypeSelect) {
         domainTypeSelect.title = 'Set domain filter for this specific rule (Unlockable feature, custom bundles only)';
         domainTypeSelect.dataset.originalTitle = domainTypeSelect.title;
     }
     if (domainListTextarea) {
         domainListTextarea.title = 'Enter domains/RegEx for this rule only (Unlockable feature, custom bundles only)';
         domainListTextarea.dataset.originalTitle = domainListTextarea.title;
     }
     const removeBtn = newRuleItem.querySelector('.remove-rule-btn');
     if (removeBtn) {
         removeBtn.title = 'Remove this rule (Unlockable feature, custom bundles only)';
         removeBtn.dataset.originalTitle = removeBtn.title;
     }


    // Add event listeners for interaction
    addEventListenersForRule(newRuleItem, uniqueId);

    // Set initial UI state (enabled/disabled controls) based on license and bundle source
    updateRuleItemUIState(newRuleItem, currentSettings.isLicensed);

    // Update tooltips based on initial license state
    updateTooltipsForState(newRuleItem, currentSettings.isLicensed);


    return newRuleItem;
}

/** Populates the bundle selector dropdown */
function renderBundleSelector() {
    if (!bundleSelector) return;
    const selectedId = currentSettings.activeBundleId;
    bundleSelector.innerHTML = ''; // Clear existing options

    currentSettings.ruleBundles.forEach(bundle => {
        const option = document.createElement('option');
        option.value = bundle.id;
        // Indicate source and default status in the text
        let label = bundle.name;
        if (bundle.isDefault) label += ' [Default]';
        else if (bundle.source === 'preloaded') label += ' [Preloaded]';
        else if (bundle.source === 'user') label += ' [Custom]'; // Add custom indicator
        option.textContent = label;
        option.selected = bundle.id === selectedId;

        // Disable selection if the bundle requires a license and the user isn't licensed
        if (bundle.requiresLicense && !currentSettings.isLicensed) {
            option.disabled = true;
            option.title = "Unlock features to use this bundle";
            option.textContent += ' (Locked)'; // Indicate locked status
        } else {
             option.disabled = false;
             option.title = `Select the "${bundle.name}" rule bundle`; // Standard title
        }

        bundleSelector.appendChild(option);
    });
}

/** Updates visibility/state of Copy/Rename/Delete bundle buttons */
function updateBundleManagementButtons() {
    const activeBundle = currentSettings.ruleBundles.find(b => b.id === currentSettings.activeBundleId);
    const isLicensed = currentSettings.isLicensed;
    // Determine permissions based on the active bundle's source and license status
    const allowRename = isLicensed && activeBundle?.source === 'user';
    // Allow deleting any bundle EXCEPT the hardcoded default one
    const allowDelete = activeBundle?.source !== 'hardcoded';
    // Allow copying a new bundle only if licensed
    const allowCopy = isLicensed;

    if (copyBundleBtn) {
        copyBundleBtn.style.display = isLicensed ? 'inline-block' : 'none'; // Show only if licensed
        // Copy button should be enabled if licensed and a bundle is selected
        copyBundleBtn.disabled = !allowCopy || !activeBundle;
        copyBundleBtn.setAttribute('aria-disabled', String(!allowCopy || !activeBundle));
    }
    if (renameBundleBtn) {
        renameBundleBtn.style.display = allowRename ? 'inline-block' : 'none'; // Show only if licensed and source is 'user'
        renameBundleBtn.disabled = !allowRename;
        renameBundleBtn.setAttribute('aria-disabled', String(!allowRename));
    }
    if (deleteBundleBtn) {
        // Show delete unless it's the hardcoded default
        deleteBundleBtn.style.display = allowDelete ? 'inline-block' : 'none';
        deleteBundleBtn.disabled = !allowDelete;
        deleteBundleBtn.setAttribute('aria-disabled', String(!allowDelete));
    }
}

/** Updates the visibility of the "Add New Rule" button */
function updateAddRuleButtonVisibility() {
    const activeBundle = currentSettings.ruleBundles.find(b => b.id === currentSettings.activeBundleId);
    // Show button only if licensed AND the active bundle is user-created
    const showAddRule = currentSettings.isLicensed && activeBundle?.source === 'user';
    if (addRuleBtn) {
        // UPDATED: Set display style instead of just disabling
        addRuleBtn.style.display = showAddRule ? 'block' : 'none';
        addRuleBtn.disabled = !showAddRule; // Keep disabled state consistent
        addRuleBtn.setAttribute('aria-disabled', String(!showAddRule));
    }
}


/** Helper function to update tooltips based on license state */
function updateTooltipsForState(parentElement, isLicensed) {
    // Select elements that have the original title stored
    parentElement.querySelectorAll('[data-original-title]').forEach(el => {
        const originalTitle = el.dataset.originalTitle;
        const unlockableText = '(Unlockable feature'; // Match start of phrase
        const customBundleText = 'custom bundles only'; // Match end of phrase
        const hasUnlockableText = originalTitle.toLowerCase().includes(unlockableText.toLowerCase());
        const hasCustomBundleText = originalTitle.toLowerCase().includes(customBundleText.toLowerCase());

        let finalTitle = originalTitle;

        // If licensed, remove unlockable/custom bundle indicators
        if (isLicensed) {
            if (hasUnlockableText) {
                // Remove the unlockable phrase variations
                finalTitle = finalTitle.replace(/\(?Unlockable feature[^)]*\)?/gi, '').trim();
            }
            if (hasCustomBundleText) {
                 // Remove the custom bundle phrase variations
                 finalTitle = finalTitle.replace(/,? custom bundles only\)?/gi, '').trim();
            }
        } else {
            // If unlicensed, ensure the text is present *only if* it was originally there
            // This part is tricky because the original title might have BOTH phrases.
            // We simply revert to the original title if unlicensed, as it contains the correct indicators.
            finalTitle = originalTitle;
        }
        // Clean up potential double spaces or trailing commas/spaces
        el.title = finalTitle.replace(/\s{2,}/g, ' ').replace(/,\s*$/, '').trim();
    });
}


// --- Event Handling ---
/** Attaches event listeners to controls within a single rule item */
function addEventListenersForRule(ruleItemElement, ruleId) {
    // --- Input Change Listeners (Update state and save) ---
    // Save local settings after changes
    ruleItemElement.querySelector('.description-input')?.addEventListener('change', (e) => { updateRuleData(ruleId, 'description', e.target.value); saveLocalSettings(true); });
    ruleItemElement.querySelector('.find-input')?.addEventListener('change', (e) => { updateRuleData(ruleId, 'find', e.target.value); saveLocalSettings(true); });
    ruleItemElement.querySelector('.replace-input')?.addEventListener('change', (e) => { updateRuleData(ruleId, 'replace', e.target.value); saveLocalSettings(true); });
    ruleItemElement.querySelector('.css-input')?.addEventListener('change', (e) => { updateRuleData(ruleId, 'css', e.target.value); saveLocalSettings(true); });
    // Premium toggles
    ruleItemElement.querySelector('.regex-toggle')?.addEventListener('change', (e) => { updateRuleData(ruleId, 'isRegex', e.target.checked); saveLocalSettings(true); });
    ruleItemElement.querySelector('.case-toggle')?.addEventListener('change', (e) => { updateRuleData(ruleId, 'isCaseSensitive', e.target.checked); saveLocalSettings(true); });
    ruleItemElement.querySelector('.whole-word-toggle')?.addEventListener('change', (e) => { updateRuleData(ruleId, 'isWholeWord', e.target.checked); saveLocalSettings(true); });

    // --- Domain Filter Listeners ---
    const domainTypeSelect = ruleItemElement.querySelector('.rule-domain-filter-type');
    if (domainTypeSelect) {
        domainTypeSelect.addEventListener('change', (e) => {
            updateRuleData(ruleId, 'domainList.type', e.target.value);
            updatePerRuleDomainTextareaVisibility(ruleItemElement);
            saveLocalSettings(true); // Save when domain type changes
        });
    }
    const domainListTextarea = ruleItemElement.querySelector('.rule-domain-list-input');
    if (domainListTextarea) {
        domainListTextarea.addEventListener('change', (e) => {
            const domains = e.target.value.split('\n').map(d => d.trim()).filter(d => d.length > 0);
            updateRuleData(ruleId, 'domainList.domains', domains);
            saveLocalSettings(true); // Save when domain list changes
        });
    }

    // --- Rule Enable Toggle Listener ---
    const enableToggleInput = ruleItemElement.querySelector('.rule-enabled-toggle');
    if (enableToggleInput) {
        enableToggleInput.addEventListener('change', (e) => {
            const isEnabled = e.target.checked;
            const indicator = ruleItemElement.querySelector('.disabled-indicator');
            if (isEnabled) {
                currentSettings.disabledRuleIds.delete(ruleId);
            } else {
                currentSettings.disabledRuleIds.add(ruleId);
            }
            if (indicator) {
                indicator.style.display = isEnabled ? 'none' : 'inline';
            }
            saveLocalSettings(true); // Save the updated disabled set to local storage
        });
    }

    // --- Remove Rule Button Listener ---
    ruleItemElement.querySelector('.remove-rule-btn')?.addEventListener('click', () => handleRemoveRule(ruleItemElement, ruleId));

    // --- Input Listeners (Update summary display immediately) ---
    ruleItemElement.querySelector('.description-input')?.addEventListener('input', (e) => {
        const summaryDesc = ruleItemElement.querySelector('.rule-display-description');
        if (summaryDesc) summaryDesc.textContent = e.target.value || `Rule ${ruleId.slice(-4)}`;
    });

    // --- UPDATED: Update summary find/replace display on input ---
    const updateSummaryFindReplace = (ruleItemEl) => {
        const findInputEl = ruleItemEl.querySelector('.find-input');
        const replaceInputEl = ruleItemEl.querySelector('.replace-input');
        const regexToggleEl = ruleItemEl.querySelector('.regex-toggle');
        const summaryFindReplaceEl = ruleItemEl.querySelector('.rule-display-find-replace');

        if (!findInputEl || !replaceInputEl || !summaryFindReplaceEl) return;

        let findVal = findInputEl.value || '?';
        const replaceVal = replaceInputEl.value || '?';
        const isRegex = regexToggleEl?.checked || false;

        let findDisplayText = findVal;
        if (isRegex) {
            findDisplayText = 'Regex Pattern'; // Display "Regex Pattern" if it's a regex
        } else if (findDisplayText.length > MAX_FIND_DISPLAY_LENGTH) {
            // Truncate non-regex find text if too long
            findDisplayText = findDisplayText.substring(0, MAX_FIND_DISPLAY_LENGTH) + '...';
        }

        summaryFindReplaceEl.textContent = `${findDisplayText} -> ${replaceVal}`;
    };

    ruleItemElement.querySelector('.find-input')?.addEventListener('input', () => updateSummaryFindReplace(ruleItemElement));
    ruleItemElement.querySelector('.replace-input')?.addEventListener('input', () => updateSummaryFindReplace(ruleItemElement));
    ruleItemElement.querySelector('.regex-toggle')?.addEventListener('change', () => updateSummaryFindReplace(ruleItemElement));
    // --- END UPDATED ---


    // --- Drag and Drop Listeners ---
    const dragHandle = ruleItemElement.querySelector('.drag-handle');
    if (dragHandle) {
        dragHandle.addEventListener('dragstart', handleDragStart);
        dragHandle.style.cursor = dragHandle.draggable ? 'grab' : 'default';
    }
    ruleItemElement.addEventListener('dragover', handleDragOver);
    ruleItemElement.addEventListener('dragleave', handleDragLeave);
    ruleItemElement.addEventListener('drop', handleDrop);
    ruleItemElement.addEventListener('dragend', handleDragEnd);
}

/** Handles removing a rule from the active bundle */
function handleRemoveRule(ruleItemElement, ruleId) {
     const activeBundleIndex = currentSettings.ruleBundles.findIndex(b => b.id === currentSettings.activeBundleId);
     if (activeBundleIndex === -1) {
         console.error("Cannot remove rule, active bundle not found.");
         return;
     }
     const activeBundle = currentSettings.ruleBundles[activeBundleIndex];
     // Ensure the bundle is editable (source === 'user') before allowing rule removal
     if (activeBundle.source !== 'user' || !currentSettings.isLicensed) {
         console.warn("Attempted to remove rule from non-user or locked bundle.");
         alert("Rules can only be removed from custom bundles when features are unlocked.");
         return;
     }

     activeBundle.rules = activeBundle.rules.filter(r => r.id !== ruleId);
     currentSettings.disabledRuleIds.delete(ruleId); // Also remove from disabled set if present
     saveLocalSettings(true); // Save updated rules and disabled IDs to local storage
     ruleItemElement.remove(); // Remove from DOM

     // Add 'no rules' message if needed
     if (activeBundle.rules.length === 0 && rulesListContainer && !rulesListContainer.querySelector('.no-rules-message')) {
         const noRulesPara = document.createElement('p');
         noRulesPara.className = 'no-rules-message';
         noRulesPara.textContent = 'No rules defined in this bundle yet. Add one below!';
         rulesListContainer.appendChild(noRulesPara);
     }
     reportEventToBackground('rule_removed', { bundle_id: activeBundle.id });
}

/** Updates rule data in the active bundle's state */
function updateRuleData(ruleId, propertyPath, value) {
     const activeBundleIndex = currentSettings.ruleBundles.findIndex(b => b.id === currentSettings.activeBundleId);
     if (activeBundleIndex === -1) {
         console.error("Cannot update rule, active bundle not found.");
         return;
     }
     const activeBundle = currentSettings.ruleBundles[activeBundleIndex];
     // Prevent updates if bundle is not user-created (read-only)
     if (activeBundle.source !== 'user') {
         console.warn(`Attempted to update rule in read-only bundle (Source: ${activeBundle.source}).`);
         // Optionally revert UI change here if needed, though disabled state should prevent it
         return;
     }

     const ruleIndex = activeBundle.rules.findIndex(r => r.id === ruleId);
     if (ruleIndex === -1) {
         console.warn("updateRuleData: Rule not found in active bundle for ID:", ruleId);
         return;
     }
     const pathParts = propertyPath.split('.');
     let current = activeBundle.rules[ruleIndex];
     try {
         for (let i = 0; i < pathParts.length - 1; i++) {
             if (!current[pathParts[i]]) {
                 current[pathParts[i]] = {}; // Create intermediate objects if needed (e.g., for domainList)
             }
             current = current[pathParts[i]];
         }
         current[pathParts[pathParts.length - 1]] = value;
         // Note: Saving is now handled by the individual event listeners that call this
     } catch (error) {
         console.error("Error updating rule data:", error, { ruleId, propertyPath, value });
         reportErrorToBackground("Error updating rule data", error, { ruleId, propertyPath, bundleId: activeBundle.id });
     }
}

/** Handles license activation attempt */
async function handleLicenseActivation() {
     const key = licenseKeyInput?.value.trim();
     if (!key) {
         showOptionsStatusMessage(activationStatus, "Please enter an unlock code.", true);
         return;
     }
     if (!activateLicenseBtn || !activationStatus) return;

     activateLicenseBtn.disabled = true;
     activateLicenseBtn.textContent = 'Unlocking...';
     showOptionsStatusMessage(activationStatus,"Verifying code...");

     try {
         // Send message to background script for validation
         const response = await chrome.runtime.sendMessage({ action: "validateLicense", key: key });

         if (response?.success && response.isValid) {
             showOptionsStatusMessage(activationStatus,"Features Unlocked!");
             currentSettings.isLicensed = true; // Update state first
             if(licenseKeyInput) licenseKeyInput.value = '';
             // No need to call saveSyncSettings here, background script handles it on successful validation
             updateGlobalUIState(true); // Update UI immediately
             // No need to notify content script, background does it if needed
             reportEventToBackground('features_unlocked', { method: 'license_key' });
         } else {
             const errorMessage = response?.isValid === false ? "Invalid code." : `Error: ${response?.error || 'Unknown validation error'}`;
             showOptionsStatusMessage(activationStatus, errorMessage, true);
             if (activateLicenseBtn) activateLicenseBtn.disabled = false;
         }
     } catch (error) {
         console.error("Error sending validation message:", error);
         showOptionsStatusMessage(activationStatus,`Error communicating with background: ${error.message}`, true);
         if (activateLicenseBtn) activateLicenseBtn.disabled = false;
         reportErrorToBackground("Error sending license validation message", error);
     } finally {
         if(activateLicenseBtn && !currentSettings.isLicensed) {
             activateLicenseBtn.textContent = 'Unlock Features';
         }
     }
}

/** Opens the Google Form link in a new tab */
function handleFeedbackClick() {
    if (!FEEDBACK_FORM_URL || FEEDBACK_FORM_URL === "YOUR_GOOGLE_FORM_LINK_HERE") {
        console.warn("Feedback button clicked, but FEEDBACK_FORM_URL is not set.");
        showOptionsStatusMessage(shareStatus, "Feedback form link not configured.", true);
        return;
    }
    window.open(FEEDBACK_FORM_URL, '_blank');
    reportEventToBackground('feedback_button_clicked');
}

/** Handles switching the active bundle */
function handleBundleChange(event) {
    const newBundleId = event.target.value;
    if (newBundleId !== currentSettings.activeBundleId) {
        console.log(`Switching active bundle to: ${newBundleId}`);
        currentSettings.activeBundleId = newBundleId;
        saveLocalSettings(true); // Save the new active ID to local storage and notify
        renderRuleList(); // Re-render rules for the new bundle
        updateBundleManagementButtons(); // Update Rename/Delete button visibility/state
        // Send GA event
        const selectedBundle = currentSettings.ruleBundles.find(b => b.id === newBundleId);
        reportEventToBackground('bundle_switched', {
            bundle_id: newBundleId,
            bundle_name: selectedBundle?.name,
            bundle_source: selectedBundle?.source, // Track source
            is_default_bundle: selectedBundle?.isDefault // Keep for potential analysis
        });
    }
}

/** Handles copying the currently active bundle */
function handleCopyBundle() {
    if (!currentSettings.isLicensed) {
        alert("Unlock features to copy bundles.");
        return;
    }
    const activeBundle = currentSettings.ruleBundles.find(b => b.id === currentSettings.activeBundleId);
    if (!activeBundle) {
        alert("Please select a bundle to copy first.");
        return;
    }

    // Create a deep copy to avoid modifying the original
    let newBundle;
    try {
        newBundle = JSON.parse(JSON.stringify(activeBundle));
    } catch (e) {
        console.error("Failed to deep copy bundle:", e);
        alert("Error copying bundle. See console for details.");
        reportErrorToBackground("Error deep copying bundle", e, { bundleId: activeBundle.id });
        return;
    }

    // Assign new properties for the copied bundle
    newBundle.id = generateUniqueID('bundle');
    newBundle.name = `Copy of ${activeBundle.name}`;
    newBundle.isDefault = false; // Copies are never the primary default
    newBundle.source = 'user'; // Copies are always user-created
    newBundle.requiresLicense = false; // User bundles don't require license beyond initial creation

    // Assign new unique IDs to all rules within the copied bundle
    if (Array.isArray(newBundle.rules)) {
        newBundle.rules.forEach(rule => {
            rule.id = generateUniqueID('rule');
            // Ensure copied rules don't inherit 'isDefault' if it existed before
            delete rule.isDefault; // Remove isDefault from copied rules
        });
    } else {
        newBundle.rules = []; // Ensure rules array exists
    }

    // Add the new bundle to the list
    currentSettings.ruleBundles.push(newBundle);
    currentSettings.activeBundleId = newBundle.id; // Switch to the new bundle

    saveLocalSettings(true); // Save updated bundles and active ID to local storage

    renderBundleSelector(); // Update dropdown
    renderRuleList(); // Show the new bundle
    updateBundleManagementButtons(); // Update buttons

    alert(`Created bundle "${newBundle.name}"! You can now edit its rules.`);
    reportEventToBackground('bundle_copied', {
        new_bundle_id: newBundle.id,
        source_bundle_id: activeBundle.id,
        source_bundle_name: activeBundle.name,
        source_bundle_source: activeBundle.source
    });
}


/** Handles renaming the active custom bundle */
function handleRenameBundle() {
    if (!currentSettings.isLicensed) return; // License check (redundant due to button state, but safe)
    const activeBundle = currentSettings.ruleBundles.find(b => b.id === currentSettings.activeBundleId);
    // Allow renaming only if licensed AND source is 'user'
    if (!activeBundle || activeBundle.source !== 'user') {
        alert("Only custom bundles (created via Copy or Import) can be renamed.");
        return;
    }

    const newName = prompt("Enter new name for bundle:", activeBundle.name);
    if (newName && newName.trim() !== "" && newName !== activeBundle.name) {
        // Optional: Check if name already exists among other bundles
        if (currentSettings.ruleBundles.some(b => b.id !== activeBundle.id && b.name.toLowerCase() === newName.trim().toLowerCase())) {
            alert("A bundle with this name already exists.");
            return;
        }
        activeBundle.name = newName.trim();
        saveLocalSettings(true); // Save the updated bundle data to local storage
        renderBundleSelector(); // Update the dropdown to show the new name
        reportEventToBackground('bundle_renamed', { bundle_id: activeBundle.id });
    } else if (newName !== null) { // User didn't cancel but entered empty/same name
        alert("Invalid or unchanged name provided.");
    }
}

/** Handles deleting the active custom bundle */
function handleDeleteBundle() {
    // No license check needed here, as button state handles license requirement
    const activeBundleIndex = currentSettings.ruleBundles.findIndex(b => b.id === currentSettings.activeBundleId);
    if (activeBundleIndex === -1) return; // Should not happen

    const bundleToDelete = currentSettings.ruleBundles[activeBundleIndex];
    // Prevent deletion only if it's the hardcoded default
    if (bundleToDelete.source === 'hardcoded') { // Check source instead of isDefault
        alert("The primary default bundle cannot be deleted.");
        return;
    }

    // Check if it's the last bundle remaining (should only happen if primary default was somehow removed - safety)
    if (currentSettings.ruleBundles.length <= 1) {
        alert("Cannot delete the last remaining bundle.");
        return;
    }

    if (confirm(`Are you sure you want to delete the bundle "${bundleToDelete.name}"? This cannot be undone.`)) {
        const deletedBundleId = bundleToDelete.id;
        // Remove the bundle
        currentSettings.ruleBundles.splice(activeBundleIndex, 1);
        // Switch active bundle to the first one remaining (which should always be the hardcoded default if it exists)
        currentSettings.activeBundleId = currentSettings.ruleBundles[0].id;

        saveLocalSettings(true); // Save updated bundles and active ID to local storage

        renderBundleSelector(); // Update selector
        renderRuleList(); // Render rules for the new active bundle
        updateBundleManagementButtons(); // Update button states

        reportEventToBackground('bundle_deleted', { bundle_id: deletedBundleId, bundle_source: bundleToDelete.source });
    }
}


/** Sets up global event listeners for the page */
function setupEventListeners() {
    addRuleBtn?.addEventListener('click', handleAddRule); // Keep for adding rules within custom bundles
    exportActiveBundleBtn?.addEventListener('click', handleExportActiveBundle); // UPDATED ID/Handler
    importBundlesBtn?.addEventListener('click', handleImportBundles); // UPDATED ID/Handler
    importFileInput?.addEventListener('change', processImportFile); // Listener for file input
    // Save global domain filter changes to local storage
    globalDomainFilterType?.addEventListener('change', saveGlobalDomainFilter);
    globalDomainListInput?.addEventListener('change', saveGlobalDomainFilter);
    shareBtn?.addEventListener('click', handleShare);
    activateLicenseBtn?.addEventListener('click', handleLicenseActivation);
    feedbackBtn?.addEventListener('click', handleFeedbackClick);
    // UPDATED: Bundle listeners
    bundleSelector?.addEventListener('change', handleBundleChange);
    copyBundleBtn?.addEventListener('click', handleCopyBundle); // Changed from addBundleBtn
    renameBundleBtn?.addEventListener('click', handleRenameBundle);
    deleteBundleBtn?.addEventListener('click', handleDeleteBundle);
    exportAllBtn?.addEventListener('click', handleExportAllBundles); // UPDATED Handler


    // Drag and Drop listeners on the container
    rulesListContainer?.addEventListener('dragover', handleDragOverContainer); // Needed to allow drop
    rulesListContainer?.addEventListener('dragleave', (e) => {
        // Hide indicator if leaving the container entirely
        if (rulesListContainer && !rulesListContainer.contains(e.relatedTarget) && dropIndicator) {
            dropIndicator.style.display = 'none';
        }
    });
    rulesListContainer?.addEventListener('drop', (e) => {
        // Prevent default drop behavior and cleanup state if dropped outside a valid target
        e.preventDefault();
        cleanupDragState();
    });
}

// --- Feature Logic Functions ---
/** Handles adding a new default rule to the active bundle */
function handleAddRule() {
    if (!currentSettings.isLicensed) {
        alert("Unlock features to add rules."); // Should be hidden, but safety check
        return;
    }

    const activeBundleIndex = currentSettings.ruleBundles.findIndex(b => b.id === currentSettings.activeBundleId);
    if (activeBundleIndex === -1) {
        console.error("Cannot add rule, active bundle not found.");
        alert("Error: Could not find the active rule bundle.");
        return;
    }
    const activeBundle = currentSettings.ruleBundles[activeBundleIndex];

    // Prevent adding rules to non-user bundles
    if (activeBundle.source !== 'user') {
        alert("Rules can only be added to custom bundles (created via Copy or Import).");
        return;
    }

    // Create new rule data structure
    const newRuleData = {
        id: generateUniqueID('rule'), // Unique ID
        description: "", find: "", replace: "", css: "",
        isRegex: false, isCaseSensitive: false, isWholeWord: false,
        domainList: { type: 'inherit', domains: [] }, // Default domain setting
        // No isDefault needed
    };
    // Add to active bundle's rules array
    activeBundle.rules.push(newRuleData);

    // Create DOM element
    const newElement = createRuleElement(newRuleData);
    // Remove 'no rules' message if this is the first rule in the bundle
    if(activeBundle.rules.length === 1) {
        const noRulesMsg = rulesListContainer.querySelector('.no-rules-message');
        if(noRulesMsg) noRulesMsg.remove();
    }
    // Append to list
    if (rulesListContainer && newElement) {
        rulesListContainer.appendChild(newElement);
        newElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); // Scroll to new rule
        // Focus the description input for immediate editing
        newElement.querySelector('.description-input')?.focus();
    }
    // Save updated bundles array to local storage
    saveLocalSettings(true); // Notify content scripts
    // Send GA4 rule_added event
    reportEventToBackground('rule_added', { bundle_id: activeBundle.id });
}

/**
 * Helper function to trigger a file download.
 * @param {string} dataStr - The JSON string data to download.
 * @param {string} filename - The suggested filename for the download.
 */
function triggerDownload(dataStr, filename) {
    try {
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link); // Required for Firefox
        link.click();
        document.body.removeChild(link); // Clean up link
        URL.revokeObjectURL(url); // Release object URL
    } catch (error) {
        console.error("Error triggering download:", error);
        alert(`Error exporting bundle(s): ${error.message}. See console for details.`);
        reportErrorToBackground("Error triggering download", error, { filename });
    }
}

/** Handles exporting the currently active bundle to a JSON file */
function handleExportActiveBundle() { // Renamed function
    if (!currentSettings.isLicensed) {
        alert("Unlock features to export bundles.");
        return;
    }

    const activeBundle = currentSettings.ruleBundles.find(b => b.id === currentSettings.activeBundleId);
    if (!activeBundle) {
        alert("Error: Could not find the active bundle to export.");
        return;
    }

    try {
        // Prepare the bundle object for export - only include name and rules
        // Create a deep copy to avoid potential mutations if needed elsewhere
        const bundleToExport = {
            name: activeBundle.name,
            rules: JSON.parse(JSON.stringify(activeBundle.rules)).map(rule => {
                // Remove internal 'id' and 'isDefault' (if it somehow got added) from exported rules
                delete rule.id;
                delete rule.isDefault;
                return rule;
            })
        };

        // Wrap in an array as per the multi-bundle import format
        const exportData = [bundleToExport];
        const dataStr = JSON.stringify(exportData, null, 2); // Pretty print JSON

        // Sanitize bundle name for filename
        const safeBundleName = activeBundle.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const filename = `scarlet_swap_bundle_${safeBundleName}.json`; // Filename

        triggerDownload(dataStr, filename);

        // Send GA4 event
        reportEventToBackground('bundle_exported', {
            export_type: 'active',
            bundle_id: activeBundle.id,
            bundle_name: activeBundle.name,
            bundle_source: activeBundle.source,
            rule_count: activeBundle.rules.length
        });
    } catch (error) {
        console.error("Error exporting active bundle:", error);
        alert("Error exporting active bundle. See console for details.");
        reportErrorToBackground("Error exporting active bundle", error, { bundleId: activeBundle.id });
    }
}

/** Handles exporting ALL bundles to a single JSON file */
function handleExportAllBundles() {
    if (!currentSettings.isLicensed) {
        alert("Unlock features to export all bundles.");
        return;
    }

    if (!currentSettings.ruleBundles || currentSettings.ruleBundles.length === 0) {
        alert("No bundles available to export.");
        return;
    }

    try {
        // Prepare the array of all bundle objects for export
        const bundlesToExport = currentSettings.ruleBundles.map(bundle => {
            // For each bundle, create a new object with only name and rules
             const exportedBundle = {
                 name: bundle.name,
                 rules: JSON.parse(JSON.stringify(bundle.rules)).map(rule => {
                     // Remove internal 'id' and 'isDefault' from exported rules
                     delete rule.id;
                     delete rule.isDefault;
                     return rule;
                 })
             };
             // Note: We are intentionally NOT including id, isDefault, source, requiresLicense
             // in the export format to keep it focused on user-editable content.
             return exportedBundle;
        });

        const dataStr = JSON.stringify(bundlesToExport, null, 2); // Pretty print JSON
        const filename = `scarlet_swap_all_bundles_${new Date().toISOString().slice(0,10)}.json`; // Filename with date

        triggerDownload(dataStr, filename);

        // Send GA4 event
        reportEventToBackground('bundle_exported', {
            export_type: 'all',
            bundle_count: bundlesToExport.length,
            total_rule_count: bundlesToExport.reduce((sum, b) => sum + (b.rules?.length || 0), 0)
        });
    } catch (error) {
        console.error("Error exporting all bundles:", error);
        alert("Error exporting all bundles. See console for details.");
        reportErrorToBackground("Error exporting all bundles", error);
    }
}


/** Triggers the file input click for importing */
function handleImportBundles() { // Renamed function
    if (!currentSettings.isLicensed) {
        alert("Unlock features to import bundles.");
        return;
    }
    importFileInput?.click(); // Open file chooser
}

/**
 * Processes the selected JSON file(s) for import.
 * Expects files to contain an array of bundle objects with 'name' and 'rules'.
 * Ignores extraneous properties like id, isDefault, source, requiresLicense from the import file.
 */
async function processImportFile(event) {
    if (!currentSettings.isLicensed) return; // Double check license

    const files = event.target.files;
    if (!files || files.length === 0) return; // No files selected

    console.log(`Import: Processing ${files.length} file(s)...`);
    let importedBundlesCount = 0;
    let errors = [];
    let lastImportedBundleId = null;

    // Use Promise.all to handle async file reading
    await Promise.all(Array.from(files).map(file => {
        return new Promise((resolveFile) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const fileContent = e.target.result;
                    const parsedData = JSON.parse(fileContent);

                    // Validate root structure: must be an array
                    if (!Array.isArray(parsedData)) {
                        throw new Error(`File ${file.name} is not a valid bundle array.`);
                    }

                    // Process each bundle object within the array
                    parsedData.forEach((bundleData, index) => {
                        // Basic validation of bundle object structure
                        if (typeof bundleData !== 'object' || bundleData === null || !bundleData.name || !Array.isArray(bundleData.rules)) {
                            console.warn(`Import: Skipping invalid bundle structure at index ${index} in file ${file.name}.`);
                            return; // Skip this invalid bundle object
                        }

                        // Sanitize and process the bundle rules
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
                            id: generateUniqueID('import_rule') // Always generate new rule ID
                            // Note: Explicitly ignoring rule.isDefault if present in the import file
                        }));

                        // Create the new bundle object for storage
                        const baseName = bundleData.name || `Imported Bundle ${index + 1}`;
                        let finalBundleName = baseName;
                        let counter = 1;
                        // Ensure unique name
                        while (currentSettings.ruleBundles.some(b => b.name.toLowerCase() === finalBundleName.toLowerCase())) {
                            finalBundleName = `${baseName} (${counter})`;
                            counter++;
                        }

                        const newBundle = {
                            id: generateUniqueID('bundle'), // Always generate new bundle ID
                            name: finalBundleName,
                            isDefault: false, // Imported bundles are never the primary default
                            source: 'user', // Imported bundles are always user-created
                            requiresLicense: false, // User bundles don't require license beyond initial creation
                            rules: processedRules
                            // Note: Explicitly ignoring bundle.id, bundle.isDefault, bundle.source, bundle.requiresLicense
                            // if present in the import file, as we are creating a new user bundle.
                        };

                        currentSettings.ruleBundles.push(newBundle);
                        importedBundlesCount++;
                        lastImportedBundleId = newBundle.id; // Keep track of the last one added
                        console.log(`Import: Added bundle "${newBundle.name}" from file ${file.name}`);
                    });

                } catch (error) {
                    console.error(`Import: Error processing file ${file.name}:`, error);
                    errors.push(`Failed to process ${file.name}: ${error.message}`);
                    reportErrorToBackground(`Error processing import file ${file.name}`, error);
                } finally {
                    resolveFile(); // Resolve promise for this file
                }
            };
            reader.onerror = (e) => {
                console.error(`Import: Error reading file ${file.name}:`, e);
                errors.push(`Could not read file ${file.name}.`);
                reportErrorToBackground(`Error reading import file ${file.name}`, e);
                resolveFile(); // Resolve promise even on read error
            };
            reader.readAsText(file);
        });
    })); // End Promise.all

    // After all files are processed
    if (importedBundlesCount > 0) {
        // Switch to the last imported bundle if one was successfully added
        if (lastImportedBundleId) {
             currentSettings.activeBundleId = lastImportedBundleId;
             // Save bundles and new active ID to local storage
             saveLocalSettings(true); // Notify content script
        } else {
             // Only save bundles if active ID didn't change (but bundles were added)
             saveLocalSettings(true);
        }
        renderBundleSelector(); // Update UI
        renderRuleList();
        updateBundleManagementButtons();
        alert(`Successfully imported ${importedBundlesCount} bundle(s).` + (errors.length ? `\nEncountered ${errors.length} error(s):\n- ${errors.join('\n- ')}` : ''));
        reportEventToBackground('bundles_imported', { file_count: files.length, bundle_count: importedBundlesCount, error_count: errors.length });
    } else {
        alert(`Import failed. No valid bundles found.` + (errors.length ? `\nErrors:\n- ${errors.join('\n- ')}` : ''));
    }

    // Reset file input
    if (importFileInput) importFileInput.value = null;
}

/** Saves the global domain filter settings to local storage */
function saveGlobalDomainFilter() {
    const type = globalDomainFilterType?.value || 'disabled';
    const domains = globalDomainListInput?.value.split('\n').map(d => d.trim()).filter(d => d.length > 0) || [];
    currentSettings.domainList = { type, domains };
    saveLocalSettings(true); // Save and notify content scripts
}

// --- Share Functionality ---
/** Handles the share button click - Tries native share, falls back to copy */
async function handleShare() {
    const medium = 'share_options'; // Define medium for options page UTM parameter
    const shareUrl = getShareUrlWithUtm(medium); // Construct URL with UTM params

    // Check if base URL is valid (already includes check for placeholder)
    if (!CWS_BASE_URL || CWS_BASE_URL.includes("your-extension-id-here")) {
        showOptionsStatusMessage(shareStatus, "Share URL not configured.", true);
        console.warn("Share button clicked, but CWS_BASE_URL is not set.");
        return;
    }

    const shareData = {
        title: 'Check out Scarlet Swap!',
        text: 'This Chrome extension swaps text based on rules - perfect for Buckeye fans! #GoBucks #ScarletSwap',
        url: shareUrl // Use the URL with UTM parameters
    };

    let shareMethod = 'copy_fallback'; // Default method for GA if native share fails/unavailable

    if (navigator.share) {
        try {
            console.log("Attempting navigator.share...");
            await navigator.share(shareData);
            console.log('Extension shared successfully via Web Share API');
            // Use the updated success message from user input
            showOptionsStatusMessage(shareStatus, 'Thanks for sharing!');
            shareMethod = 'web_share_api'; // Update method for GA on success
            // Report successful share attempt
            reportEventToBackground('share_attempted', { method: shareMethod, utm_medium: medium });
            return; // Exit function after successful native share
        } catch (err) {
            if (err.name === 'AbortError') {
                console.log('Share aborted by user.'); // Don't show error message
                // Report aborted share attempt
                reportEventToBackground('share_attempted', { method: 'web_share_api_abort', utm_medium: medium });
                return; // Exit function if user cancelled
            } else {
                console.error('Web Share API failed:', err);
                // Fallback to copy link if share fails for other reasons
                copyLinkFallback(shareUrl, "Sharing failed, link copied instead!"); // Pass shareUrl
                reportErrorToBackground("Web Share API failed", err);
                // Share attempt still happened, report with fallback method
                 reportEventToBackground('share_attempted', { method: shareMethod, utm_medium: medium });
                 return; // Exit after fallback copy
            }
        }
    }

    // Fallback to copying if navigator.share is not supported
    console.log('Web Share API not supported, falling back to copy.');
    copyLinkFallback(shareUrl, "Sharing not supported, link copied!"); // Pass shareUrl
    // Report share attempt using fallback method
    reportEventToBackground('share_attempted', { method: shareMethod, utm_medium: medium });
}


/** Fallback function to copy the CWS link (with UTMs) to clipboard */
// Modified to accept urlToCopy argument
async function copyLinkFallback(urlToCopy, message = "Link copied to clipboard!") {
    if (!navigator.clipboard) {
        showOptionsStatusMessage(shareStatus, 'Clipboard access denied or unavailable.', true);
        return;
    }
    try {
        // Use the passed URL with UTM parameters
        await navigator.clipboard.writeText(urlToCopy);
        console.log('Link copied to clipboard:', urlToCopy); // Log the actual copied URL
        showOptionsStatusMessage(shareStatus, message); // Show success/info message
    } catch (err) {
        console.error('Failed to copy link:', err);
        showOptionsStatusMessage(shareStatus, 'Failed to copy link.', true); // Show error message
        reportErrorToBackground("Failed to copy share link", err);
    }
}


// --- Drag and Drop Functions (Gap Indicator Logic) ---
/** Handles the start of dragging a rule */
function handleDragStart(e) {
    // Ensure the event target is the draggable handle and it's actually draggable
    draggedRuleElement = e.target.closest('.rule-item');
    if (!draggedRuleElement || !e.target.classList.contains('drag-handle') || !e.target.draggable) {
        e.preventDefault(); // Prevent dragging if not allowed or not the handle
        draggedRuleElement = null;
        return;
    }

    // Check if the bundle allows dragging (source === 'user' and licensed)
    const activeBundle = currentSettings.ruleBundles.find(b => b.id === currentSettings.activeBundleId);
    if (!activeBundle || activeBundle.source !== 'user' || !currentSettings.isLicensed) {
         e.preventDefault(); // Prevent dragging if not allowed
         draggedRuleElement = null;
         return;
    }


    const ruleId = draggedRuleElement.dataset.ruleId;
    // Try to set a custom drag image (the summary part) for better visual feedback
    const summaryElement = e.target.closest('.rule-summary');
    try {
        if (summaryElement) {
            // Offset the image slightly from the cursor
            e.dataTransfer.setDragImage(summaryElement, 10, 10);
        } else {
            // Fallback to dragging the whole item (less ideal visually)
            e.dataTransfer.setDragImage(draggedRuleElement, 10, 10);
        }
    } catch (err) {
        console.warn("Could not set drag image:", err);
        // Drag will still work, just without custom image
    }

    // Set data to identify the dragged item
    e.dataTransfer.setData('text/plain', ruleId);
    e.dataTransfer.effectAllowed = 'move'; // Indicate it's a move operation

    // Add dragging class after a short delay for visual feedback
    setTimeout(() => {
        if(draggedRuleElement) draggedRuleElement.classList.add('dragging');
    }, 0);

    // Ensure the drop indicator exists
    if (!dropIndicator) {
        dropIndicator = rulesListContainer?.querySelector('.drop-indicator');
    }
    // Ensure the handle cursor is 'grabbing'
    if (e.target.style.cursor !== 'grabbing') e.target.style.cursor = 'grabbing';
}

/** Handles dragging over a potential drop target (rule item or container) */
function handleDragOver(e) {
    // Check if dragging is allowed for the current bundle before proceeding
    const activeBundle = currentSettings.ruleBundles.find(b => b.id === currentSettings.activeBundleId);
    if (!activeBundle || activeBundle.source !== 'user' || !currentSettings.isLicensed) {
        e.dataTransfer.dropEffect = 'none'; // Indicate dragging is not allowed here
        return; // Don't allow drop
    }

    e.preventDefault(); // Necessary to allow dropping
    e.dataTransfer.dropEffect = 'move'; // Visual feedback for the cursor

    if (!draggedRuleElement || !dropIndicator) return; // Exit if not dragging or indicator missing

    // Find the rule item being hovered over
    const targetItem = e.target.closest('.rule-item:not(.dragging)'); // Exclude the item being dragged

    let insertBeforeElement = null; // The element the indicator should be placed before

    if (targetItem) {
        // Calculate vertical midpoint of the target item
        const rect = targetItem.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;
        // Insert before target if dragging in the top half, otherwise insert after (before next sibling)
        insertBeforeElement = (e.clientY < midpoint) ? targetItem : targetItem.nextElementSibling;
    } else if (rulesListContainer && rulesListContainer.contains(e.target)) {
        // If hovering over the container but not a specific item, find the closest item based on cursor position
        // This handles dropping at the beginning or end more smoothly
        const items = Array.from(rulesListContainer.querySelectorAll('.rule-item:not(.rule-item-template):not(.dragging)'));
        const closest = items.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            // Calculate distance from cursor to the middle of the child
            const offset = e.clientY - box.top - box.height / 2;
            // Find the element with the smallest negative offset (closest element above cursor)
            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element; // Start with negative infinity

        // If a closest element above is found, insert before it
        insertBeforeElement = closest;
        // If no element is above (i.e., dragging below all items), insertBeforeElement remains null
    }

    // Position the drop indicator
    if (insertBeforeElement) {
        // Insert before the determined element
        rulesListContainer?.insertBefore(dropIndicator, insertBeforeElement);
    } else if (rulesListContainer) {
        // If no element to insert before (e.g., end of list or empty list), append to container
        rulesListContainer.appendChild(dropIndicator);
    }

    // Make the indicator visible
    dropIndicator.style.display = 'block';
}

/** Handles leaving a potential drop target (optional visual feedback) */
function handleDragLeave(e) {
    // You could potentially hide the indicator immediately on leaving an item,
    // but it can cause flickering. Relying on container dragleave is often smoother.
}

/** Handles the drop event on a rule item or the container */
function handleDrop(e) {
    e.preventDefault(); // Prevent default drop behavior
    e.stopPropagation(); // Prevent drop event from bubbling up (e.g., to container listener)

    if (!draggedRuleElement || !dropIndicator) {
        cleanupDragState(); // Cleanup if drop is invalid
        return;
    }

    // Find the active bundle and check if DnD is allowed
    const activeBundleIndex = currentSettings.ruleBundles.findIndex(b => b.id === currentSettings.activeBundleId);
     if (activeBundleIndex === -1) {
         console.error("DnD Error: Active bundle not found.");
         cleanupDragState();
         return;
     }
     const activeBundle = currentSettings.ruleBundles[activeBundleIndex];
     if (activeBundle.source !== 'user' || !currentSettings.isLicensed) {
         console.warn("DnD Error: Drop attempted on non-user or locked bundle.");
         cleanupDragState();
         return;
     }

    const draggedRuleId = e.dataTransfer.getData('text/plain');
    // Find the index of the dragged rule in the active bundle's rules array
    const originalDraggedIndex = activeBundle.rules.findIndex(r => r.id === draggedRuleId);

    if (originalDraggedIndex === -1) {
        console.error("DnD Error: Could not find dragged item data in active bundle for ID:", draggedRuleId);
        cleanupDragState();
        return;
    }

    // Determine the target index based on the indicator's final position
    const nextElement = dropIndicator.nextElementSibling;
    let targetIndex;

    if (nextElement && nextElement.classList.contains('rule-item')) {
        // If indicator is before another rule, find that rule's index in the active bundle
        const nextElementId = nextElement.dataset.ruleId;
        targetIndex = activeBundle.rules.findIndex(r => r.id === nextElementId);
        if (targetIndex === -1) {
            console.warn("DnD Warning: Target index calculation fallback.");
            targetIndex = activeBundle.rules.length;
        }
    } else {
        // If indicator is at the end, target index is the end of the array
        targetIndex = activeBundle.rules.length;
    }

    // Adjust target index if moving item downwards
    let adjustedTargetIndex = targetIndex;
    if (originalDraggedIndex < targetIndex) {
        adjustedTargetIndex--;
    }

    // Only proceed if the position actually changed
    if (originalDraggedIndex !== adjustedTargetIndex) {
        // Remove the item from its original position in the active bundle
        const [removedItem] = activeBundle.rules.splice(originalDraggedIndex, 1);
        // Insert the item at the new adjusted position in the active bundle
        adjustedTargetIndex = Math.max(0, Math.min(adjustedTargetIndex, activeBundle.rules.length));
        activeBundle.rules.splice(adjustedTargetIndex, 0, removedItem);

        console.log(`DnD: New rules order in bundle ${activeBundle.id}:`, activeBundle.rules.map(r => r.id));
        // Save the reordered bundles array to local storage
        saveLocalSettings(true); // Notify content scripts of the order change
        // Re-render the list to reflect the new order in the DOM
        renderRuleList();
        // Send GA4 rule_reordered event
        reportEventToBackground('rule_reordered', { bundle_id: activeBundle.id });
    } else {
        // If position didn't change, still re-render to remove dragging styles cleanly
        renderRuleList();
    }

    // Cleanup drag state regardless of whether order changed
    cleanupDragState();
}

/** Handles the end of the drag operation (cleanup) */
function handleDragEnd(e) {
    cleanupDragState(); // General cleanup
    // Reset cursor on the handle
    if (e.target.classList.contains('drag-handle')) {
       e.target.style.cursor = e.target.draggable ? 'grab' : 'default';
    }
}

/** Cleans up drag-related styles and state */
function cleanupDragState() {
    // Hide the drop indicator
    if (dropIndicator) {
        dropIndicator.style.display = 'none';
    }
    // Remove dragging class from the element that was dragged
    if (draggedRuleElement) {
        draggedRuleElement.classList.remove('dragging');
        // Reset cursor on handle if it exists
        const handle = draggedRuleElement.querySelector('.drag-handle');
        if (handle) handle.style.cursor = handle.draggable ? 'grab' : 'default';
    }
    // Clear the reference to the dragged element
    draggedRuleElement = null;
}

/** Handles dragover on the rules list container itself */
function handleDragOverContainer(e) {
    // Check if dragging is allowed for the current bundle before proceeding
    const activeBundle = currentSettings.ruleBundles.find(b => b.id === currentSettings.activeBundleId);
    if (!activeBundle || activeBundle.source !== 'user' || !currentSettings.isLicensed) {
        e.dataTransfer.dropEffect = 'none'; // Indicate dragging is not allowed here
        return; // Don't allow drop
    }
    // Necessary to allow dropping onto the container (e.g., empty space)
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
}

// --- Initialization ---
/** Initializes the options page */
async function initializeOptionsPage() {
    console.log("Initializing options page...");
    try {
        // Load settings from storage first (sync and local)
        await loadSettings();
        console.log("Settings loaded, proceeding with UI setup.");

        // Get reference to the drop indicator
        dropIndicator = rulesListContainer?.querySelector('.drop-indicator');
        if (!dropIndicator && rulesListContainer) {
            // Create indicator if it doesn't exist in HTML (robustness)
            console.warn("Drop indicator not found in HTML, creating dynamically.");
            dropIndicator = document.createElement('div');
            dropIndicator.className = 'drop-indicator';
            dropIndicator.style.display = 'none';
            rulesListContainer.prepend(dropIndicator);
        }

        // Populate global domain filter controls (using defaults loaded if needed)
        if (globalDomainFilterType) globalDomainFilterType.value = currentSettings.domainList?.type || 'blacklist'; // Reverted default type
        if (globalDomainListInput) globalDomainListInput.value = Array.isArray(currentSettings.domainList?.domains) ? currentSettings.domainList.domains.join('\n') : '';

        // Populate the bundle selector dropdown
        renderBundleSelector();

        // Render the list of rules based on the active bundle
        renderRuleList(); // Also calls updateAddRuleButtonVisibility

        // Set initial UI state (enabled/disabled controls) based on loaded license
        updateGlobalUIState(currentSettings.isLicensed); // Also calls updateBundleManagementButtons

        // Setup event listeners for buttons, inputs, etc.
        setupEventListeners();

        // *** Send GA4 Page View Event ***
        reportEventToBackground('view_options_page');

        console.log("Options page initialized successfully.");

    } catch (error) {
        console.error("Failed to initialize options page:", error);
        // Display a user-friendly error message if init fails catastrophically
        document.body.innerHTML = '<p style="color: red; padding: 15px;">Error loading extension settings. Please check the console for details and try reloading the page or extension.</p>';
        reportErrorToBackground("Fatal error initializing options page", error);
    }
}

// --- Storage Change Listener ---
/** Listens for changes in storage and updates UI accordingly */
chrome.storage.onChanged.addListener((changes, namespace) => {
    // Ignore changes made by this script itself (prevent loops)
    if (isSavingInternally) {
        // console.log("Options: Ignoring internal storage change."); // Optional verbose log
        return;
    }

    let needsRuleListRender = false;
    let needsBundleSelectorRender = false;
    let needsGlobalUIRefresh = false; // Flag for full UI update
    let needsDomainControlsUpdate = false;

    // Check sync storage changes (only isLicensed)
    if (namespace === 'sync') {
        if (changes.isLicensed && changes.isLicensed.newValue !== currentSettings.isLicensed) {
            console.log("Options page detected license change.");
            currentSettings.isLicensed = changes.isLicensed.newValue;
            needsGlobalUIRefresh = true; // License change requires full UI update
        }
    }
    // Check local storage changes
    else if (namespace === 'local') {
        console.log("Options: External local storage change detected:", changes);

        // *** START BUG FIX: Update internal isEnabled state if changed externally ***
        if (changes.isEnabled && typeof changes.isEnabled.newValue === 'boolean' && changes.isEnabled.newValue !== currentSettings.isEnabled) {
            console.log("Options page detected external isEnabled change.");
            currentSettings.isEnabled = changes.isEnabled.newValue;
            // Note: No direct UI update needed here, but ensures the correct value is saved later.
        }
        // *** END BUG FIX ***

        if (changes.ruleBundles) {
             console.log("Options page detected ruleBundles change.");
             // Basic validation/sanitization
             const newBundles = Array.isArray(changes.ruleBundles.newValue) ? changes.ruleBundles.newValue : [];
             // (Sanitization logic can be simplified here as background/load handles it)
             currentSettings.ruleBundles = newBundles;
             needsBundleSelectorRender = true;
             needsRuleListRender = true;
         }
        if (changes.activeBundleId && changes.activeBundleId.newValue !== currentSettings.activeBundleId) {
             console.log("Options page detected activeBundleId change.");
             currentSettings.activeBundleId = changes.activeBundleId.newValue;
             needsBundleSelectorRender = true; // To update selection
             needsRuleListRender = true;
         }
        if (changes.domainList && JSON.stringify(changes.domainList.newValue) !== JSON.stringify(currentSettings.domainList)) {
             console.log("Options page detected global domain list change.");
             // *** UPDATED DEFAULT VALUE ***
             currentSettings.domainList = changes.domainList.newValue || { type: 'blacklist', domains: ['docs.google.com', '/.*\\.github\\.io/'] }; // Reverted type, updated domains
             needsDomainControlsUpdate = true; // Update only domain controls
         }
        if (changes.disabledRuleIds) {
             console.log("Options page detected disabled rules change.");
             const newDisabledSet = new Set(Array.isArray(changes.disabledRuleIds.newValue) ? changes.disabledRuleIds.newValue : []);
             // Check if the set actually changed before updating
             if (newDisabledSet.size !== currentSettings.disabledRuleIds.size || ![...newDisabledSet].every(id => currentSettings.disabledRuleIds.has(id))) {
                 currentSettings.disabledRuleIds = newDisabledSet;
                 needsRuleListRender = true; // Disabled state affects rule items display
             }
         }
         // isEnabled change is handled by popup/content script, not directly affecting options page UI state other than premium controls
    }

    // Perform UI updates based on flags
    if (needsGlobalUIRefresh) {
         console.log("Options: Refreshing global UI state due to external changes.");
         updateGlobalUIState(currentSettings.isLicensed); // This handles selector and list implicitly
    } else {
        // If no global refresh, update selector and list individually if needed
        if (needsBundleSelectorRender) {
            renderBundleSelector();
            updateBundleManagementButtons(); // Update buttons when selector changes
        }
        if (needsRuleListRender) {
            renderRuleList(); // Also calls updateAddRuleButtonVisibility
        }
        if (needsDomainControlsUpdate) {
            // Update only the global domain controls if license didn't also change
            if (globalDomainFilterType) globalDomainFilterType.value = currentSettings.domainList.type || 'blacklist'; // Reverted default type
            if (globalDomainListInput) globalDomainListInput.value = Array.isArray(currentSettings.domainList.domains) ? currentSettings.domainList.domains.join('\n') : '';
            // Ensure controls are correctly enabled/disabled based on current license state
            const isDisabled = !currentSettings.isLicensed;
            if(globalDomainFilterType) { globalDomainFilterType.disabled = isDisabled; globalDomainFilterType.setAttribute('aria-disabled', String(isDisabled)); }
            if(globalDomainListInput) { globalDomainListInput.disabled = isDisabled; globalDomainListInput.setAttribute('aria-disabled', String(isDisabled)); }
        }
        // Update tooltips if license didn't change but other things might affect them
        updateTooltipsForState(document.body, currentSettings.isLicensed);
    }
});


// --- Helper to report errors/events to background (Optional but Recommended) ---
/**
 * Sends error details to the background script for potential Sentry logging.
 * @param {string} message - A description of the error context.
 * @param {Error} error - The error object.
 * @param {object} [context={}] - Additional context.
 */
async function reportErrorToBackground(message, error, context = {}) {
    try {
        // Use chrome.runtime.sendMessage, checking for existence first
        if (chrome.runtime && chrome.runtime.sendMessage) {
            await chrome.runtime.sendMessage({
                action: "reportError", // Assumes background.js handles this action
                payload: {
                    source: 'options.js',
                    message: message,
                    error: { // Serialize error safely
                        message: error?.message,
                        name: error?.name,
                        // Avoid sending full stack in production if privacy is a concern
                        // stack: error?.stack
                    },
                    context: context
                }
            });
        } else {
            console.warn("Options: chrome.runtime.sendMessage not available, cannot report error to background.");
        }
    } catch (messagingError) {
        // Log errors during the attempt to report the original error
        console.error("Options: Failed to report error to background script:", messagingError, "Original error:", message, error);
    }
}

// --- Helper to report GA events to background ---
/**
 * Sends a GA event request to the background script.
 * @param {string} eventName - The name of the GA4 event.
 * @param {object} [params={}] - Optional parameters for the event.
 */
async function reportEventToBackground(eventName, params = {}) {
     try {
        // Use chrome.runtime.sendMessage, checking for existence first
        if (chrome.runtime && chrome.runtime.sendMessage) {
             await chrome.runtime.sendMessage({
                 action: "trackGaEvent", // Use the generic action handled by background.js
                 payload: {
                     eventName: eventName,
                     params: params // Pass parameters object
                 }
             }, response => { // Optional callback to handle response/errors
                 if (chrome.runtime.lastError) {
                     console.error(`Options: Error sending GA event '${eventName}' message:`, chrome.runtime.lastError.message);
                     // Optionally report this messaging error itself
                     // reportErrorToBackground(`Error sending GA event '${eventName}' message`, chrome.runtime.lastError);
                 } else {
                     console.log(`Options: GA event '${eventName}' message acknowledged:`, response);
                 }
             });
        } else {
             console.warn(`Options: chrome.runtime.sendMessage not available, cannot report GA event '${eventName}'.`);
         }
     } catch (messagingError) {
         console.error(`Options: Failed to send GA event '${eventName}' to background:`, messagingError);
         // Optionally report this messaging error itself
         // reportErrorToBackground(`Failed to send GA event '${eventName}' to background`, messagingError);
     }
 }


// Run initialization when the DOM is ready
document.addEventListener('DOMContentLoaded', initializeOptionsPage);
