// Copyright 2025 Brad Kulick
// All rights reserved.

/**
 * content.js (Rule Bundles Finalization)
 * Handles finding and replacing text based on rules from the active bundle.
 * Loads settings from storage (sync for isLicensed, local for others).
 * Selects appropriate rules based on license status and active bundle.
 * Respects the global isEnabled toggle correctly.
 * Adds a tooltip showing the original text on replaced elements.
 */

let currentSettings = {
    // From sync storage
    isLicensed: false,
    // From local storage
    isEnabled: true,
    ruleBundles: [],
    activeBundleId: null,
    domainList: { type: 'disabled', domains: [] },
    disabledRuleIds: new Set() // Use Set for efficient lookup
};
let isProcessing = false;
let pageDomain = window.location.hostname;

// Fallback default rules (used only if storage is corrupted or default bundle is missing/inaccessible)
const fallbackDefaultRules = [
    { id: 'default_TTUN_long', description: "Beat TTUN (Long Name)", find: 'University of Michigan', replace: 'TTUN', css: 'color: #BB0000; font-weight: bold;', isRegex: false, isCaseSensitive: false, isWholeWord: true, domainList: { type: 'inherit', domains: [] }, isDefault: true },
    { id: 'default_TTUN_short', description: "Beat TTUN (Short Name)", find: 'Michigan', replace: 'TTUN', css: 'color: #BB0000; font-weight: bold;', isRegex: false, isCaseSensitive: false, isWholeWord: true, domainList: { type: 'inherit', domains: [] }, isDefault: true },
    { id: 'default_m', description: "Go Buckeyes! Beat xichigan.", find: 'm', replace: 'x', css: 'color: #BB0000; font-weight: bold;', isRegex: false, isCaseSensitive: true, isWholeWord: false, domainList: { type: 'inherit', domains: [] }, isDefault: true },
    { id: 'default_M', description: "Go Buckeyes! Beat Xichigan.", find: 'M', replace: 'X', css: 'color: #BB0000; font-weight: bold;', isRegex: false, isCaseSensitive: true, isWholeWord: false, domainList: { type: 'inherit', domains: [] }, isDefault: true }
];


