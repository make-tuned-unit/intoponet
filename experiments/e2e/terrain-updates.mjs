import { expect } from './lib.mjs'

/** A controlled digest through the real event bridge, texture uploads and compiled WebGL shader. */
export async function terrainUpdates(ctx) {
  const stamp = new Date().toISOString()
  const story = {
    id: 'hardening-story', label: 'Growing coverage', title: 'A story gathers independent coverage',
    url: 'https://example.com/story', publisher: 'Example', terms: ['coverage'],
    coverage: 4, outlets: 4, articles: 4, internationalDesks: 0, homeOutlets: 4,
    height: 0.2, momentum: 0, countryCode: 'GH', summit: { lat: 5, lon: 0, name: 'Ghana' },
    footprint: [{ lat: 5, lon: 0, radiusKm: 600, weight: 1, name: 'Ghana' }],
    countries: [], firstAt: stamp, latestAt: stamp,
  }
  const digest = { schema: 'intoponet.news-digest.v1', generatedAt: stamp, windowHours: 48,
    feedCount: 4, healthyFeedCount: 4, countries: [], places: [], quietCountryCodes: [], rising: [], mountains: [story] }
  // Hold incoming live refreshes only for this check; other browser events continue normally.
  await ctx.main(`(() => {
    const shell = electron.BrowserWindow.getAllWindows()[0].webContents;
    globalThis.__terrainSend = shell.send.bind(shell);
    shell.send = (channel, event, ...rest) => {
      if (channel === 'browser-host:event' && event?.type === 'news-digest' && !event.payload.includes('hardening-story')) return;
      return globalThis.__terrainSend(channel, event, ...rest);
    };
    return true;
  })()`)
  const send = (mountain) => ctx.main(`(() => {
    electron.BrowserWindow.getAllWindows()[0].webContents.send('browser-host:event', { type: 'news-digest', payload: ${JSON.stringify(JSON.stringify({ ...digest, mountains: [mountain] }))} });
    return true;
  })()`)
  try {
    await ctx.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
    await ctx.evaluate(`(() => {
      const gl = document.querySelector('canvas').getContext('webgl2');
      const uploads = new Map();
      const originals = {};
      let program = null;
      for (const method of ['texImage2D', 'texSubImage2D', 'useProgram']) {
        originals[method] = gl[method];
        gl[method] = function (...args) {
          const result = originals[method].apply(this, args);
          if (method === 'useProgram') {
            if (args[0] && gl.getUniformLocation(args[0], 'uStoryTerrain') !== null) program = args[0];
          } else {
            const data = args.find(a => a instanceof Float32Array && a.length === 512 * 256 * 4);
            if (data) uploads.set(gl.getParameter(gl.TEXTURE_BINDING_2D), data.slice());
          }
          return result;
        };
      }
      window.__terrainProbe = () => {
        if (!program) return null;
        const uniform = name => gl.getUniform(program, gl.getUniformLocation(program, name));
        const read = name => {
          const active = gl.getParameter(gl.ACTIVE_TEXTURE);
          gl.activeTexture(gl.TEXTURE0 + uniform(name));
          const data = uploads.get(gl.getParameter(gl.TEXTURE_BINDING_2D));
          gl.activeTexture(active);
          if (!data) return null;
          const offset = (Math.floor((5 + 90) / 180 * 256) * 512 + 256) * 4;
          const abroad = (Math.floor((36 + 90) / 180 * 256) * 512 + Math.floor((138 + 180) / 360 * 512)) * 4;
          return { height: data[offset], abroad: data[abroad] };
        };
        const vertex = gl.getAttachedShaders(program).find(shader => gl.getShaderParameter(shader, gl.SHADER_TYPE) === gl.VERTEX_SHADER);
        return { from: read('uInterestFrom'), to: read('uInterestTo'), transition: uniform('uInterestTransition'),
          story: uniform('uStoryTerrain'), radial: /transformed = organicDirection \\* \\(ORGANIC_STANDOFF \\+ uVisualExaggeration \\* organicDisplacement\\)/.test(gl.getShaderSource(vertex)) };
      };
      window.__terrainCleanup = () => { for (const [name, method] of Object.entries(originals)) gl[name] = method; delete window.__terrainProbe; delete window.__terrainCleanup; };
      return true;
    })()`)
    await send(story)
    await ctx.wait(`window.__terrainProbe()?.story === 1 && window.__terrainProbe()?.to?.height > 0.15 && window.__terrainProbe()?.transition === 1`, 12000, 'the low story summit to reach the actual GPU texture')
    // View the summit obliquely so the captures also show its vertical relief.
    await ctx.flyTo('Somalia')
    await ctx.delay(3500)
    const low = await ctx.evaluate('window.__terrainProbe()')
    expect(low.radial, 'The compiled vertex shader does not displace terrain radially above the globe.')
    await ctx.shot('low-coverage')
    await send({ ...story, height: 0.6, momentum: 0.7, coverage: 120, outlets: 120, homeOutlets: 120, articles: 120 })
    await ctx.wait(`window.__terrainProbe()?.to?.height > 0.55 && window.__terrainProbe()?.transition < 1`, 2000, 'growing coverage to start a smooth vertical transition')
    const moving = await ctx.evaluate('window.__terrainProbe()')
    expect(moving.from.height < moving.to.height, 'The growing story does not move upward from its previous height.')
    await ctx.wait(`window.__terrainProbe()?.transition === 1`, 6000, 'the raised summit to settle')
    const high = await ctx.evaluate('window.__terrainProbe()')
    expect(Math.abs(high.to.height / low.to.height - 3) < 0.01, 'The GPU summit did not grow in proportion to its height at the same coordinates.')
    await ctx.shot('high-coverage')
    // The height is unchanged: new coverage abroad must still invalidate the geometry.
    const abroad = { ...story, height: 0.6, momentum: 0.7, countries: [{ countryCode: 'JP', outlets: 8, articles: 8, firstAt: stamp,
      headline: { title: 'Coverage abroad', url: 'https://example.com/japan', publisher: 'Japan', publishedAt: stamp } }] }
    await send(abroad)
    await ctx.wait(`window.__terrainProbe()?.to?.abroad > 0.1`, 3000, 'new coverage abroad to raise terrain without a summit-height change')
    await ctx.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    await ctx.delay(300)
    await send({ ...story, height: 0.3 })
    await ctx.wait(`window.__terrainProbe()?.to?.height > 0.25 && window.__terrainProbe()?.to?.height < 0.35`, 3000, 'the reduced-motion update to reach the GPU')
    expect((await ctx.evaluate('window.__terrainProbe()')).transition === 1, 'Reduced motion still animates a terrain update.')
    return `GPU summit ${low.to.height.toFixed(3)} → ${high.to.height.toFixed(3)} at the same coordinates, radial displacement, smooth transition, geographic coverage refresh and reduced motion verified.`
  } finally {
    await ctx.evaluate('window.__terrainCleanup?.(); true').catch(() => undefined)
    await ctx.main(`(() => { electron.BrowserWindow.getAllWindows()[0].webContents.send = globalThis.__terrainSend; delete globalThis.__terrainSend; return true; })()`).catch(() => undefined)
  }
}
