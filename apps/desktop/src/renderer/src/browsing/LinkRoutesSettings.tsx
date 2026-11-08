import { useEffect, useRef, useState } from 'react'
import type { LinkRoutesState } from '@intoponet/browser-api'

const SITE_HINT = 'That is not a site. Use a host such as docs.example.com (it also matches the sites under it).'

/** Settings › Browsing: links from other apps go to a workspace by site. The first rule that matches wins. */
export function LinkRoutesSettings() {
  const [state, setState] = useState<LinkRoutesState | null>(null)
  const [error, setError] = useState('')
  const [newSite, setNewSite] = useState('')
  const [newWorkspace, setNewWorkspace] = useState('')
  const list = useRef<HTMLDivElement>(null)
  /**
   * Where focus goes once the list shows a change made from the keyboard: a moved rule keeps it (on the other
   * move button at either end), a removed rule passes it to the rule in its place (or the new rule's site).
   */
  const refocus = useRef<{ act: 'up' | 'down' | 'remove' | 'add'; ruleId: string; index: number } | null>(null)
  useEffect(() => {
    const want = refocus.current
    if (!want || !state) return
    refocus.current = null
    const button = (ruleId: string | undefined, act: string): HTMLButtonElement | null =>
      ruleId ? list.current?.querySelector<HTMLButtonElement>(`button[data-rule="${CSS.escape(ruleId)}"][data-act="${act}"]:not(:disabled)`) ?? null : null
    const site = list.current?.querySelector<HTMLInputElement>('#link-route-new-site')
    if (want.act === 'up' || want.act === 'down') {
      ;(button(want.ruleId, want.act) ?? button(want.ruleId, want.act === 'up' ? 'down' : 'up'))?.focus()
    } else if (want.act === 'remove') {
      const next = state.rules[want.index] ?? state.rules[want.index - 1]
      ;(button(next?.id, 'remove') ?? site)?.focus()
    } else site?.focus()
  }, [state])

  useEffect(() => {
    let mounted = true
    void window.intoponet.browsing.linkRoutes().then((next) => { if (mounted) setState(next) }, () => undefined)
    const unsubscribe = window.intoponet.browsing.subscribe((event) => { if (event.type === 'link-routes' && mounted) setState(event.state) })
    return () => { mounted = false; unsubscribe() }
  }, [])

  const run = (change: () => Promise<LinkRoutesState>, message: string, after?: { act: 'up' | 'down' | 'remove' | 'add'; ruleId: string; index: number }): void => {
    setError('')
    void change().then((next) => {
      // Only when focus was on what changed: a change from elsewhere leaves focus where it is.
      if (after && (list.current?.contains(document.activeElement) || document.activeElement === document.body)) refocus.current = after
      setState(next)
    }, () => setError(message))
  }

  const workspaces = state?.workspaces ?? []
  const addWorkspace = newWorkspace || workspaces[0]?.id || ''
  const full = (state?.rules.length ?? 0) >= 100

  return (
    <div ref={list} className="link-routes" aria-labelledby="link-routes-label">
      <p id="link-routes-label">Links from other apps go to: a link whose site matches a rule opens in that workspace, as a tab, whichever way other links open. Routing goes by site: macOS does not say which app opened a link. The first rule that matches wins; a link that matches none follows the setting above. Rules are kept only on this Mac.</p>
      {state && state.rules.length === 0 && <p className="link-routes-empty">No rules yet.</p>}
      {state && state.rules.length > 0 && (
        <ol className="link-routes-list">
          {state.rules.map((rule, index) => (
            <li key={rule.id} className="link-route">
              <input
                key={`${rule.id}:${rule.site}`}
                className="link-route-site"
                aria-label={`Site for rule ${index + 1}`}
                defaultValue={rule.site}
                spellCheck={false}
                onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
                onBlur={(event) => {
                  const site = event.currentTarget.value.trim()
                  if (site === rule.site) return
                  run(() => window.intoponet.browsing.updateLinkRoute(rule.id, { site }), SITE_HINT)
                }}
              />
              {rule.workspaceName === null ? (
                <span className="link-route-deleted">Workspace deleted</span>
              ) : (
                <select
                  aria-label={`Workspace for rule ${index + 1}`}
                  value={rule.workspaceId}
                  onChange={(event) => run(() => window.intoponet.browsing.updateLinkRoute(rule.id, { workspaceId: event.currentTarget.value }), 'That workspace is gone.')}
                >
                  {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
                </select>
              )}
              <button type="button" data-rule={rule.id} data-act="up" aria-label={`Move rule ${index + 1} up`} disabled={index === 0} onClick={() => run(() => window.intoponet.browsing.moveLinkRoute(rule.id, index - 1), 'That rule is gone.', { act: 'up', ruleId: rule.id, index })}>Up</button>
              <button type="button" data-rule={rule.id} data-act="down" aria-label={`Move rule ${index + 1} down`} disabled={index === state.rules.length - 1} onClick={() => run(() => window.intoponet.browsing.moveLinkRoute(rule.id, index + 1), 'That rule is gone.', { act: 'down', ruleId: rule.id, index })}>Down</button>
              <button type="button" data-rule={rule.id} data-act="remove" aria-label={`Remove rule ${index + 1}`} onClick={() => run(() => window.intoponet.browsing.removeLinkRoute(rule.id), 'That rule is gone.', { act: 'remove', ruleId: rule.id, index })}>Remove</button>
            </li>
          ))}
        </ol>
      )}
      {state && workspaces.length > 0 && (
        <form
          className="link-route link-route-add"
          onSubmit={(event) => {
            event.preventDefault()
            const site = newSite.trim()
            if (!site || !addWorkspace) return
            run(() => window.intoponet.browsing.addLinkRoute(site, addWorkspace).then((next) => { setNewSite(''); return next }), SITE_HINT, { act: 'add', ruleId: '', index: 0 })
          }}
        >
          <label className="link-route-label" htmlFor="link-route-new-site">New rule: site</label>
          <input id="link-route-new-site" className="link-route-site" value={newSite} placeholder="docs.example.com" spellCheck={false} onChange={(event) => setNewSite(event.currentTarget.value)} />
          <label className="link-route-label" htmlFor="link-route-new-workspace">Workspace</label>
          <select id="link-route-new-workspace" value={addWorkspace} onChange={(event) => setNewWorkspace(event.currentTarget.value)}>
            {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
          </select>
          <button type="submit" disabled={!newSite.trim() || full}>Add rule</button>
        </form>
      )}
      {full && <p className="link-routes-empty">At most 100 rules. Remove one to add another.</p>}
      {error && <p className="settings-error" role="alert">{error}</p>}
    </div>
  )
}
