import { runVendorGate } from './vendor-intake-gate_GET'

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'Content-Type, Accept',
}

function flootJson(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {}
) {
  const headers: Record<string, string> = {
    ...CORS_HEADERS,
    'content-type': 'application/json',
    'cache-control': 'no-store',
    ...extraHeaders,
  }
  if (status !== 200) headers['x-floot-status'] = String(status)

  return new Response(JSON.stringify(body), {
    status: 200,
    headers,
  })
}

type DemoCase = 'proceed' | 'address_mismatch' | 'domain_mismatch'

function demoInput(sampleCase: DemoCase) {
  if (sampleCase === 'address_mismatch') {
    return {
      name: 'OpenAI OpCo',
      address: '4600 Silver Hill Rd, Washington, DC 20233',
      domain: 'openai.com',
    }
  }

  if (sampleCase === 'domain_mismatch') {
    return {
      name: 'OpenAI OpCo',
      address: '600 North Second Street, Suite 401, Harrisburg, PA 17101',
      domain: 'example.com',
    }
  }

  return {
    name: 'OpenAI OpCo',
    address: '600 North Second Street, Suite 401, Harrisburg, PA 17101',
    domain: 'openai.com',
  }
}

export async function handle(request: Request) {
  const url = new URL(request.url)
  const rawCase = url.searchParams.get('case') ?? 'proceed'
  if (
    rawCase !== 'proceed' &&
    rawCase !== 'address_mismatch' &&
    rawCase !== 'domain_mismatch'
  ) {
    return flootJson(
      {
        error: 'unknown_fixture',
        allowedCases: ['proceed', 'address_mismatch', 'domain_mismatch'],
      },
      400
    )
  }

  const sampleCase = rawCase as DemoCase
  try {
    const input = demoInput(sampleCase)
    const result = await runVendorGate(input)
    return flootJson({
      ...result,
      demo: true,
      paid: false,
      sampleInput: true,
      case: sampleCase,
      fixturePolicy:
        'Fixed reviewer fixture only. Arbitrary vendor checks require the paid /_api/vendor-intake-gate endpoint.',
    })
  } catch {
    return flootJson(
      {
        error: 'vendor_gate_fixture_unavailable',
        detail:
          'A required public evidence source was unavailable while evaluating this fixed reviewer fixture.',
      },
      502
    )
  }
}
