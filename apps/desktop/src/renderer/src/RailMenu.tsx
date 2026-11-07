import { useEffect, useRef } from 'react'

/** A small menu in the tab sidebar (↑ ↓ to move, Enter to choose, Escape to close): a folder's, a workspace's, a favourite's. */
export function RailMenu({ items, onClose, label }: { items: Array<{ label: string; run: () => void }>; onClose: () => void; label?: string }) {
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
    return () => opener?.focus?.()
  }, [])
  return (
    <div
      ref={root}
      className="tab-rail-folder-menu"
      role="menu"
      {...(label ? { 'aria-label': label } : {})}
      onKeyDown={(event) => {
        const entries = [...(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
        const at = entries.indexOf(document.activeElement as HTMLButtonElement)
        if (event.key === 'ArrowDown') entries[(at + 1) % entries.length]?.focus()
        else if (event.key === 'ArrowUp') entries[(at - 1 + entries.length) % entries.length]?.focus()
        else if (event.key === 'Escape') onClose()
        else return
        event.preventDefault()
        event.stopPropagation()
      }}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onClose() }}
    >
      {items.map((item) => (
        <button key={item.label} type="button" role="menuitem" tabIndex={-1} onClick={() => { onClose(); item.run() }}>{item.label}</button>
      ))}
    </div>
  )
}
