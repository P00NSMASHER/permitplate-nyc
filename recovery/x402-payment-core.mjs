export const X402_NETWORK = 'eip155:8453';
export const X402_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
export const X402_PAY_TO = '0x708f7b52b56eafd7fc1de65fc7752ed732914021';
export const X402_FACILITATOR = 'https://facilitator.payai.network';

const MAX_PAYMENT_HEADER_LENGTH = 16_384;
const FACILITATOR_TIMEOUT_MS = 6_000;
const RESOURCE_METADATA_MAX_LENGTH = 32;
const RESOURCE_TAG_MAX_COUNT = 5;
const PRINTABLE_ASCII = /^[\x20-\x7E]+$/;

export function validateResourceMetadata({ serviceName, tags = [] } = {}) {
  if (serviceName !== undefined) {
    if (
      typeof serviceName !== 'string' ||
      serviceName.length === 0 ||
      serviceName.length > RESOURCE_METADATA_MAX_LENGTH ||
      !PRINTABLE_ASCII.test(serviceName)
    ) {
      throw new Error('invalid_service_name');
    }
  }

  if (!Array.isArray(tags)) throw new Error('invalid_resource_tags');
  if (tags.length > RESOURCE_TAG_MAX_COUNT) throw new Error('too_many_resource_tags');
  for (const tag of tags) {
    if (
      typeof tag !== 'string' ||
      tag.length === 0 ||
      tag.length > RESOURCE_METADATA_MAX_LENGTH ||
      !PRINTABLE_ASCII.test(tag)
    ) {
      throw new Error('invalid_resource_tag');
    }
  }

  return { serviceName, tags: [...tags] };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, init, timeoutMs = FACILITATOR_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function paymentRequirements(amount) {
  const value = String(amount);
  if (!/^\d+$/.test(value) || value === '0') {
    throw new Error('invalid_payment_amount');
  }
  return {
    scheme: 'exact',
    network: X402_NETWORK,
    amount: value,
    asset: X402_USDC,
    payTo: X402_PAY_TO,
    maxTimeoutSeconds: 60,
    extra: { name: 'USD Coin', version: '2' },
  };
}

export function encodeX402Header(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}

export function decodePaymentHeader(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('invalid_payment_header');
  }
  if (value.length > MAX_PAYMENT_HEADER_LENGTH) {
    throw new Error('payment_header_too_large');
  }

  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const parsed = JSON.parse(Buffer.from(normalized, 'base64').toString('utf8'));
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      parsed.x402Version !== 2
    ) {
      throw new Error('invalid_payment_payload');
    }
    return parsed;
  } catch (error) {
    if (
      error instanceof Error &&
      ['payment_header_too_large', 'invalid_payment_payload'].includes(error.message)
    ) {
      throw error;
    }
    throw new Error('invalid_payment_header');
  }
}

export function buildPaymentDocument({
  origin,
  path,
  amount,
  description,
  serviceName,
  tags = [],
  mimeType = 'application/json',
  extensions,
}) {
  if (!origin || !path || !description) throw new Error('invalid_payment_document');
  const metadata = validateResourceMetadata({ serviceName, tags });
  const resourceUrl = new URL(path, origin).toString();
  const resource = {
    url: resourceUrl,
    description,
    mimeType,
  };
  if (metadata.serviceName) resource.serviceName = metadata.serviceName;
  if (metadata.tags.length) resource.tags = metadata.tags;

  const doc = {
    x402Version: 2,
    resource,
    accepts: [paymentRequirements(amount)],
  };
  if (extensions) doc.extensions = extensions;
  return doc;
}

export function buildChallenge({
  origin,
  path,
  amount,
  price,
  description,
  serviceName,
  tags,
  extensions,
  reason = 'payment_required',
}) {
  const document = buildPaymentDocument({
    origin,
    path,
    amount,
    description,
    serviceName,
    tags,
    extensions,
  });
  return {
    status: 402,
    body: {
      error: reason,
      ...document,
      price,
      currency: 'USDC',
      network: X402_NETWORK,
      payTo: X402_PAY_TO,
    },
    headers: {
      'PAYMENT-REQUIRED': encodeX402Header(document),
      'x402-price': price,
      'x402-asset': 'USDC',
      'x402-network': X402_NETWORK,
      'x402-pay-to': X402_PAY_TO,
      'cache-control': 'no-store',
    },
    document,
  };
}

async function facilitatorPost(path, paymentPayload, requirements) {
  const response = await fetchWithTimeout(X402_FACILITATOR + '/' + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      x402Version: 2,
      paymentPayload,
      paymentRequirements: requirements,
    }),
  });

  let body = null;
  try {
    const parsed = await response.json();
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      body = parsed;
    }
  } catch {
    body = null;
  }

  return { status: response.status, body };
}

export async function verifyPayment(paymentPayload, requirements) {
  let result;
  try {
    result = await facilitatorPost('verify', paymentPayload, requirements);
  } catch {
    return { kind: 'unavailable', reason: 'payment_verifier_unavailable' };
  }

  if (result.body?.isValid === true) {
    return { kind: 'valid', body: result.body };
  }

  if (result.body?.isValid === false) {
    return {
      kind: 'invalid',
      reason: String(
        result.body.invalidReason ??
          result.body.errorReason ??
          'payment_verification_failed'
      ),
      body: result.body,
    };
  }

  return { kind: 'unavailable', reason: 'payment_verifier_unavailable', body: result.body };
}

export async function settleSamePayment(paymentPayload, requirements) {
  const waits = [0, 250, 750];

  for (let attempt = 0; attempt < waits.length; attempt += 1) {
    if (waits[attempt] > 0) await sleep(waits[attempt]);

    let result;
    try {
      result = await facilitatorPost('settle', paymentPayload, requirements);
    } catch {
      if (attempt === waits.length - 1) {
        return { kind: 'unresolved', reason: 'settlement_transport_unknown' };
      }
      continue;
    }

    if (result.body?.success === true) {
      return { kind: 'settled', receipt: result.body };
    }

    const reason =
      typeof result.body?.errorReason === 'string'
        ? result.body.errorReason
        : result.status === 429
          ? 'rate_limited'
          : result.status >= 500
            ? 'facilitator_unavailable'
            : 'payment_settlement_failed';

    if (
      ['settlement_pending', 'duplicate_settlement', 'rate_limited', 'facilitator_unavailable'].includes(
        reason
      )
    ) {
      if (attempt === waits.length - 1) {
        return { kind: 'unresolved', reason };
      }
      continue;
    }

    return { kind: 'terminal', reason };
  }

  return { kind: 'unresolved', reason: 'settlement_unknown' };
}

export function successReceiptHeaders(receipt) {
  return {
    'PAYMENT-RESPONSE': encodeX402Header(receipt),
    'x402-settled': 'true',
  };
}

export function temporaryPaymentFailure(reason) {
  return {
    status: 503,
    body: {
      error: reason,
      paymentState: 'unresolved',
      retrySamePayment: true,
    },
    headers: {
      'Retry-After': '2',
      'cache-control': 'no-store',
    },
  };
}
