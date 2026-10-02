import {
  paymentRequirements,
  decodePaymentHeader,
  buildChallenge,
  verifyPayment,
  settleSamePayment,
  successReceiptHeaders,
  temporaryPaymentFailure,
} from './x402-payment-core.mjs';

function errorResponse(status, error, extra = {}) {
  return {
    status,
    body: { error, ...extra },
    headers: { 'cache-control': 'no-store' },
  };
}

export async function executePaidOperation({
  signature,
  origin,
  path,
  amount,
  price,
  description,
  serviceName,
  tags = [],
  extensions,
  validateInput,
  execute,
  upstreamFailureMessage = 'Required upstream data is temporarily unavailable; payment was not settled.',
  verify = verifyPayment,
  settle = settleSamePayment,
}) {
  const challenge = (reason = 'payment_required') =>
    buildChallenge({
      origin,
      path,
      amount,
      price,
      description,
      serviceName,
      tags,
      extensions,
      reason,
    });

  if (!signature) return challenge();

  let paymentPayload;
  try {
    paymentPayload = decodePaymentHeader(signature);
  } catch (error) {
    const reason =
      error instanceof Error &&
      ['payment_header_too_large', 'invalid_payment_payload'].includes(error.message)
        ? error.message
        : 'invalid_payment_header';
    return challenge(reason);
  }

  let input;
  try {
    input = await validateInput();
  } catch (error) {
    return errorResponse(
      400,
      error instanceof Error ? error.message : 'invalid_input'
    );
  }

  const requirements = paymentRequirements(amount);
  const verification = await verify(paymentPayload, requirements);

  if (verification?.kind === 'invalid') {
    return challenge(verification.reason ?? 'payment_verification_failed');
  }
  if (verification?.kind !== 'valid') {
    return temporaryPaymentFailure(
      verification?.reason ?? 'payment_verifier_unavailable'
    );
  }

  let result;
  try {
    result = await execute(input);
  } catch {
    return errorResponse(502, upstreamFailureMessage, {
      paymentSettled: false,
    });
  }

  const settlement = await settle(paymentPayload, requirements);
  if (settlement?.kind === 'unresolved') {
    return temporaryPaymentFailure(settlement.reason ?? 'settlement_unknown');
  }
  if (settlement?.kind !== 'settled') {
    return challenge(settlement?.reason ?? 'payment_settlement_failed');
  }

  return {
    status: 200,
    body: {
      ...result,
      paid: true,
      price,
    },
    headers: {
      ...successReceiptHeaders(settlement.receipt),
      'cache-control': 'no-store',
    },
  };
}
