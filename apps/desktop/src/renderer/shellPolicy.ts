/**
 * The app window's page (renderer/index.html) carries a Content-Security-Policy in a <meta>: its own
 * scripts only, and only the images, media, fonts and connections the shell really uses. Vite's dev
 * server needs more (React Refresh's inline preamble script, a <style> per imported stylesheet, and its
 * own websocket), so `electron-vite dev` gets those added here; the built page never carries them.
 */

/** The policy's <meta> in index.html; the first group is its content. */
export const SHELL_POLICY_META = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"\s*\/?>/i

/** Directive name → its sources, in order. */
export function parsePolicy(policy: string): Map<string, string[]> {
  const directives = new Map<string, string[]>()
  for (const part of policy.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/)
    if (name && !directives.has(name.toLowerCase())) directives.set(name.toLowerCase(), sources)
  }
  return directives
}

export function formatPolicy(directives: Map<string, string[]>): string {
  return [...directives].map(([name, sources]) => [name, ...sources].join(' ')).join('; ')
}

/** The shell's policy with what Vite's dev server needs added (development only). */
export function devShellPolicy(policy: string): string {
  const directives = parsePolicy(policy)
  // 'unsafe-inline' is ignored beside a hash or nonce, so those go in development.
  for (const name of ['script-src', 'style-src']) {
    const sources = (directives.get(name) ?? directives.get('default-src') ?? ["'self'"]).filter((source) => !/^'(sha(256|384|512)|nonce)-/.test(source))
    directives.set(name, [...sources, "'unsafe-inline'"])
  }
  directives.set('connect-src', [...(directives.get('connect-src') ?? directives.get('default-src') ?? ["'self'"]), 'ws://localhost:*', 'ws://127.0.0.1:*'])
  return formatPolicy(directives)
}

/** index.html as the dev server serves it: the same policy, with the dev server's needs added. */
export function withDevShellPolicy(html: string): string {
  return html.replace(SHELL_POLICY_META, (tag: string, policy: string) => tag.replace(policy, devShellPolicy(policy)))
}
