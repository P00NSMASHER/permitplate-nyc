import {
  decodePayment,
  demoInput,
  encodeHeader,
  paymentConstants,
  runVendorIntakeGate,
  settleSamePayment,
  validateVendorInput,
  vendorPaymentDocument,
  verifyPayment,
} from '../../lib/vendor-core.mjs';

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

function paymentRequired(reason = 'payment_required') {
  const doc = vendorPaymentDocument();
  return json(
    {
      error: reason,
      ...doc,
      price: paymentConstants.VENDOR_GATE_PRICE,
      currency: 'USDC',
      network: paymentConstants.NETWORK,
      payTo: paymentConstants.PAY_TO,
    },
    402,
    {
      'PAYMENT-REQUIRED': encodeHeader(doc),
      'x402-price': paymentConstants.VENDOR_GATE_PRICE,
      'x402-asset': 'USDC',
      'x402-network': paymentConstants.NETWORK,
      'x402-pay-to': paymentConstants.PAY_TO,
    }
  );
}

function temporaryPaymentFailure(reason: string) {
  return json(
    {
      error: reason,
      paymentState: 'unresolved',
      retrySamePayment: true,
    },
    503,
    { 'retry-after': '2' }
  );
}

export default async (req: Request) => {
  const url = new URL(req.url);

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  if (url.pathname === '/api/health') {
    return json({
      ok: true,
      service: 'Pennsylvania Vendor Intake Decision Gate',
      host: 'Netlify recovery origin',
      price: paymentConstants.VENDOR_GATE_PRICE,
      network: paymentConstants.NETWORK,
    });
  }

  if (url.pathname === '/api/vendor-intake-demo') {
    const sampleCase = url.searchParams.get('case') ?? 'proceed';
    try {
      const result = await runVendorIntakeGate(demoInput(sampleCase));
      return json({
        ...result,
        demo: true,
        paid: false,
        sampleInput: true,
        sampleCase,
      });
    } catch (error) {
      return json(
        {
          error: 'vendor_intake_demo_unavailable',
          detail: error instanceof Error ? error.message : String(error),
        },
        502
      );
    }
  }

  if (url.pathname !== '/api/vendor-intake-gate') {
    return json({ error: 'not_found' }, 404);
  }

  const signature =
    req.headers.get('payment-signature') ?? req.headers.get('x-payment');
  if (!signature) return paymentRequired();

  let paymentPayload;
  try {
    paymentPayload = decodePayment(signature);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid_payment_header';
    return paymentRequired(
      message === 'payment_header_too_large' ||
        message === 'invalid_payment_payload'
        ? message
        : 'invalid_payment_header'
    );
  }

  let input;
  try {
    input = validateVendorInput(url.searchParams);
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'invalid_input' },
      400
    );
  }

  let verification;
  try {
    verification = await verifyPayment(paymentPayload);
  } catch {
    return temporaryPaymentFailure('payment_verifier_unavailable');
  }

  if (verification.body?.isValid !== true) {
    if (verification.body?.isValid === false) {
      return paymentRequired(
        String(
          verification.body.invalidReason ??
            verification.body.errorReason ??
            'payment_verification_failed'
        )
      );
    }
    return temporaryPaymentFailure('payment_verifier_unavailable');
  }

  let result;
  try {
    result = await runVendorIntakeGate(input);
  } catch (error) {
    return json(
      {
        error: 'vendor_intake_evidence_unavailable',
        paymentSettled: false,
        detail: error instanceof Error ? error.message : String(error),
      },
      502
    );
  }

  const settlement = await settleSamePayment(paymentPayload);
  if (settlement.kind === 'unresolved') {
    return temporaryPaymentFailure(settlement.reason);
  }
  if (settlement.kind === 'terminal') {
    return paymentRequired(settlement.reason);
  }

  return json(
    {
      ...result,
      paid: true,
      price: paymentConstants.VENDOR_GATE_PRICE,
    },
    200,
    {
      'PAYMENT-RESPONSE': encodeHeader(settlement.receipt),
      'x402-settled': 'true',
    }
  );
};

export const config = {
  path: [
    '/api/health',
    '/api/vendor-intake-demo',
    '/api/vendor-intake-gate',
  ],
};
