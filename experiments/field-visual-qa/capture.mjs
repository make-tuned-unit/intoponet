import fs from 'node:fs'
import path from 'node:path'

const port = Number(process.argv[2] ?? 9229)
const output = process.argv[3]
const scale = process.argv[4] ?? 'earth'
const radius = scale === 'city' ? 1.96 : 3.52
if (!output) throw new Error('Usage: node capture.cjs <port> <output.png>')

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const response = async (url) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      return await fetch(url)
    } catch {
      await delay(100)
    }
  }
  throw new Error(`Timed out waiting for ${url}`)
}

let target
for (let attempt = 0; attempt < 100 && !target; attempt += 1) {
  const targets = await (await response(`http://127.0.0.1:${port}/json/list`)).json()
  target = targets.find((item) => item.type === 'page')
  if (!target) await delay(100)
}
if (!target?.webSocketDebuggerUrl) throw new Error('Electron page target was not found')

const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})

let nextId = 0
const pending = new Map()
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (!message.id) return
  const entry = pending.get(message.id)
  if (!entry) return
  pending.delete(message.id)
  if (message.error) entry.reject(new Error(message.error.message))
  else entry.resolve(message.result)
})
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId
  pending.set(id, { resolve, reject })
  socket.send(JSON.stringify({ id, method, params }))
})

await send('Page.enable')
await send('Emulation.setEmulatedMedia', {
  features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
})
const setup = `
  localStorage.setItem('intoponet.exploration-scale.v1', 'earth');
  localStorage.setItem('intoponet.exploration-state.v1', JSON.stringify({
    scale: '${scale}', geographicAnchor: { lat: 40.7, lon: -74 },
    selectedTopicId: 'open-knowledge', pose: { theta: -1.851, phi: 0.881, radius: ${radius} }
  }));
  localStorage.setItem('intoponet.active-topic.v1', 'Open knowledge');
`
await send('Runtime.evaluate', { expression: setup, returnByValue: true })
await send('Page.reload', { ignoreCache: true })
await delay(2500)
const diagnostics = await send('Runtime.evaluate', {
  expression: `(() => {
    const canvas = document.querySelector('canvas');
    const host = canvas && canvas.__r3f;
    const store = host && (host.store || host.root || host);
    const state = store && typeof store.getState === 'function' ? store.getState() : null;
    const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
    const program = gl?.getParameter(gl.CURRENT_PROGRAM);
    const uniforms = [];
    if (gl && program) {
      const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
      for (let index = 0; index < count; index += 1) {
        const info = gl.getActiveUniform(program, index);
        if (!info) continue;
        const location = gl.getUniformLocation(program, info.name);
        uniforms.push({ name: info.name, value: location ? gl.getUniform(program, location) : null });
      }
    }
    return {
      r3fKeys: host ? Object.keys(host) : [],
      currentWebGLUniforms: uniforms,
      webglError: gl?.getError() ?? null,
      cameraState: JSON.parse(localStorage.getItem('intoponet.exploration-state.v1') ?? 'null'),
      prefersReducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      sceneChildren: state?.scene?.children?.map((object) => ({
        type: object.type,
        material: object.material?.type,
        uniforms: object.material?.uniforms ? {
          uCount: object.material.uniforms.uCount?.value,
          uDim: object.material.uniforms.uDim?.value,
          uWidthScale: object.material.uniforms.uWidthScale?.value,
          uA0: object.material.uniforms.uA?.value?.[0]?.toArray?.(),
        } : null,
      })) ?? null,
      fieldLabel: document.querySelector('.field-source-note')?.textContent ?? null,
      publicFieldText: [...document.querySelectorAll('*')].find((node) => node.childElementCount === 0 && (node.textContent?.includes('Synthetic fixture snapshot') || node.textContent?.includes('Deterministic public-record render fixture')))?.textContent ?? null,
    };
  })()`,
  returnByValue: true,
})
const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
fs.mkdirSync(path.dirname(output), { recursive: true })
fs.writeFileSync(output, Buffer.from(result.data, 'base64'))
fs.writeFileSync(output.replace(/\.png$/, '.json'), JSON.stringify(diagnostics.result?.value ?? diagnostics, null, 2))
console.log(`Wrote ${output} (${Buffer.from(result.data, 'base64').length} bytes)`)
console.log(JSON.stringify(diagnostics.result?.value ?? diagnostics))
socket.close()
