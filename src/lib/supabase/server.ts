import http from 'node:http'
import https from 'node:https'

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
export const hasSupabaseServiceRoleKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)
const supabaseServerKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

function headersToRecord(headers: HeadersInit | undefined) {
  const record: Record<string, string> = {}
  if (!headers) return record
  new Headers(headers).forEach((value, key) => {
    record[key] = value
  })
  return record
}

function responseHeadersToRecord(headers: http.IncomingHttpHeaders) {
  const record: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) record[key] = value.join(', ')
    else if (typeof value === 'string') record[key] = value
  }
  return record
}

function writeRequestBody(req: http.ClientRequest, body: BodyInit | null | undefined) {
  if (body === undefined || body === null) return
  if (typeof body === 'string') {
    req.write(body)
  } else if (body instanceof URLSearchParams) {
    req.write(body.toString())
  } else if (body instanceof ArrayBuffer) {
    req.write(Buffer.from(body))
  } else if (ArrayBuffer.isView(body)) {
    req.write(Buffer.from(body.buffer, body.byteOffset, body.byteLength))
  } else {
    throw new Error('Unsupported Supabase request body')
  }
}

const serverFetch: typeof fetch = async (input, init = {}) => {
  const request = input instanceof Request ? input : null
  const url = new URL(request?.url ?? String(input))
  const method = init.method ?? request?.method ?? 'GET'
  const headers = {
    ...headersToRecord(request?.headers),
    ...headersToRecord(init.headers),
  }
  const body = init.body ?? null
  const transport = url.protocol === 'http:' ? http : https

  return new Promise<Response>((resolve, reject) => {
    const req = transport.request(url, {
      method,
      headers,
      timeout: 20_000,
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      })
      res.on('end', () => {
        const status = res.statusCode ?? 500
        const responseBody = status === 204 || status === 304 ? null : Buffer.concat(chunks)
        resolve(new Response(responseBody, {
          status,
          statusText: res.statusMessage,
          headers: responseHeadersToRecord(res.headers),
        }))
      })
    })

    req.on('timeout', () => {
      req.destroy(new Error('Supabase request timed out'))
    })
    req.on('error', reject)

    try {
      writeRequestBody(req, body)
      req.end()
    } catch (error) {
      req.destroy()
      reject(error)
    }
  })
}

export const supabase = createClient(supabaseUrl, supabaseServerKey, {
  global: {
    fetch: serverFetch,
  },
})

export type SupabaseServerClient = typeof supabase

export function createSupabaseServerClient(headers?: Record<string, string>) {
  return createClient(supabaseUrl, supabaseServerKey, {
    global: {
      fetch: serverFetch,
      headers,
    },
  })
}