/** Checks if a specific rule should run on the current domain */
function checkDomainForRule(rule, globalDomainList) {
    const ruleDomainSettings = rule.domainList || { type: 'inherit', domains: [] };
    // Determine effective settings: rule-specific overrides global if not 'inherit'
    const effectiveSettings = (ruleDomainSettings.type !== 'inherit') ? ruleDomainSettings : globalDomainList;
    const filterType = effectiveSettings.type || 'disabled';
    const domains = effectiveSettings.domains || [];

    if (filterType === 'disabled' || domains.length === 0) {
        return true; // No filter applied
    }

    let matchFound = false;
    for (const pattern of domains) {
        try {
            if (pattern.startsWith('/') && pattern.endsWith('/')) {
                // Regex pattern
                if (new RegExp(pattern.slice(1, -1)).test(pageDomain)) {
                    matchFound = true;
                    break;
                }
            } else {
                // Simple domain match (case-insensitive)
                if (pageDomain.toLowerCase() === pattern.toLowerCase()) {
                    matchFound = true;
                    break;
                }
            }
        } catch (e) {
            console.warn(`Replacer: Invalid domain pattern "${pattern}" for rule "${rule.find}":`, e);
            // Optionally report this error
        }
    }

    if (filterType === 'whitelist') {
        return matchFound; // Run only if domain matches
    } else if (filterType === 'blacklist') {
        return !matchFound; // Run only if domain does NOT match
    }

    return true; // Should not be reached if type is valid, default to allow
}
/** Escapes special characters for RegExp literal */
function escapeRegExp(str) { return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
/** Creates RegExp object from rule settings */
function createRegExpForRule(rule) {
    if (!rule.find) return null;
    try {
        let pattern = rule.isRegex ? rule.find : escapeRegExp(rule.find);
        let flags = 'g'; // Global flag is always needed
        if (!rule.isCaseSensitive) flags += 'i';

        // Apply whole word only if it's NOT a regex rule
        if (rule.isWholeWord && !rule.isRegex) {
            // Basic word boundary check. More complex scenarios might need refinement.
            // This adds \b unless the pattern already starts/ends with non-word chars or boundary tokens.
            const startBoundary = /^\W|^\\b/.test(pattern) ? '' : '\\b';
            const endBoundary = /\W$|\\b$/.test(pattern) ? '' : '\\b';
            pattern = `${startBoundary}${pattern}${endBoundary}`;
        }
        return new RegExp(pattern, flags);
    } catch (e) {
        console.warn(`Replacer: Invalid RegExp for rule "${rule.find}":`, e);
        // Optionally report error
        return null;
    }
}

/** Processes a single text node by applying all applicable rules sequentially */
function processNodeWithApplicableRules(textNode, applicableRules) {
     const originalText = textNode.nodeValue;
     let fragment = null;
     let textCursor = 0; // Tracks position in originalText after replacements
     const parentNode = textNode.parentNode; // Get parent node once

     // Check if the parent was already processed (relevant for tooltip logic)
     const parentIsProcessedSpan = parentNode?.nodeName === 'SPAN' && parentNode.dataset.replacerProcessed === 'true';
     const parentTitle = parentIsProcessedSpan ? parentNode.title : null;

     // Iterate through rules that were pre-filtered for this page/domain/enabled status
     applicableRules.forEach(({ rule, regex }) => {
         // Double-check rule isn't globally disabled (safety check)
         if (currentSettings.disabledRuleIds.has(rule.id)) return;

         let match;
         regex.lastIndex = 0; // Reset regex index for each rule

         while ((match = regex.exec(originalText)) !== null) {
             const matchIndex = match.index;
             const matchLength = match[0].length;
             const matchEndIndex = matchIndex + matchLength;
             const originalMatchedText = match[0]; // Store the original text for this match

             // Only process if the match starts at or after the current cursor
             if (matchIndex >= textCursor) {
                 if (!fragment) {
                     // First match for this node, create fragment
                     fragment = document.createDocumentFragment();
                     // Add preceding text if any
                     if (matchIndex > 0) {
                         fragment.appendChild(document.createTextNode(originalText.substring(0, matchIndex)));
                     }
                 } else {
                     // Add text between the last match and this one
                     if (matchIndex > textCursor) {
                         fragment.appendChild(document.createTextNode(originalText.substring(textCursor, matchIndex)));
                     }
                 }

                 // Create span for the replacement
                 const span = document.createElement('span');
                 try {
                     // Perform replacement using the regex result
                     span.textContent = originalMatchedText.replace(regex, rule.replace || '');
                     regex.lastIndex = matchEndIndex; // Move regex index past the current match
                 } catch (e) {
                     // Fallback in case replacement fails
                     span.textContent = rule.replace || '';
                     console.warn(`Replacer: Error applying replacement for rule "${rule.find}":`, e);
                 }

                 // --- Tooltip Logic ---
                 // If the parent was already a processed span, append to its title history.
                 // Otherwise, start a new title with the current original text.
                 if (parentTitle) {
                     span.title = `${parentTitle} -> ${originalMatchedText}`;
                 } else {
                     span.title = originalMatchedText; // Set initial title
                 }
                 // --- End Tooltip Logic ---

                 // Apply CSS if specified
                 if (rule.css) {
                     try { span.style.cssText = rule.css; } catch (e) { /* Ignore CSS errors */ }
                 }
                 span.dataset.replacerProcessed = 'true'; // Mark node to prevent re-processing
                 fragment.appendChild(span);

                 // Update cursor position
                 textCursor = matchEndIndex;
             }

             // Handle zero-length matches to prevent infinite loops
             if (matchLength === 0) {
                 if (regex.lastIndex === originalText.length) break; // Avoid loop at end of string
                 regex.lastIndex++; // Advance regex index manually
             }
         }
     });

     // If any replacements were made, replace the original node
     if (fragment) {
         // Add any remaining text after the last match
         if (textCursor < originalText.length) {
             fragment.appendChild(document.createTextNode(originalText.substring(textCursor)));
         }
         // Replace the original text node with the fragment
         // Check parentNode again in case it was removed during processing elsewhere
         if (textNode.parentNode) {
             textNode.parentNode.replaceChild(fragment, textNode);
         }
     }
 }

/**
 * Gets the rules from the currently active bundle based on license status.
 * Allows unlicensed users to use rules from bundles marked requiresLicense: false.
 */
function getActiveRules() {
    const activeBundle = currentSettings.ruleBundles.find(b => b.id === currentSettings.activeBundleId);
    const bundleName = activeBundle?.name || 'Unknown';

    // If licensed, always use the active bundle's rules
    if (currentSettings.isLicensed) {
        const rules = activeBundle?.rules || [];
        console.log(`Replacer: Licensed user. Using ${rules.length} rules from active bundle: "${bundleName}" (ID: ${currentSettings.activeBundleId})`);
        return rules;
    }

    // --- Unlicensed Logic ---
    // Check if the selected bundle exists and does NOT require a license
    if (activeBundle && activeBundle.requiresLicense === false) {
        const rules = activeBundle.rules || []; // Default/Preloaded bundles should have rules array
        console.log(`Replacer: Unlicensed user. Using ${rules.length} rules from selected free bundle: "${bundleName}" (ID: ${currentSettings.activeBundleId})`);
        return rules;
    }

    // Fallback: If active bundle requires license, doesn't exist, or license status unclear, use the actual default bundle from storage
    console.warn(`Replacer: Unlicensed user. Active bundle "${bundleName}" requires license or not found. Falling back to default bundle.`);
    const defaultBundle = currentSettings.ruleBundles.find(b => b.isDefault === true);
    if (defaultBundle) {
        console.log(`Replacer: Using rules from stored default bundle: "${defaultBundle.name}"`);
        return defaultBundle.rules || [];
    }

    // Absolute fallback: If no default bundle found in storage (shouldn't happen), use hardcoded defaults
    console.error("Replacer: No default bundle found in storage! Using hardcoded fallback rules.");
    return fallbackDefaultRules;
}


/** Traverses the DOM using TreeWalker and applies replacements */
function walkTheDOM(startNode) {
    // Check isEnabled FIRST (from local storage)
    if (!currentSettings.isEnabled || isProcessing) {
        console.log(`Replacer: Skipping walkTheDOM (isEnabled: ${currentSettings.isEnabled}, isProcessing: ${isProcessing})`);
        return;
    }

    // Get the rules to apply based on active bundle and license
    const rulesToConsider = getActiveRules(); // Uses the updated function
    const globalDomainList = currentSettings.domainList; // From local storage

    if (rulesToConsider.length === 0) {
        console.log("Replacer: No rules to consider for processing.");
        return; // Exit if no rules apply
    }

    isProcessing = true; // Set processing flag AFTER initial checks

    // Filter rules based on domain and disabled status
    const applicableRules = [];
    for (const rule of rulesToConsider) {
        // Skip disabled rules (from local storage)
        if(currentSettings.disabledRuleIds.has(rule.id)) {
             continue;
        }

        // Check domain (using global list from local storage)
        if (checkDomainForRule(rule, globalDomainList)) {
            const regex = createRegExpForRule(rule);
            if (regex) {
                 applicableRules.push({ rule, regex });
             }
        }
    }

    if (applicableRules.length === 0) {
        isProcessing = false; // Reset flag
        return; // Exit if no rules apply after filtering
    }

    // TreeWalker setup
    const treeWalker = document.createTreeWalker(
        startNode,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode: function(node) {
                // Filter out nodes inside unwanted tags or already processed spans
                const parentTag = node.parentNode?.nodeName.toUpperCase();
                if (
                    parentTag === 'SCRIPT' || parentTag === 'STYLE' || parentTag === 'NOSCRIPT' ||
                    parentTag === 'TEXTAREA' || parentTag === 'INPUT' ||
                    node.parentNode?.isContentEditable ||
                    node.parentNode?.dataset.replacerProcessed === 'true'
                ) {
                    return NodeFilter.FILTER_REJECT;
                }
                // Check if node content matches any applicable regex
                for (const { regex } of applicableRules) {
                    regex.lastIndex = 0; // Reset regex state before testing
                    if (regex.test(node.nodeValue)) {
                        return NodeFilter.FILTER_ACCEPT; // Accept node if any rule matches
                    }
                }
                return NodeFilter.FILTER_REJECT; // Reject if no rules match
            }
        }
    );

    // Process nodes
    const nodesToProcess = [];
    let currentNode;
    while (currentNode = treeWalker.nextNode()) {
        nodesToProcess.push(currentNode);
    }
    nodesToProcess.forEach(node => processNodeWithApplicableRules(node, applicableRules));

    isProcessing = false; // Reset processing flag
}

