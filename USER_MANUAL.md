# Scarlet Swap - User Manual

Welcome to Scarlet Swap! This guide explains how to use the extension to customize your browsing experience.

Table of Contents

* [Using the Popup](#using-the-popup)

* [Using the Rules & Settings Page](#using-the-rules--settings-page)

  * [Viewing Rules](#viewing-rules)

  * [Enabling/Disabling Rules](#enablingdisabling-rules)

  * [Editing Rules](#editing-rules)

  * [Unlocking Additional Features](#unlocking-additional-features)

  * [Advanced Rule Editing (Unlocked)](#advanced-rule-editing-unlocked)

  * [Reordering Rules (Unlocked)](#reordering-rules-unlocked)

  * [Adding New Rules (Unlocked)](#adding-new-rules-unlocked)

  * [Deleting Rules (Unlocked)](#deleting-rules-unlocked)

  * [Advanced Rule Options (Unlocked)](#advanced-rule-options-unlocked)

  * [Global Domain Filtering (Unlockable)](#global-domain-filtering-unlockable)

  * [Manage Rule Bundles (Import/Export - Unlockable)](#manage-rule-bundles-importexport---unlockable)

  * [Give Feedback / Contact Us](#give-feedback--contact-us)

* [How Replacements Work](#how-replacements-work)

* [Tips & Troubleshooting](#tips--troubleshooting)

* [Uninstalling Scarlet Swap](#uninstalling-scarlet-swap)

### Using the Popup

Click the Scarlet Swap icon in your Chrome toolbar to open the popup.

* **Enable Extension:** Use the main toggle switch to turn all text replacements on or off globally.

* **Manage Rules & Settings:** Opens the full Rules & Settings page to manage individual rules and settings.

* **Copy Share Link:** Copy a link to the extension (on the Chrome Web Store) to your clipboard, making it easy to share.

### Using the Rules & Settings Page

Access the Rules & Settings page via the button in the popup or through your browser's extensions management page (`chrome://extensions`).

* **Spread the Word!:** Share a link to the extension (on the Chrome Web Store). This button attempts to use your operating system's native sharing options first, falling back to copying the link to your clipboard if native sharing is not available.

### Viewing Rules

Under the "Replacement Rules" section, view the list of defined rules.

* Each rule shows its **Description** and a **Find -> Replace** summary.

* Click a rule's summary line (or arrow) to expand/collapse its details.

### Enabling/Disabling Rules (Standard Feature)

Turn individual rules on or off:

1. Expand the desired rule.

2. Use the **"Enable this Rule"** toggle switch.

   * Checked (On): Rule is active.

   * Unchecked (Off): Rule is inactive.

3. A **(Disabled)** indicator appears on the summary line for inactive rules.

*Note: Changes save automatically in your browser's local storage.*

### Editing Rules

You can edit the basic fields of rules in any bundle that is marked as editable (e.g., "Custom" bundles created via Copy or Import).

1. Expand the rule you want to edit.

2. Modify the **Description**, **Find Text**, or **Replace With** fields.

*Note: Changes save automatically when you click outside the field or press Enter.*
*Note: Editing advanced options for rules requires unlocking additional features.*

### Unlocking Additional Features

Navigate to the "Unlockable Features" section on the Rules & Settings page.

1. Enter the provided unlock code into the **"Unlock Code"** field. (The test code can be found via the Give Feedback link).

2. Click **"Unlock Features"**.

3. Status messages confirm success or failure. If successful, the status bar updates, and advanced options become available.

### Advanced Rule Editing (Unlocked)

Once features are unlocked, you can access and edit advanced options for rules in editable bundles:

* You can now edit the "Description", "Find Text", and "Replace With" fields for rules in any custom (editable) bundle.

* Access the advanced rule options detailed below within each rule's expanded details.

*Note: Changes to advanced options are only savable for rules within editable bundles.*

### Reordering Rules (Unlocked)

Change the order in which rules are applied (rules higher in the list run first). This is only available for rules within editable bundles.

1. Click and hold the drag handle (⠿) on the left of the rule you want to move.

2. Drag the rule up or down; a red indicator line shows the potential drop position.

3. Release the mouse button to drop the rule in the new position.

*The new order saves automatically.*

### Adding New Rules (Unlocked)

You can add new rules to the currently active bundle if it is an editable bundle.

1. Click **"Add New Rule"** below the rules list (this button is visible only when features are unlocked and an editable bundle is selected).

2. A new, empty rule appears at the bottom of the list.

3. Expand the new rule and fill in its details (Description, Find Text, Replace With, and Advanced Options).

*Changes save automatically.*

### Deleting Rules (Unlocked)

You can delete rules from any bundle except the primary hardcoded default bundle.

1. Expand the rule to delete.

2. Click **"Remove Rule"** at the bottom of its details.

3. You will be asked to confirm. Confirming removes the rule immediately (this action cannot be undone).

*Note: The primary hardcoded default rules cannot be deleted, only disabled. Rules in other bundles (preloaded or custom) can be deleted.*

### Advanced Rule Options (Unlocked)

These options are available within each rule's details when features are unlocked and the rule is in an editable bundle:

* **CSS Styles:** Apply custom CSS styling to the replaced text (e.g., `color: green; font-weight: bold;`).

* **RegEx:** Treat the "Find Text" field as a Regular Expression pattern for more flexible and powerful matching.

* **Match Case:** Match the "Find Text" only if the capitalization is identical. (Ignored if RegEx is checked).

* **Whole Word:** Match the "Find Text" only if it appears as a complete word (surrounded by spaces, punctuation, or the start/end of text). (Ignored if RegEx is checked).

* **Rule Domain Filter:** Control where this specific rule runs, overriding the Global Domain Filtering setting:

  * **Inherit Global Setting:** Uses the global filter settings defined below.

  * **Allowlist:** This rule runs **only** on the domains or RegEx patterns listed below.

  * **Blocklist:** This rule runs everywhere **except** on the domains or RegEx patterns listed below.

* **Rule Domains:** (This field appears when Allowlist/Blocklist is selected) Enter domains (e.g., `google.com`, `news.yahoo.com`) or RegEx patterns (e.g., `/.*\.google\.com/` to match any Google subdomain) one per line.

### Global Domain Filtering (Unlockable)

This setting applies a default domain filter to all rules that have their "Rule Domain Filter" set to "Inherit Global Setting".

* **Global Filter Mode:** Choose the default filtering behavior:

  * **Disabled:** Rules run everywhere by default.

  * **Allowlist:** Rules run only on the domains/RegEx listed in "Global Domains".

  * **Blocklist:** Rules run everywhere except on the domains/RegEx listed in "Global Domains".

* **Global Domains:** Enter domains or RegEx patterns (one per line) for the global filter. RegEx patterns should be enclosed in forward slashes (e.g., `/.*\.example\.com/`).

### Manage Rule Bundles (Import/Export - Unlockable)

These features allow you to save and load your rule configurations.

* **Import Bundle(s):** Click this button to select one or more JSON files from your computer. Each file is expected to contain an array of bundle objects, each with a `name` and a `rules` array. Importing creates new custom bundles from the file(s). **Warning: Importing does NOT merge; it adds new bundles alongside your existing ones.**

* **Export Active Bundle:** Saves only the currently selected rule bundle to a JSON file on your computer. This file contains the bundle's name and its rules.

* **Export All Bundles:** Saves *all* your current rule bundles (including the default, preloaded, and custom ones) to a single JSON file. This is recommended for creating backups of your entire configuration.

*Note: The exported JSON format is an array of bundle objects, where each bundle object contains a `name` and a `rules` array. Each rule object within the `rules` array contains the rule's properties (description, find, replace, etc.).*

### Give Feedback / Contact Us

Have questions, suggestions, bug reports, or just want to share some kudos?

* Click the **"Give Feedback"** button on the Rules & Settings page. This will open a contact form in a new tab where you can submit your message.

* You can also find a link to the contact form in the extension's [Privacy Policy](https://docs.google.com/forms/d/e/1FAIpQLSc2n-Uvv0RrGuz6zcDv_hpKfRggFolEF5d8txFWDwQbEXh_Zg/viewform).

### How Replacements Work

1. The extension's content script runs on the web page and reads its text content.

2. Enabled rules from the currently active rule bundle are checked against the text.

3. Rules are processed in the order they appear in the list (from top to bottom).

4. When a rule's "Find Text" matches, it is replaced with the "Replace With" text, and any specified CSS styles are applied.

5. If multiple rules match overlapping text, the rule higher up in the list will perform its replacement first. Subsequent rules will then run on the text *after* the previous replacements have been made.

6. The extension attempts to handle dynamically loaded content, but effectiveness may vary depending on the website's structure and how content is loaded.

7. Hovering over text that has been replaced by Scarlet Swap will often show the original text in a tooltip.

### Tips & Troubleshooting

* **Rules Not Working?** Double-check the global toggle in the popup, the individual rule toggle in the Rules & Settings page, the rule's specific settings (Find Text accuracy, Case Sensitivity, Whole Word, RegEx), and the Global/Rule Domain Filters.

* **Performance:** While generally lightweight, using a very large number of rules or complex Regular Expressions on busy websites might slightly impact page loading or scrolling performance.

* **Rule Conflicts:** Be mindful of rules that might match text that was already replaced by a rule higher in the list. Adjusting the order (when unlocked) or refining rule patterns can help manage conflicts.

Enjoy using Scarlet Swap! Go Bucks!

### Uninstalling Scarlet Swap

To remove the extension:

1. Go to your Chrome Extensions management page by typing `chrome://extensions` in the address bar.

2. Find Scarlet Swap in the list.

3. Click the "Remove" button.

*Note: Uninstalling the extension will remove the extension files and delete the data stored locally in your browser's storage (`chrome.storage.local`). Data stored in synced storage (`chrome.storage.sync`, currently only your license status) may persist according to your Chrome sync settings unless you specifically clear synced data via your Google account settings.*
