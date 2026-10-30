import { proxyRegistry } from './_registry-proxy.js'

export const GET = (request) => proxyRegistry(request)
export const POST = (request) => proxyRegistry(request)