// --- Initialization and Observation ---
async function initialize() {
    // Disconnect previous observer if it exists
    if (observer) {
        observer.disconnect();
        observer = null; // Ensure old observer is cleared
        console.log("Replacer: Disconnected old observer.");
    }

    try {
        // Load settings from storage (sync and local)
        const syncResult = await chrome.storage.sync.get(['isLicensed']);
        const localResult = await chrome.storage.local.get(['isEnabled', 'ruleBundles', 'activeBundleId', 'domainList', 'disabledRuleIds']);

        // Update currentSettings state
        currentSettings.isLicensed = typeof syncResult.isLicensed === 'boolean' ? syncResult.isLicensed : false;

        currentSettings.isEnabled = typeof localResult.isEnabled === 'boolean' ? localResult.isEnabled : true;
        currentSettings.ruleBundles = Array.isArray(localResult.ruleBundles) ? localResult.ruleBundles : [];
        currentSettings.activeBundleId = localResult.activeBundleId || currentSettings.ruleBundles[0]?.id || null;
        currentSettings.domainList = localResult.domainList || { type: 'disabled', domains: [] };
        currentSettings.disabledRuleIds = new Set(Array.isArray(localResult.disabledRuleIds) ? localResult.disabledRuleIds : []);

        // Basic sanitization (already done more thoroughly in options.js, but good safety net)
        currentSettings.ruleBundles.forEach(bundle => {
            bundle.rules = Array.isArray(bundle.rules) ? bundle.rules : [];
            bundle.rules.forEach(rule => {
                if (!rule.id) rule.id = `rule_${Date.now()}_${Math.random().toString(16).slice(2)}`;
            });
        });
        console.log("Replacer: Settings loaded/reloaded.", currentSettings);

    } catch (error) {
        console.error("Replacer: Error loading settings:", error);
        // Set minimal defaults on error to prevent total failure
        currentSettings = {
            isLicensed: false, // Sync default
            isEnabled: true, // Local default
            ruleBundles: [], // Local default
            activeBundleId: null, // Local default
            domainList: { type: 'disabled', domains: [] }, // Local default
            disabledRuleIds: new Set() // Local default
        };
        // Optionally report error to background
        // chrome.runtime.sendMessage({ action: "reportError", payload: { source: 'content.js', message: 'Error loading settings', error: { message: error.message, name: error.name } } });
    } finally {
        // Only run replacements and start observer if globally enabled (from local storage)
        if (currentSettings.isEnabled) {
            requestAnimationFrame(() => {
                console.log("Replacer: Applying rules after init/update...");
                walkTheDOM(document.body);
            });
            startObserver(); // Start observing only if enabled
        } else {
            console.log("Replacer: Disabled by global toggle. Observer not started.");
            // Ensure observer is definitely stopped if we just became disabled
            if (observer) {
                observer.disconnect();
                observer = null;
            }
        }
    }
}

