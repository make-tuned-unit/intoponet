/**
 * Link preview from the globe: a headline opens in a card floating over the globe (main's
 * linkPreview.ts), so the globe stays where it was. ⇧-click previews; a plain click opens as before.
 */
export function previewLink(url: string): void {
  void window.intoponet.browserHost.previewLink(url).catch(() => undefined)
}

/** A headline's click: ⇧ previews it, otherwise `open` (the list's own way of opening). */
export function openOrPreview(event: { shiftKey: boolean }, url: string, open: (url: string) => void): void {
  if (event.shiftKey) previewLink(url)
  else open(url)
}
