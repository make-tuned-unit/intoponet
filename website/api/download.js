import { waitUntil } from '@vercel/functions'
import { handleDownload } from './_download-notify.js'
import { RELEASE } from './_release.js'

export const GET = (request) => handleDownload(request, { release: RELEASE, waitUntil })
export const HEAD = (request) => handleDownload(request, { release: RELEASE, waitUntil })
