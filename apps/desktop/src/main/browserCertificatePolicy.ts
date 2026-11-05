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

export const CLIENT_CERTIFICATE_NOTICE = 'This site asked for a certificate to identify you. Intoponet does not send certificates yet, so none was sent.'

/**
 * A site asked for a TLS client certificate. Electron's default picks the first one in the
 * Keychain and sends it, identifying you to any site that asks (also from private tabs). Until
 * there is a picker, none is ever sent: the default is prevented and the request continues
 * without one.
 */
export function declineClientCertificate(event: { preventDefault: () => void }, callback: () => void): void {
  event.preventDefault()
  callback()
}
