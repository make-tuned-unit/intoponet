import { waitUntil } from '@vercel/functions'
import { handleIdea } from './_ideas.js'

export const POST = (request) => handleIdea(request, { waitUntil })
