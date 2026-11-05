import { waitUntil } from '@vercel/functions'
import { handleFeedback } from './_feedback.js'

export const POST = (request) => handleFeedback(request, { waitUntil })
