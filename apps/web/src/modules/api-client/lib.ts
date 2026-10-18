/** The colour of a status code: green for 2xx, blue for 3xx, amber for 4xx, red for 5xx. */
export const statusTone = (status: number) => (status < 300 ? 'text-ok' : status < 400 ? 'text-t-number' : status < 500 ? 'text-warn' : 'text-danger')

/** Header names the Headers tab suggests. */
export const COMMON_HEADERS = [
  'Accept',
  'Accept-Language',
  'Authorization',
  'Cache-Control',
  'Content-Type',
  'Cookie',
  'If-Match',
  'If-None-Match',
  'Idempotency-Key',
  'Origin',
  'User-Agent',
  'X-API-Key',
  'X-Request-Id',
]
