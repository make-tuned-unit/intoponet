(function () {
  // Old snippets have no v. A second copy of this one returns here, before it
  // wraps history or sends anything.
  if (window.permagent && window.permagent.v) return;
  window.permagent = window.permagent || {};
  window.permagent.v = 2;
  var E = "/api/permagent-analytics/collect";
  function safeReferrer() {
    try {
      var raw = document.referrer;
      if (!raw) return null;
      var u = new URL(raw);
      if (u.protocol !== "http:" && u.protocol !== "https:") return null;
      // On a full-page load from one of the site's own links document.referrer
      // is the site itself, which made every site its own top referral source.
      if (u.host === location.host) return null;
      u.username = "";
      u.password = "";
      u.search = "";
      u.hash = "";
      return u.toString();
    } catch (e) { return null; }
  }
  // First-party session id: sessionStorage, no cookie, never cross-site, gone
  // when the tab closes. visitor_hash rotates daily, so without this there is
  // no bounce rate, pages per session or entry page.
  var S = null;
  try {
    S = sessionStorage.getItem("_pa_sid");
    if (!S) {
      S = Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem("_pa_sid", S);
    }
  } catch (e) { /* private mode: sessions degrade, pageviews still count */ }
  // Only allowlisted params ever leave the browser. The server still stores the
  // path WITHOUT the query and extracts the same allowlist; this just keeps
  // ?email= and the like from ever being sent. Original encoded pairs are kept
  // as-is so nothing is re-encoded.
  function allowedQuery() {
    var kept = [];
    var parts = location.search.slice(1).split("&");
    for (var i = 0; i < parts.length; i++) {
      if (!parts[i]) continue;
      var key = parts[i].split("=")[0];
      try { key = decodeURIComponent(key.replace(/\+/g, " ")); } catch (e) {}
      if (/^(utm_[a-z0-9_]*|ref|gclid|fbclid)$/i.test(key)) kept.push(parts[i]);
    }
    return kept.length ? "?" + kept.join("&") : "";
  }
  function send(kind, name, props, ref) {
    var o = {
      k: kind,
      p: location.pathname + allowedQuery(),
      r: ref || null,
      n: name || null,
      d: props || null,
      s: S
    };
    if (navigator.webdriver) o.b = 1;
    var body = JSON.stringify(o);
    if (!(navigator.sendBeacon && navigator.sendBeacon(E, body))) {
      fetch(E, { method: "POST", body: body, keepalive: true }).catch(function () {});
    }
  }
  // Dedupe on pathname. React Router calls replaceState during mount, so
  // hooking both without this fires the initial pageview AND a second from the
  // wrapper — every figure permanently ~2x high, and plausible-looking.
  // Apps that sync filters into the URL via replaceState inflate much further.
  // Hooking only pushState is not the fix either: that misses Router
  // navigations and undercounts.
  var lastPath = null;
  // document.referrer keeps pointing at the ORIGINAL external referrer after a
  // client-side route change, so reporting it on every SPA navigation inflates
  // referrer counts. Send it once, on the first pageview of this page load.
  var sentRef = false;
  function pageview() {
    if (location.pathname === lastPath) return;
    lastPath = location.pathname;
    var ref = sentRef ? null : safeReferrer();
    sentRef = true;
    send("pv", null, null, ref);
  }
  // Chrome speculation-rules prerenders would otherwise count pages the visitor
  // never opened. Wait until the prerendered page is actually activated.
  if (document.prerendering) {
    document.addEventListener("prerenderingchange", pageview, { once: true });
  } else {
    pageview();
  }
  ["pushState", "replaceState"].forEach(function (m) {
    var orig = history[m];
    // Analytics must never break navigation: swallow errors, keep the original
    // method's return value.
    history[m] = function () { var r = orig.apply(this, arguments); try { pageview(); } catch (e) {} return r; };
  });
  addEventListener("popstate", pageview);
  // A bfcache-restored page never re-runs scripts, so without this the return
  // visit is invisible.
  addEventListener("pageshow", function (e) { if (e.persisted) { lastPath = null; pageview(); } });
  // Second argument is a FLAT object of string/number/boolean properties, e.g.
  // permagent.event("list_item_added", { source: "deals", store: "sobeys" }).
  // Nested values are dropped server-side because they cannot be grouped by.
  window.permagent.event = function (name, props) { send("ev", name, props, null); };
  // Opt-in, conservative autocapture: outbound link clicks only. Call
  // permagent.autocapture() to enable. Deliberately not on by default — it
  // manufactures events the site never asked for.
  window.permagent.autocapture = function () {
    if (window.permagent._ac) return;
    window.permagent._ac = true;
    addEventListener("click", function (e) {
      var a = e.target && e.target.closest && e.target.closest("a[href]");
      if (!a) return;
      var url;
      try { url = new URL(a.href, location.href); } catch (err) { return; }
      if (url.host === location.host) return;
      send("ev", "outbound_click", { host: url.host, href: url.href.slice(0, 256) }, null);
    }, true);
  };
})();
