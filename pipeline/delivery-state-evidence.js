'use strict';

const {instant, attemptErrors, reconcileProviderEvidence} = require('./provider-reconciliation');
const {validateTransportAuthorization} = require('./transport-authorization');
const text = value => typeof value === 'string' ? value.trim() : '';

function resolveDeliveryStateEvidence(data) {
  const errors = attemptErrors(data.attempt);
  if (errors.length) throw new Error(errors.join('|'));
  const requested = data.deliveryStatus;
  if (requested !== undefined && !['PLANNED','PENDING','FINALIZED','REJECTED','REVIEW'].includes(requested)) {
    throw new Error('DELIVERY_STATUS_INVALID');
  }
  const absent = data.providerObservation === undefined || data.providerObservation === null;
  if (absent) {
    if (requested && requested !== 'PLANNED') throw new Error('DELIVERY_STATUS_EVIDENCE_CONFLICT');
    if (data.deliveredAt || data.gmailMessageId || data.transportStartedAt) {
      throw new Error('TRANSPORT_EVIDENCE_MISSING');
    }
    return {
      deliveryStatus:'PLANNED', providerStatus:'NOT_SENT', deliveredAt:'',
      providerMessageId:'', reconciledAt:'', authorizationId:'',
      retryAllowed:false, deliveryConfirmed:false, receipt:null
    };
  }

  const now = data.reconciledAt || data.now || new Date().toISOString();
  const reconciled = instant(now);
  const started = instant(data.transportStartedAt);
  if (reconciled === null) throw new Error('RECONCILIATION_TIME_INVALID');
  if (started === null) throw new Error('TRANSPORT_STARTED_AT_REQUIRED');
  if (started > reconciled) throw new Error('TRANSPORT_STARTED_IN_FUTURE');
  if (!data.message || data.message.status !== 'READY' || !text(data.message.messageFingerprint)) {
    throw new Error('READY_MESSAGE_REQUIRED_FOR_RECONCILIATION');
  }
  if (!data.transportAuthorization) throw new Error('TRANSPORT_AUTHORIZATION_REQUIRED');

  const authorization = validateTransportAuthorization({
    artifact:data.artifact, message:data.message, attempt:data.attempt,
    authorization:data.transportAuthorization, now:data.transportStartedAt
  });
  if (!authorization.allowed) throw new Error('TRANSPORT_AUTHORIZATION_INVALID:' + authorization.failures.join('|'));
  const result = reconcileProviderEvidence(data.attempt, data.providerObservation, data.deliveredSignalKeys || [], {
    now, previousReceipt:data.previousProviderReceipt
  });
  if (result.state === 'REVIEW') throw new Error('PROVIDER_EVIDENCE_INVALID:' + result.failures.join('|'));
  if (result.receipt && instant(result.receipt.occurredAt) < started) {
    throw new Error('PROVIDER_EVENT_BEFORE_TRANSPORT');
  }
  if (requested && requested !== result.state) throw new Error('DELIVERY_STATUS_EVIDENCE_CONFLICT');
  const deliveredAt = result.state === 'FINALIZED' ? result.acceptedAt : '';
  if (data.deliveredAt && instant(data.deliveredAt) !== instant(deliveredAt)) {
    throw new Error('DELIVERED_AT_EVIDENCE_CONFLICT');
  }
  if (data.gmailMessageId && text(data.gmailMessageId) !== result.providerMessageId) {
    throw new Error('PROVIDER_MESSAGE_ID_EVIDENCE_CONFLICT');
  }
  return {
    deliveryStatus:result.state, providerStatus:result.providerStatus, deliveredAt,
    providerMessageId:result.providerMessageId || '', reconciledAt:new Date(reconciled).toISOString(),
    authorizationId:authorization.authorizationId, retryAllowed:false,
    deliveryConfirmed:false, receipt:result.receipt || null
  };
}

module.exports = {resolveDeliveryStateEvidence};
