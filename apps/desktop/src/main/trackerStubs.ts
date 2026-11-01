/**
 * Harmless stand-ins for the analytics globals that blocked tracker scripts
 * would have defined (gtag/dataLayer, analytics.js `ga`, the Meta pixel `fbq`).
 *
 * Pages often call these from their own buttons, e.g. a cookie banner's OK
 * runs `gtag('consent', 'update', …)` before hiding itself. With the tracker
 * blocked, that call throws a ReferenceError and the button does nothing.
 * The stubs only fill globals that are missing, record nothing, send nothing,
 * and still run the completion callbacks pages wait on before navigating.
 */
export const TRACKER_STUB_SCRIPT = `(() => {
  const w = window;
  const later = (fn) => { if (typeof fn === 'function') setTimeout(() => { try { fn() } catch {} }, 0) };
  if (!w.dataLayer) w.dataLayer = [];
  if (typeof w.gtag !== 'function') {
    w.gtag = function gtag() {
      const options = arguments[2];
      if (options && typeof options === 'object') later(options.event_callback);
      try { w.dataLayer.push(arguments) } catch {}
    };
  }
  if (!w.google_tag_manager && Array.isArray(w.dataLayer) && w.dataLayer.push === Array.prototype.push) {
    const layer = w.dataLayer;
    layer.push = function push() {
      for (const item of arguments) if (item && typeof item === 'object') later(item.eventCallback);
      return Array.prototype.push.apply(layer, arguments);
    };
  }
  if (typeof w.ga !== 'function') {
    const ga = function ga() {
      (ga.q = ga.q || []).push(arguments);
      for (const arg of arguments) if (arg && typeof arg === 'object') later(arg.hitCallback);
    };
    ga.l = Date.now();
    w.ga = ga;
  }
  if (typeof w.fbq !== 'function') {
    const fbq = function fbq() { fbq.queue.push(arguments) };
    fbq.queue = [];
    fbq.loaded = true;
    fbq.version = '2.0';
    w.fbq = fbq;
    if (!w._fbq) w._fbq = fbq;
  }
})()`
