// "One world. Two perspectives." — a concept illustration, not data.
// The landscape: a spectral contour field rises under four story peaks and a light
// pulse travels the route between them. The list: the field flattens into a feed.
(() => {
  const stage = document.querySelector('.discovery-stage');
  if (!stage) return;
  const canvas = stage.querySelector('.field-canvas');
  const ctx = canvas.getContext('2d');
  const nodes = [...stage.querySelectorAll('.story-node')];
  const routes = [...stage.querySelectorAll('.route')];
  const traveller = stage.querySelector('.traveller');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');

  // Peak centres as fractions of the stage, matching the cards' CSS positions.
  const peaks = [[0.20, 0.30], [0.50, 0.22], [0.38, 0.66], [0.79, 0.54]];
  const heights = [1.6, 1, 1, 1];
  const targets = [1.6, 1, 1, 1];
  let lift = 1, liftTarget = 1;
  let W = 0, H = 0, dpr = 1;
  let active = 0, hover = -1, travel = null;
  let visible = false, frame = 0, previous = 0, clock = 0, nextHop = 0;

  const HOP_EVERY = 3400; // ms between journeys
  const HOP_TIME = 1700;  // ms for the pulse to travel a route

  // Peaks and routes follow the cards' landscape anchors (their CSS left/top), so the
  // illustration stays aligned at every breakpoint.
  function layout() {
    if (stage.dataset.mode === 'linear') return;
    nodes.forEach((node, k) => { peaks[k] = [node.offsetLeft / W, node.offsetTop / H]; });
    const bends = [[-0.6, -1], [0.35, 0.55], [0.6, 0.5], [-0.25, -1.2]];
    routes.forEach((route, k) => {
      const a = peaks[k], b = peaks[(k + 1) % peaks.length];
      const ax = a[0] * 1000, ay = a[1] * 500, bx = b[0] * 1000, by = b[1] * 500;
      const [u, v] = bends[k];
      const c1x = ax + (bx - ax) * 0.3, c1y = ay + Math.abs(bx - ax) * 0.25 * v + (by - ay) * 0.1;
      const c2x = ax + (bx - ax) * 0.7 + u * 40, c2y = by + Math.abs(bx - ax) * 0.15 * v;
      route.setAttribute('d', `M${ax.toFixed(1)} ${ay.toFixed(1)}C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${bx.toFixed(1)} ${by.toFixed(1)}`);
    });
  }

  function resize() {
    const box = stage.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = box.width; H = box.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    layout();
    draw();
  }

  // Peaks are a smaller share of the taller phone layout.
  const peakScale = () => (W < 600 ? 0.16 : 0.3);

  // A line whose resting height sits one peak-height below an apex is lifted onto it, so
  // each peak's centre is offset downward by its own lift; the summit then meets the marker.
  function fieldAt(x, y) {
    let h = 0;
    const sx = W * 0.06, sy = H * 0.13;
    for (let k = 0; k < peaks.length; k++) {
      const dx = x - peaks[k][0] * W, dy = y - (peaks[k][1] * H + H * peakScale() * lift * Math.min(heights[k], 1.2));
      h += heights[k] * Math.exp(-(dx * dx) / (2 * sx * sx) - (dy * dy) / (2 * sy * sy));
    }
    return h;
  }

  function draw() {
    if (!W || !H) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const gradient = ctx.createLinearGradient(0, 0, W, 0);
    gradient.addColorStop(0, '#00c7e4');
    gradient.addColorStop(0.42, '#20f4e4');
    gradient.addColorStop(0.72, '#ff9a85');
    gradient.addColorStop(1, '#ff6856');
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 1;
    const spacing = W < 600 ? 13 : 11;
    const count = Math.ceil((H * 1.25) / spacing);
    const amplitude = H * peakScale() * lift;
    for (let i = 0; i <= count; i++) {
      const base = i * spacing + H * 0.06;
      let strongest = 0;
      ctx.beginPath();
      for (let x = -6; x <= W + 6; x += 5) {
        const h = fieldAt(x, base);
        if (h > strongest) strongest = h;
        const drift = (Math.sin(x * 0.011 + clock * 0.00032 + i * 0.42) * 2.4 + Math.sin(x * 0.0037 - clock * 0.00021) * 3.2) * (0.35 + 0.65 * lift);
        const y = base - h * amplitude + drift;
        if (x === -6) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.globalAlpha = 0.07 + Math.min(0.55, strongest * 0.36 * lift) + (1 - lift) * 0.05;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function placeTraveller(route, progress) {
    const length = route.getTotalLength();
    const point = route.getPointAtLength(length * progress);
    traveller.style.transform = `translate(${(point.x / 1000) * W}px, ${(point.y / 500) * H}px)`;
  }

  function setActive(index) {
    active = index;
    stage.dataset.active = String(index);
    nodes.forEach((node, i) => node.classList.toggle('is-active', i === index));
    retarget();
  }

  function retarget() {
    for (let k = 0; k < targets.length; k++) targets[k] = k === hover ? 1.85 : k === active ? 1.6 : 1;
  }

  const ease = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

  function tick(now) {
    frame = 0;
    const dt = Math.min(64, now - previous || 16);
    previous = now;
    clock += dt;
    // Damped approach (about 850ms to settle), per the brand motion system.
    const k = 1 - Math.exp(-dt / 220);
    for (let i = 0; i < heights.length; i++) heights[i] += (targets[i] - heights[i]) * k;
    lift += (liftTarget - lift) * k;

    if (liftTarget === 1) {
      if (!travel && clock >= nextHop) {
        travel = { route: routes[active], from: active, to: (active + 1) % nodes.length, start: clock };
        routes.forEach((route) => route.classList.toggle('is-live', route === travel.route));
        stage.classList.add('is-travelling');
      }
      if (travel) {
        const p = Math.min(1, (clock - travel.start) / HOP_TIME);
        placeTraveller(travel.route, ease(p));
        if (p >= 1) {
          setActive(travel.to);
          travel = null;
          nextHop = clock + HOP_EVERY - HOP_TIME;
          stage.classList.remove('is-travelling');
        }
      }
    }
    draw();
    const settling = Math.abs(liftTarget - lift) > 0.002 || heights.some((h, i) => Math.abs(targets[i] - h) > 0.002);
    if (visible && !document.hidden && (liftTarget === 1 || settling)) frame = requestAnimationFrame(tick);
  }

  function start() {
    if (reduce.matches || frame || !visible || document.hidden) return;
    previous = performance.now();
    frame = requestAnimationFrame(tick);
  }

  function stop() { cancelAnimationFrame(frame); frame = 0; }

  function applyMode() {
    liftTarget = stage.dataset.mode === 'linear' ? 0 : 1;
    if (liftTarget === 0) { travel = null; stage.classList.remove('is-travelling'); routes.forEach((r) => r.classList.remove('is-live')); }
    else { nextHop = clock + 900; setTimeout(layout, 900); }
    if (reduce.matches) { lift = liftTarget; heights.forEach((_, i) => { heights[i] = targets[i]; }); draw(); }
    else { stop(); start(); }
  }

  nodes.forEach((node, i) => {
    node.addEventListener('pointerenter', () => { hover = i; retarget(); start(); });
    node.addEventListener('pointerleave', () => { hover = -1; retarget(); start(); });
  });

  new MutationObserver(applyMode).observe(stage, { attributes: true, attributeFilter: ['data-mode'] });
  new ResizeObserver(resize).observe(stage);
  new IntersectionObserver((entries) => {
    visible = entries[0].isIntersecting;
    if (visible) start(); else stop();
  }, { threshold: 0.05 }).observe(stage);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else start(); });
  reduce.addEventListener('change', () => { stop(); applyMode(); });

  setActive(0);
  nextHop = 1200;
  resize();
})();
