'use strict';

// Only consume observations produced by an authenticated provider adapter.
// These checks bind evidence to an attempt; they do not authenticate arbitrary JSON,
// grant send permission, or prove delivery to a recipient's inbox.
const {createHash} = require('node:crypto');
const VERSION = 'PermitPlate-provider-reconciliation-v1.0.0';
const STATUSES = new Set(['UNKNOWN', 'ACCEPTED', 'REJECTED', 'BOUNCED']);
const EMAIL = /^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/;
const text = value => typeof value === 'string' ? value.trim() : '';
const email = value => text(value).toLowerCase();

function instant(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  if (year < 1970 || month < 1 || month > 12 || day < 1 ||
      day > new Date(Date.UTC(year, month, 0)).getUTCDate() ||
      hour > 23 || minute > 59 || second > 59) return null;
  if (match[7] !== 'Z') {
    const [oh, om] = match[7].slice(1).split(':').map(Number);
    if (oh > 14 || om > 59 || (oh === 14 && om !== 0)) return null;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function attemptErrors(attempt) {
  const a = attempt || {};
  const errors = [];
  if (!['PLANNED', 'PENDING'].includes(a.state)) errors.push('ATTEMPT_NOT_PLANNED');
  if (!text(a.attemptId)) errors.push('ATTEMPT_ID_MISSING');
  if (!text(a.messageIdentity)) errors.push('MESSAGE_IDENTITY_MISSING');
  if (!text(a.planFingerprint)) errors.push('ARTIFACT_FINGERPRINT_MISSING');
  if (!EMAIL.test(email(a.recipient))) errors.push('RECIPIENT_INVALID');
  if (!Array.isArray(a.signalKeys) || a.signalKeys.length === 0 ||
      a.signalKeys.some(key => !text(key) || key !== text(key)) ||
      new Set(a.signalKeys).size !== a.signalKeys.length) errors.push('SIGNAL_KEYS_INVALID');
  return errors;
}

function reconcileProviderEvidence(attempt, observation, deliveredSignalKeys, options = {}) {
  // Never mutate a caller's Set: persistence happens only after the caller commits.
  const delivered = new Set(deliveredSignalKeys || []);
  const base = {
    reconciliationVersion: VERSION, delivered, newlyDelivered: [], newlyAccepted: [],
    retryAllowed: false, deliveryConfirmed: false, providerMessageId: null,
    acceptedAt: null, observedAt: null, providerStatus: 'UNKNOWN'
  };
  const fail = errors => ({...base, state: 'REVIEW', reason: errors[0], failures: errors});
  const errors = attemptErrors(attempt);
  if (errors.length) return fail(errors);
  if (observation === null || observation === undefined) {
    return {...base, state: 'PENDING', reason: 'PROVIDER_NOT_CONFIRMED', failures: []};
  }
  const o = observation;
  if (!o || typeof o !== 'object' || Array.isArray(o) || !STATUSES.has(o.status)) {
    return fail(['PROVIDER_STATUS_INVALID']);
  }
  base.providerStatus = o.status;
  // UNKNOWN is not NOT_SENT and must not release a retry. Provided bindings still
  // must match, even when the provider's ultimate result is unknown.
  const bindings = [
    ['messageIdentity', text(attempt.messageIdentity), text, 'MESSAGE_IDENTITY_MISMATCH'],
    ['attemptId', text(attempt.attemptId), text, 'PROVIDER_ATTEMPT_MISMATCH'],
    ['recipient', email(attempt.recipient), email, 'PROVIDER_RECIPIENT_MISMATCH'],
    ['artifactFingerprint', text(attempt.planFingerprint), text, 'PROVIDER_ARTIFACT_MISMATCH']
  ];
  for (const [field, expected, normalize, reason] of bindings) {
    if ((o.status !== 'UNKNOWN' || o[field] !== undefined) && normalize(o[field]) !== expected) {
      errors.push(reason);
    }
  }
  if (errors.length) return fail(errors);
  if (o.status === 'UNKNOWN') {
    return {...base, state: 'PENDING', reason: 'PROVIDER_NOT_CONFIRMED', failures: []};
  }
  if (!['PROVIDER_READBACK', 'PROVIDER_SEND_RESPONSE'].includes(o.evidenceKind)) {
    errors.push('PROVIDER_EVIDENCE_KIND_MISSING');
  }
  const now = options.now === undefined ? Date.now() : instant(options.now);
  const observed = instant(o.observedAt);
  const occurred = instant(o.status === 'ACCEPTED' ? o.acceptedAt : o.occurredAt);
  if (now === null) errors.push('RECONCILIATION_TIME_INVALID');
  if (observed === null) errors.push('PROVIDER_OBSERVED_AT_INVALID');
  if (occurred === null) errors.push(o.status === 'ACCEPTED' ? 'PROVIDER_ACCEPTED_AT_INVALID' : 'PROVIDER_OCCURRED_AT_INVALID');
  if (now !== null && observed !== null && observed > now) errors.push('PROVIDER_OBSERVATION_FROM_FUTURE');
  if (observed !== null && occurred !== null && occurred > observed) errors.push('PROVIDER_EVENT_AFTER_OBSERVATION');
  const messageId = text(o.providerMessageId);
  if (['ACCEPTED', 'BOUNCED'].includes(o.status) && !messageId) errors.push('PROVIDER_MESSAGE_ID_MISSING');
  if (o.status === 'REJECTED' && !text(o.providerRequestId)) errors.push('PROVIDER_REQUEST_ID_MISSING');
  const prior = options.previousReceipt;
  if (prior) {
    if (text(prior.attemptId) !== text(attempt.attemptId) ||
        text(prior.messageIdentity) !== text(attempt.messageIdentity) ||
        email(prior.recipient) !== email(attempt.recipient)) errors.push('PREVIOUS_RECEIPT_BINDING_MISMATCH');
    if (text(prior.providerMessageId) && messageId && text(prior.providerMessageId) !== messageId) errors.push('PROVIDER_MESSAGE_ID_CHANGED');
    if (prior.status === 'BOUNCED' && o.status === 'ACCEPTED') errors.push('ACCEPTANCE_AFTER_BOUNCE_REVIEW');
  }
  if (errors.length) return fail(errors);
  const receipt = {
    version: VERSION, evidenceKind: o.evidenceKind, status: o.status,
    attemptId: text(attempt.attemptId), messageIdentity: text(attempt.messageIdentity),
    recipient: email(attempt.recipient), artifactFingerprint: text(attempt.planFingerprint),
    providerMessageId: messageId || null, providerRequestId: text(o.providerRequestId) || null,
    occurredAt: new Date(occurred).toISOString(), observedAt: new Date(observed).toISOString()
  };
  receipt.receiptFingerprint = createHash('sha256').update(JSON.stringify(receipt)).digest('hex');
  const bound = {...base, providerMessageId: receipt.providerMessageId, observedAt: receipt.observedAt, receipt, failures: []};
  if (o.status !== 'ACCEPTED') {
    return {...bound, state: 'REJECTED', reason: o.status === 'BOUNCED' ? 'PROVIDER_BOUNCED' : 'PROVIDER_REJECTED'};
  }
  const newlyAccepted = attempt.signalKeys.filter(key => !delivered.has(key));
  for (const key of newlyAccepted) delivered.add(key);
  return {
    ...bound, state: 'FINALIZED', reason: newlyAccepted.length ? 'PROVIDER_ACCEPTED' : 'IDEMPOTENT_REPLAY',
    acceptedAt: receipt.occurredAt, newlyAccepted, newlyDelivered: newlyAccepted.slice()
  };
}

module.exports = {VERSION, instant, attemptErrors, reconcileProviderEvidence};
