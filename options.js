(function() {
  const ga4MeasurementId = 'your_ga4_measurement_id_here';

  if (ga4MeasurementId) {
    // Dynamically load the Google Analytics 4 script
    const script = document.createElement('script');
    script.src = `https://www.googletagmanager.com/gtag/js?id=${ga4MeasurementId}`;
    script.async = true;
    document.head.appendChild(script);

    // Initialize gtag once the script is loaded
    script.onload = () => {
      window.dataLayer = window.dataLayer || [];
      function gtag() {
        dataLayer.push(arguments);
      }
      gtag('js', new Date());
      gtag('config', ga4MeasurementId);

      // Send a page_view event
      gtag('event', 'page_view', {
        page_title: document.title,
        page_location: window.location.href,
      });
    };
  }
})();
