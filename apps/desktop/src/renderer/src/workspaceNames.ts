import { useEffect, useState } from 'react'

/** Workspace names by id, so a history visit or a saved sign-in can say which workspace it belongs to. */
export function useWorkspaceNames(): Record<string, string> {
  const [names, setNames] = useState<Record<string, string>>({})
  useEffect(() => {
    let live = true
    void window.intoponet.workspaces.get().then((state) => {
      if (live) setNames(Object.fromEntries(state.workspaces.map((workspace) => [workspace.id, workspace.name])))
    }, () => undefined)
    return () => { live = false }
  }, [])
  return names
}