let observer = null;
function startObserver() {
     if (observer) return; // Don't start if already running

    observer = new MutationObserver((mutationsList) => {
        // Check isEnabled *inside* the callback too, in case it changed
        if (!currentSettings.isEnabled || isProcessing) return;

        // Determine applicable rules (same logic as walkTheDOM/getActiveRules)
        const rulesToConsider = getActiveRules();
        const globalDomainList = currentSettings.domainList;

        const applicableRulesForMutations = [];
         for (const rule of rulesToConsider) {
            if(currentSettings.disabledRuleIds.has(rule.id)) continue; // Skip disabled
            if (checkDomainForRule(rule, globalDomainList)) {
                const regex = createRegExpForRule(rule);
                if (regex) applicableRulesForMutations.push({ rule, regex });
            }
         }

        if (applicableRulesForMutations.length === 0) return; // No rules apply

        // Process mutations asynchronously
        requestAnimationFrame(() => {
            // Set processing flag before iterating mutations
            isProcessing = true;
            for (const mutation of mutationsList) {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            // Walk the subtree of the added element
                            walkTheDOM(node);
                        } else if (node.nodeType === Node.TEXT_NODE) {
                            // Process the added text node directly
                            processNodeWithApplicableRules(node, applicableRulesForMutations);
                        }
                    });
                }
                // Note: We might also want to handle 'characterData' mutations if needed,
                // but it can be performance-intensive. For now, focusing on added nodes.
            }
            // Reset processing flag after handling mutations for this frame
            isProcessing = false;
        });
    });

    observer.observe(document.body, {
        childList: true, // Observe additions/removals of child nodes
        subtree: true    // Observe descendants as well
        // characterData: false // Optionally observe text changes directly (can be slow)
    });
    console.log("Replacer: MutationObserver started/restarted.");
}

// --- Listener for settings updates ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "settingsUpdated") {
        console.log("Replacer: Received settings update message. Re-initializing...");
        initialize(); // Re-initialize to load new settings and start/stop observer
        sendResponse({ status: "ok" });
    }
    return true; // Keep message channel open for async response (though not used here)
});

// --- Run Initialization ---
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
} else {
    initialize();
}
