# Chrome Extension Template - User Manual

Welcome to your new Chrome Extension, generated from a template that includes integrations for Sentry.io and Google Analytics 4 (GA4).

This is a basic template to get you started with common Chrome Extension features and popular analytics/error tracking services. You will likely need to customize this manual based on the specific functionality of your extension.

Table of Contents

* [Using the Popup](#using-the-popup)

* [Using the Options Page](#using-the-options-page)

### Using the Popup

Click the extension icon in your Chrome toolbar to open the popup.

This popup is a basic starting point. It may contain controls or information relevant to your extension's core functionality.

### Using the Rules & Settings Page

Access the options page via the button in the popup or through your browser's extensions management page (`chrome://extensions`). This page is intended for settings and configuration of your extension.

### Uninstalling the Extension

To remove the extension:

1. Go to your Chrome Extensions management page by typing `chrome://extensions` in the address bar.

2. Find Scarlet Swap in the list.

3. Click the "Remove" button.

*Note: Uninstalling the extension will remove the extension files and delete the data stored locally in your browser's storage (`chrome.storage.local`). Data stored in synced storage (`chrome.storage.sync`, currently only your license status) may persist according to your Chrome sync settings unless you specifically clear synced data via your Google account settings.*
