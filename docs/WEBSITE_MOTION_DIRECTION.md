# Website motion direction

## Research reviewed on 28 October 2026

- [Stripe: design and development of its interactive globe](https://stripe.com/blog/globe). Geography, surface light and activity are separate visual layers. Its account of fill-rate costs and stopping offscreen animation informed a single-pass shader, capped resolution and visibility-aware rendering here. We did not copy its globe or suggest that illustrative activity is real telemetry.
- [Apple AirPods Pro](https://www.apple.com/airpods-pro/). Feature-specific imagery makes individual capabilities understandable. Applied as separate visual languages for momentum, history and private knowledge, rather than one generic repeated animation.
- [Linear features](https://linear.app/features). The interface itself is central to the product story. Applied through five selectable views using actual prototype screenshots, with capability descriptions and evidence limitations.
- [MDN WebGL best practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices). Applied a capped back buffer, no depth/stencil buffer, one draw call per frame, a low-power preference and a fallback on context loss. Actual device performance still varies; no 60 fps marketing claim is made.

## Implemented composition

1. A night globe with atmospheric rim, orbital arc, slowly changing contours and pointer response. Signals/night controls change the illustration; no live news endpoint is involved.
2. A list-to-landscape comparison explains the linear-web problem through a controllable diagram.
3. Five feature tabs show Explore, Rising/Fading, The Olds, Laya and Beacons. The screenshot, caption and explanatory copy change together. Arrow keys, Home and End work within the tablist.
4. Coverage curves draw over time; a light travels through historical context; saved-page labels orbit a local knowledge core. These are concept illustrations, distinct from the actual app captures.
5. Beacon sharing remains explicit and private-beta-labeled. The DMG remains coming soon.

## Validation and limits

Reviewed the desktop hero and product showcase in a Chrome guest window, including working shader rendering. Checked 400px and 320px responsive layouts, night/signal controls, pause/resume and feature keyboard navigation. Mobile text/globe layout uses normal flow so text scaling does not force overlap. Reduced motion is implemented in CSS and JavaScript; a full browser/device/accessibility matrix is still outstanding.

No new runtime dependencies, telemetry, accounts or data collection. NASA night texture is reused from the existing browser asset; source context is recorded in `EXECUTION_RUNBOOK.md` under Day & night. Product screenshots retain their source and verification context.
