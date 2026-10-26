const { mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { arch, cpus, totalmem } = require('node:os')
const { createHash } = require('node:crypto')
const { app, BrowserWindow, screen, WebContentsView } = require('electron')

const experimentRoot = __dirname
const workloadPath = join(experimentRoot, '../compositor-benchmark/scenario.html')
const resultsDirectory = join(experimentRoot, 'results')
const contractPath = join(experimentRoot, '../compositor-benchmark/contract.json')
const contract = JSON.parse(readFileSync(contractPath, 'utf8'))
const benchmarkRoot = join(experimentRoot, '../compositor-benchmark')
const digestFile = (path) =>
  createHash('sha256').update(readFileSync(join(benchmarkRoot, path))).digest('hex')
const artifacts = Object.fromEntries(contract.assets.map((asset) => [asset, digestFile(asset)]))
const workloadSha256 = digestFile('scenario.html')
const viewport = contract.viewport

const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration))

function percentile(values, point) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * point))]
}

function compactProcessMetrics(metrics) {
  return metrics.map((metric) => ({
    pid: metric.pid,
    type: metric.type,
    name: metric.name,
    cpuPercent: metric.cpu.percentCPUUsage,
    workingSetKb: metric.memory.workingSetSize,
    peakWorkingSetKb: metric.memory.peakWorkingSetSize,
  }))
}

async function animateBounds(view, from, to, durationMs) {
  const samples = []
  const startedAt = performance.now()
  let previousAt = startedAt

  await new Promise((resolve) => {
    const step = () => {
      const now = performance.now()
      const progress = Math.min(1, (now - startedAt) / durationMs)
      const eased = 1 - Math.pow(1 - progress, 3)
      const bounds = {}
      for (const key of ['x', 'y', 'width', 'height']) {
        bounds[key] = Math.round(from[key] + (to[key] - from[key]) * eased)
      }
      view.setBounds(bounds)
      samples.push(now - previousAt)
      previousAt = now
      if (progress < 1) setTimeout(step, 16)
      else resolve()
    }
    step()
  })

  return {
    requestedDurationMs: durationMs,
    actualDurationMs: performance.now() - startedAt,
    updateCount: samples.length,
    averageUpdateIntervalMs:
      samples.reduce((total, value) => total + value, 0) / Math.max(1, samples.length),
    p95UpdateIntervalMs: percentile(samples, 0.95),
    updatesOver20ms: samples.filter((value) => value > 20).length,
  }
}

async function run() {
  const display = screen.getPrimaryDisplay()
  const window = new BrowserWindow({
    show: true,
    width: viewport.width,
    height: viewport.height,
    resizable: false,
    backgroundColor: '#07111b',
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  await window.loadFile(join(experimentRoot, 'shell.html'))

  const view = new WebContentsView({
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  window.contentView.addChildView(view)
  window.show()
  window.focus()
  app.focus({ steal: true })

  const initialBounds = contract.initialBounds
  const settledBounds = contract.settledBounds
  view.setBounds(initialBounds)
  await view.webContents.loadFile(workloadPath)
  await wait(contract.initialWaitMs)

  const processMetricsBefore = compactProcessMetrics(app.getAppMetrics())
  const openingTransition = await animateBounds(view, initialBounds, settledBounds, contract.transitionDurationMs)

  // This executes only in the repository-owned deterministic benchmark page.
  await view.webContents.executeJavaScript(`
    document.querySelector('input[name="query"]').focus();
    document.querySelector('input[name="query"]').value += ' — edited';
    document.querySelector('#clip').play().catch(() => {});
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
  `)
  const buttonCenter = await view.webContents.executeJavaScript(`
    (() => {
      const bounds = document.querySelector('#interaction-button').getBoundingClientRect();
      return { x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2) };
    })()
  `)
  view.webContents.sendInputEvent({
    type: 'mouseDown',
    x: buttonCenter.x,
    y: buttonCenter.y,
    button: 'left',
    clickCount: 1,
  })
  view.webContents.sendInputEvent({
    type: 'mouseUp',
    x: buttonCenter.x,
    y: buttonCenter.y,
    button: 'left',
    clickCount: 1,
  })
  await wait(contract.scrollDownWaitMs)
  await view.webContents.executeJavaScript(
    `window.scrollTo({ top: 0, behavior: 'smooth' })`,
  )
  await wait(contract.scrollUpWaitMs)

  const closingTransition = await animateBounds(view, settledBounds, initialBounds, contract.transitionDurationMs)
  await wait(contract.closeSettleWaitMs)
  const workload = await view.webContents.executeJavaScript(
    `window.__INTOPONET_BENCHMARK__.snapshot(${display.displayFrequency})`,
  )
  const processMetricsAfter = compactProcessMetrics(app.getAppMetrics())

  const result = {
    schemaVersion: 'engine-compositor-result-v1',
    recordedAt: new Date().toISOString(),
    candidate: 'electron-webcontentsview',
    runtime: {
      electron: process.versions.electron,
      chromium: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
      arch: arch(),
    },
    hardware: {
      cpuModel: cpus()[0]?.model ?? 'unknown',
      logicalCpuCount: cpus().length,
      totalMemoryBytes: totalmem(),
      displayFrequencyHz: display.displayFrequency,
      scaleFactor: display.scaleFactor,
    },
    viewport,
    scenario: {
      contract,
      artifacts: { workloadSha256, ...artifacts },
      version: workload.version,
    },
    transition: {
      opening: openingTransition,
      closing: closingTransition,
    },
    workload,
    processMetricsBefore,
    processMetricsAfter,
    limitations: [
      'This run does not yet measure IME, screen-reader output, video decode, permissions, or crash recovery.',
      'CPU samples are Electron point-in-time process metrics, not energy-impact measurements.',
    ],
  }

  mkdirSync(resultsDirectory, { recursive: true })
  const timestamp = result.recordedAt.replaceAll(':', '-')
  const resultPath = join(resultsDirectory, `electron-${timestamp}.json`)
  writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 })
  writeFileSync(join(resultsDirectory, 'latest.json'), `${JSON.stringify(result, null, 2)}\n`, {
    mode: 0o600,
  })
  console.log(`Electron compositor result: ${resultPath}`)
  app.exit(0)
}

app.whenReady().then(run).catch((error) => {
  console.error(error)
  app.exit(1)
})
