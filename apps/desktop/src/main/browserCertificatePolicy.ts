/** Deny TLS certificate errors for the target browsing session, leaving other sessions untouched. */
export function rejectCertificateErrorForSession(
  event: { preventDefault: () => void },
  webContents: { session: unknown },
  browsingSession: unknown,
  callback: (allow: boolean) => void,
): boolean {
  if (webContents.session !== browsingSession) return false
  event.preventDefault()
  callback(false)
  return true
}
