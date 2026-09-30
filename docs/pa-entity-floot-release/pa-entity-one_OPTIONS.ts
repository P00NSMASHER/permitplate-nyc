const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers':
    'PAYMENT-SIGNATURE, X-PAYMENT, Content-Type, Accept',
  'access-control-expose-headers':
    'PAYMENT-REQUIRED, PAYMENT-RESPONSE, x402-settled, Retry-After',
  'access-control-max-age': '86400',
}

export async function handle() {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  })
}
