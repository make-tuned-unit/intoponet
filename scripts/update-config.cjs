'use strict'

function normalizeMacUpdateUrl(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2_048) return null
  try {
    const url = new URL(value.trim())
    const host = url.hostname.toLowerCase()
    if (url.protocol !== 'https:' || !host || url.username || url.password || url.search || url.hash) return null
    if (!host.includes('.') || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return null
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host.includes(':')) return null
    if (url.port && url.port !== '443') return null
    return url.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

function macUpdateBuildSetting(mode, env = process.env) {
  const input = mode === 'release' ? (env.INTOPONET_MAC_UPDATE_URL ?? '') : ''
  if (!input) return ''
  const normalized = normalizeMacUpdateUrl(input)
  if (!normalized) throw new Error('INTOPONET_MAC_UPDATE_URL must be a trusted HTTPS host/path without credentials, query, or fragment')
  return normalized
}

module.exports = { normalizeMacUpdateUrl, macUpdateBuildSetting }
