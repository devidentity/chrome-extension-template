# Chrome Extension Template 🧩

[![License](https://img.shields.io/badge/License-All%20Rights%20Reserved-lightgrey?style=for-the-badge)](LICENSE)

This is a basic template for creating Chrome Extensions. It includes pre-configured integrations for:

*   **Sentry.io:** For error tracking and performance monitoring.
*   **Google Analytics 4 (GA4):** For collecting basic usage analytics, including page views for the popup and options pages, and an example of alarm-triggered event collection.

The template also provides a basic popup and options page structure, and a generalized privacy policy.

---

## Features

*   **Sentry.io Integration:** Error tracking and performance monitoring are set up.
*   **GA4 Integration:** Basic usage analytics, page view tracking for popup and options, and an example alarm-triggered event.
*   **Basic Popup:** Includes a link to the Options page.
*   **Basic Options Page:** A placeholder page to build upon.
*   **Generalized Privacy Policy:** Includes language for Sentry and GA4 usage.
*   **Basic Licensing Logic:** A simple framework is included for potential free/premium features.

---

## Installation

To use this template, you will typically clone the repository and load it as an unpacked extension in Chrome for development and testing.

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
* Basic licensing logic is included (see relevant files).

---

## Customizing the Template (Placeholders)

This template uses placeholders in the format `{{PLACEHOLDER}}` that you will need to replace with your specific information.

*   **Extension Name and Description:**
    *   In `manifest.json`, replace `Chrome Extension Template` and `A template for building Chrome extensions with Sentry and GA4 integrations.` with your extension's name and a brief description.
*   **Sentry.io DSN:**
    *   In `offscreen.js` (and potentially other files where Sentry is initialized), replace `your_sentry_dsn_here` with your Sentry DSN. You can find this in your Sentry project settings.
*   **GA4 Measurement ID:**
    *   In `offscreen.js` (and potentially other files where GA4 is initialized), replace `your_ga4_measurement_id_here` with your GA4 Measurement ID. You can find this in your Google Analytics 4 property settings.
*   **Developer/Company Information:**
    *   In `PRIVACY_POLICY.md`, replace `Example Company`, `Developer Name`, and `developer@example.com` with your relevant details.
*   **Licensing Logic:**
    *   Modify the licensing logic placeholders (if any remain) and implement your specific premium feature unlock mechanism.

Remember to search for all instances of `{{` to ensure you find and replace all placeholders.

---

## Testing Locally

1.  **Clone the Repository:** If you haven't already, clone this repository to your local machine.


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
