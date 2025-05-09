# Scarlet Swap  Buckeye Text Replacer 🏈

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/glcojplfgdgjboobhadopanojgfjpehj?label=Chrome%20Web%20Store&color=scarlet&style=for-the-badge)](https://chrome.google.com/webstore/detail/glcojplfgdgjboobhadopanojgfjpehj)
[![License](https://img.shields.io/badge/License-All%20Rights%20Reserved-lightgrey?style=for-the-badge)](LICENSE)
**Show your Buckeye pride! Scarlet Swap automatically replaces text on web pages based on your custom rules, perfect for transforming rival mentions or any text you want!**

---

## Features

Scarlet Swap offers both free and premium features to customize your browsing experience.

**Core Features (Free):**

* **Default Rules:** Comes pre-loaded with essential rules for Buckeye fans (e.g., replacing "Michigan" with "TTUN").
* **Basic Rule Editing:** Modify the 'Find', 'Replace', and 'Description' fields of the default rules.
* **Enable/Disable Rules:** Easily toggle individual default rules on or off via the Options page.
* **Global Toggle:** Quickly enable or disable all replacements using the extension popup.
* **Themed Interface:** A clean UI with Buckeye colors.

**Premium Features (Unlockable):**

* ✨ **Add Custom Rules:** Create unlimited new text replacement rules.
* 🗑️ **Remove Rules:** Delete custom rules you no longer need.
* ↕️ **Reorder Rules:** Drag and drop rules to control the order replacements happen (useful for overlapping rules).
* ⚙️ **Advanced Matching:**
    * Use **Regular Expressions (RegEx)** for powerful pattern matching.
    * Control **Case Sensitivity**.
    * Match **Whole Words** only.
* 🎨 **Custom Styling:** Apply custom CSS styles (like color, bolding) to your replaced text.
* 🌐 **Domain Filtering:**
    * **Per-Rule Filters:** Make rules run only on specific websites (Allowlist) or exclude specific websites (Blocklist).
    * **Global Filters:** Set default Allow/Block lists that apply to all rules inheriting the global setting.
* 💾 **Import/Export:** Back up your rules to a JSON file or import rules shared by others.

---

## Installation

1.  **Chrome Web Store (Recommended):**
    * Install Scarlet Swap directly from the [Chrome Web Store](https://chrome.google.com/webstore/detail/glcojplfgdgjboobhadopanojgfjpehj) (Link coming soon!)

2.  **Manual Installation (for Development):**
    * Clone this repository: `git clone https://github.com/YOUR_USERNAME/scarlet-swap.git`
    * Open Chrome and navigate to `chrome://extensions`.
    * Enable "Developer mode" using the toggle switch in the top-right corner.
    * Click the "Load unpacked" button.
    * Select the directory where you cloned the repository.

---

## How to Use

1.  **Toggle Extension:** Click the Scarlet Swap icon in your Chrome toolbar to open the popup. Use the main toggle to quickly enable or disable all replacements.
2.  **Manage Rules:** Click "Manage Rules & Settings" in the popup to open the Options page.
3.  **View/Edit Default Rules:** On the Options page, click on a rule summary (like "Beat TTUN") to expand its details. You can edit the "Find Text", "Replace With", and "Description" fields for default rules for free. Use the toggle within the rule details to enable/disable it.
4.  **Unlock Premium:** Enter your unlock code (obtained separately - see below) in the "Unlockable Features" section on the Options page and click "Unlock Features".
5.  **Add/Manage Premium Rules:** Once unlocked, use the "Add New Rule" button, drag handles, remove buttons, advanced checkboxes, CSS input, and domain filters as needed.
6.  **Import/Export (Premium):** Use the buttons in the "Manage Rules (Import/Export)" section. Remember that importing *replaces* all current rules.

---

## Premium Features Activation

Premium features require an unlock code.

* **Getting a Code:** *(TODO: Explain how users obtain a code - e.g., link to a purchase page, Patreon, etc.)*
* **Activation:** Once you have a code, enter it in the "Unlock Code" field on the Options page and click "Unlock Features".
* **Development/Testing:** You can use the code `03-MAY-2025` to unlock premium features for local testing purposes.

---

## Development

* Follow the "Manual Installation" steps above.
* The extension uses standard HTML, CSS, and JavaScript (Manifest V3).
* Key files:
    * `manifest.json`: Extension configuration.
    * `popup.html/.css/.js`: Code for the browser action popup.
    * `options.html/.css/.js`: Code for the settings/options page.
    * `background.js`: Service worker for core logic, event handling, storage management, and communication.
    * `content.js`: (Assumed) Injected into web pages to perform the text replacements.
    * `offscreen.html/.js`: Handles Sentry error reporting and GA4 event sending via the Offscreen API.
* Sentry.io is used for error tracking (DSN configured in `offscreen.js`).
* Google Analytics (GA4) is used for basic usage analytics (Measurement ID & API Secret configured in `offscreen.js`).

---

## License

All Rights Reserved.

*(If you plan to use an open-source license like MIT, update this section and add a LICENSE file).*

---

## Acknowledgements

* Background Image: "Michigan vs. Ohio State..." by [Maize & Blue Nation, Zoey Holmstrom](https://www.flickr.com/photos/maizenbluenation/) via [Flickr](https://www.flickr.com/photos/maizenbluenation/52527222879/) / [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/).
* Contact Us Form Image: "The Shoe" by [aloha75](https://www.flickr.com/photos/aloha75/) via [Flickr](https://www.flickr.com/photos/aloha75/26486971185/) / [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/)
* *(Add acknowledgements for any other libraries or assets used).*

---

## Support

Encountered a bug or have a feature request? Please [open an issue](https://github.com/YOUR_USERNAME/scarlet-swap/issues) on the GitHub repository. Go Bucks! 🌰
