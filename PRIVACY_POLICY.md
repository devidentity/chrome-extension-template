# Privacy Policy for Scarlet Swap

**Effective Date:** May 3, 2025

Hey there, Buckeye fan (or maybe just someone who appreciates a good text swap)! Thanks for using Scarlet Swap (the "Extension"), provided by the team behind Scarlet Swap ("we," "us," or "our"). This Privacy Policy explains how we handle information when you use the Extension. We try to keep it straightforward – no legal jargon fumbles here.

**By installing or using the Extension, you agree to how we handle things as described below.**

### What Information We Handle

Our goal is to handle the minimum information needed to make the Extension work and improve it. We're not interested in your personal life, just in swapping some text and maybe squashing a bug or two.

1. **Your Rules & Settings (Stored Locally by Chrome):**
   * You create the magic! This includes your text replacement rules (the text to find, the text to replace it with, descriptions, any styles you add, and options like RegEx or domain filters).
   * We also keep track of your Extension settings, like whether it's globally enabled, which individual rules you've disabled, your global domain filter settings, and which rule bundle is active.
   * **How it's stored:** This information is saved using Chrome's local storage features (`chrome.storage.local`). Think of it like Chrome remembering your preferences for you, tied to your browser profile. It is not stored on our servers.
   * **Friendly Advice:** Probably best not to put state secrets or your bank login details into the rule fields, okay?

2. **License "Unlock" Information:**
   * To unlock certain additional features, you may use an unlock code.
   * When you enter a code, the Extension performs a local check to see if it matches a valid code. We don't send the code itself anywhere else.
   * The only thing saved long-term is the *status* indicating whether the features are unlocked (`isLicensed: true`) using Chrome's synced storage feature (`chrome.storage.sync`). This allows the Extension to know across your devices (if Chrome sync is enabled) that you have access to the features. The code itself is not saved after the check.

3. **Anonymous Usage Analytics (via Google Analytics):**
   * To understand general usage patterns (like which features are used, if the enable toggle is popular, or if sharing works) and make the Extension better, we use Google Analytics.
   * **What data is sent:** We send anonymized event information like extension lifecycle events (installed, updated), page views within the extension (popup, options), changes to core settings (enable toggle), feature usage (unlocked, share attempted), and periodic rule statistics (counts of rules/bundles). We also send a randomly generated identifier and session information so Google Analytics can differentiate between usage instances and sessions. These identifiers are stored locally in your browser. We also send basic info like your browser language.
   * **How it's sent:** This data is sent securely using Google's systems directly to Google's servers via a background process within the extension.
   * **What we DON'T collect:** We **do not** collect your IP address (IP addresses are not logged or stored by Google Analytics 4), your browsing history, or the content of the pages you visit via Google Analytics.
   * You can learn more about how Google handles data in their [Privacy Policy](https://policies.google.com/privacy).

4. **Error Reporting (via Sentry):**
   * Sometimes, things break. To find and fix bugs, we use a service called Sentry.
   * **What data is sent:** If the Extension encounters an unexpected error, details about the error (like the error message, the location in the code where it happened, your browser type/version, OS, and the extension version) are automatically sent to Sentry. This helps us diagnose the problem.
   * **How it's sent:** Like analytics, this is sent securely via a background process.
   * **What we DON'T collect:** Sentry reports **do not** include your rules, your browsing history, or the content of the pages you visit. It's focused solely on the technical details of the error itself.
   * You can learn more about Sentry's privacy practices [here](https://sentry.io/privacy/).

### How We Use This Information

* **To Make the Extension Work:** Storing your rules and settings locally is fundamental.
* **To Unlock Features:** Checking the unlock code and saving the licensed status allows access to additional functionality.
* **To Improve the Extension:** Using anonymous analytics data helps us see what's working and what's not. Fixing bugs reported by Sentry keeps things running smoother.

### Data Storage and Security

* Your rules and most settings are stored via Chrome's local storage, managed by Google Chrome under their security practices.
* Your licensed status is stored via Chrome's synced storage, also managed by Google Chrome.
* Your analytics identifiers and session data are stored via Chrome's local storage.
* Analytics and error data are sent directly to Google and Sentry, respectively, using secure connections. We rely on their security measures for data they receive.
* We don't operate our own servers for storing your rules or usage data.
* While we and our partners (Google, Sentry) use reasonable security measures, remember that no system is perfectly secure.

### Data Sharing (or Lack Thereof)

We don't sell or rent your information. Period. We only share data in these limited ways:
* **Google:** Anonymized usage data is sent to Google Analytics as described above.
* **Sentry:** Error report data is sent to Sentry as described above.
* **Business Transfers:** If we sell, transfer, or merge parts of our business or assets, information may be transferred as part of that deal. If this happens, the new owners may handle information in the same way as set out in this privacy policy.
* **Legal Stuff:** We might have to disclose information if required by law or a valid legal request (like a court order).

### Your Choices & Control

* You can view, change, or delete your rules and settings via the Extension's Options page.
* You can disable/enable individual rules using the toggles.
* You can disable the entire Extension using the toggle in the popup or via Chrome's extension management page (`chrome://extensions`).
* **You can uninstall the Extension at any time** through your browser's extension management settings. Uninstalling will remove the extension and its locally stored data. Data stored in synced storage may persist according to Chrome's sync settings until you specifically clear it via your Google account settings.
* *(Note: Standard data rights like access, rectification, erasure under laws like GDPR/CCPA apply to data held by Google/Sentry according to their policies. Managing direct requests related to data stored only within your browser's storage is complex, often best handled by clearing the data yourself or uninstalling.)*

### Children's Privacy

Scarlet Swap is intended for general audiences, likely college-age and up. It's not directed at children under 13 (or 16 in the EU/UK). We don't knowingly collect information from kids.

### Changes to This Policy

We might tweak this policy occasionally. If we make significant changes, we'll update the date at the top and may notify you via the Extension or the Web Store listing. Continuing to use the Extension after changes means you're okay with the new policy.

### Contact Us

Got questions? Please use our [contact form](https://docs.google.com/forms/d/e/1FAIpQLSc2n-Uvv0RrGuz6zcDv_hpKfRggFolEF5d8txFWDwQbEXh_Zg/viewform).
