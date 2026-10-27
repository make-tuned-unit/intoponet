import { useFavicon } from './favicons'

/** A site's icon (from the on-device cache), or nothing until one is known. */
export function SiteIcon({ url, size = 14 }: { url: string; size?: number }) {
  const icon = useFavicon(url)
  return icon ? <img className="site-icon" src={icon} alt="" width={size} height={size} /> : null
}
