'use strict';

// Real paid product: source-bound founder-curated customer brief preparation.
// No model scores, customer email delivery, or payment mutations occur here.
const crypto = require('crypto');
const stripe = require('./stripe-subscriber');
const profiles = require('./subscriber-profile');
const curated = require('./founder-curated-offer');
const research = require('./curated-research-ledger');
const delivery = require('./delivery-plan');
const transport = require('./transport-authorization');

const VERSION = 'PermitPlate-curated-customer-brief-v1.0.0';
const EXPECTED_PRICE_ID = 'price_1UFjcWDPW8riWrxQhnrPX6nc';
const MAX_SOURCE_AGE_MS = 24 * 60 * 60 * 1000;
const STARTER_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function digest(data) {
  return crypto.createHash('sha256').update(research.stable(data)).digest('hex');
}
function candidateIdentity(candidate) {
  const c = candidate || {};
  return digest({
    entityId:c.entityId || null,
    canonicalName:c.canonicalName || null,
    address:c.address || null,
    borough:c.borough || null,
    lifecycleStage:c.lifecycleStage || null,
    sourceLatestEffectiveAt:c.sourceLatestEffectiveAt || null,
    deliverySuppressed:c.deliverySuppressed === true,
    crossCamisOperationalConflicts:c.crossCamisOperationalConflicts || []
  });
}
function primaryUrl(candidate) {
  const camis = String(candidate && candidate.camis || '');
  if (!/^[0-9]+$/.test(camis)) throw new Error('CAMIS_REQUIRED');
  return 'https://data.cityofnewyork.us/resource/43nn-pn8j.json?camis=' +
    encodeURIComponent(camis);
}
function section(firstObservedAt, baselineAt, starterEnabled, initializedAt) {
  const event = Date.parse(firstObservedAt);
  const baseline = Date.parse(baselineAt);
  const initialization = Date.parse(initializedAt);
  if (!Number.isFinite(event) || !Number.isFinite(baseline) ||
      !Number.isFinite(initialization)) return null;
  // Monitoring initialization is not evidence that an existing restaurant is
  // a newly filed application. Keep the founding baseline out of all reports.
  if (event <= initialization) return null;
  if (event >= baseline) return 'NORMAL';
  if (starterEnabled && event >= baseline - STARTER_WINDOW_MS) return 'STARTER';
  return null;
}
function signalKey(subscriptionId, entry) {
  return 'curated:' + digest({
    subscriptionId,entityId:entry.entityId,firstObservedAt:entry.firstObservedAt
  }).slice(0,32);
}
function reject(failures, extra = {}) {
  return {
    runnerVersion:VERSION,
    status:'REVIEW',
    failures:[...new Set(failures)].sort(),
    transportAllowed:false,
    ...extra
  };
}
function prepare(input) {
  const data = input || {};
  const preparedAt = research.instant(data.preparedAt);
  if (!preparedAt) return reject(['PREPARED_AT_INVALID']);

  const activated = stripe.profileFromCheckout({
    session:data.session,
    subscription:data.subscription,
    expectedPriceId:EXPECTED_PRICE_ID
  });
  if (activated.status !== 'ACTIVE') {
    return reject(['CUSTOMER_NOT_ACTIVE',...(activated.failures || [])]);
  }
  const customer = activated.profile;
  const graph = data.graph || {};
  const graphCheck = research.checkGraph(graph);
  const ledgerCheck = research.validate(data.ledger);
  const failures = [...graphCheck.failures,...ledgerCheck.failures];

  if (graph.graphDigest !== (data.ledger && data.ledger.graphDigest) ||
      graph.observedAt !== (data.ledger && data.ledger.observedAt)) {
    failures.push('CURATED_LEDGER_GRAPH_MISMATCH');
  }
  const sourceAge = Date.parse(preparedAt) - Date.parse(graph.observedAt);
  if (!Number.isFinite(sourceAge) || sourceAge < 0 || sourceAge > MAX_SOURCE_AGE_MS) {
    failures.push('CURATED_SOURCE_SNAPSHOT_STALE');
  }
  if (Date.parse(preparedAt) < Date.parse(customer.baselineAt)) {
    failures.push('CURATED_REPORT_BEFORE_SUBSCRIPTION');
  }
  if (failures.length) return reject(failures);

  // Stripe is the sole authority for recipient, category, territory, starter
  // choice and subscription-created baseline. The review cannot override them.
  const category = stripe.customFieldValue(data.session,'category');
  const territory = stripe.customFieldValue(data.session,'territory');
  const starter = stripe.customFieldValue(data.session,'starter');
  const prefs = {category,territory,starter};
  const reviewedItems = Array.isArray(data.reviews) ? data.reviews : null;
  if (!reviewedItems) return reject(['CURATED_REVIEWS_ARRAY_REQUIRED']);
  if (reviewedItems.length > curated.MAX_SIGNALS) {
    return reject(['CURATED_REVIEW_LIMIT_EXCEEDED']);
  }
  if (!String(data.reviewer || '').trim() || data.ownerReviewed !== true) {
    return reject(['CURATED_OWNER_REVIEW_REQUIRED']);
  }

  const candidateIndex = new Map(graph.candidates.map(item => [item.entityId,item]));
  const seenReviews = new Set();
  const delivered = Array.isArray(data.deliveredSignalKeys) ?
    new Set(data.deliveredSignalKeys.map(String)) : null;
  if (!delivered) return reject(['CURATED_DELIVERED_KEYS_ARRAY_REQUIRED']);
  const selected = [];
  const excluded = [];

  for (const review of reviewedItems) {
    const id = String(review && review.entityId || '');
    const prefix = 'REVIEW:' + id + ':';
    if (!id || seenReviews.has(id)) {
      failures.push('CURATED_DUPLICATE_OR_MISSING_REVIEW_ID');
      continue;
    }
    seenReviews.add(id);
    const candidate = candidateIndex.get(id);
    const entry = data.ledger.entries[id];
    if (!candidate || !entry || entry.presenceState !== 'PRESENT') {
      failures.push(prefix + 'ENTITY_NOT_CURRENT');
      continue;
    }
    if (!research.eligibleCandidate(candidate)) {
      failures.push(prefix + 'SUPPRESSED_OR_AMBIGUOUS');
      continue;
    }
    if (!customer.boroughs.includes(candidate.borough)) {
      failures.push(prefix + 'BOROUGH_NOT_SUBSCRIBED');
      continue;
    }
    if (!customer.categories.includes(profiles.canonicalCategory(review.category))) {
      failures.push(prefix + 'CATEGORY_NOT_SUBSCRIBED');
      continue;
    }
    if (review.ownerReviewed !== true ||
        !String(review.whyItMatters || '').trim() ||
        !String(review.reviewedAt || '').trim()) {
      failures.push(prefix + 'OWNER_REVIEW_INCOMPLETE');
      continue;
    }
    const reviewedAt = research.instant(review.reviewedAt);
    if (!reviewedAt || reviewedAt < graph.observedAt || reviewedAt > preparedAt) {
      failures.push(prefix + 'REVIEW_TIME_INVALID');
      continue;
    }
    if (review.candidateFingerprint !== candidateIdentity(candidate)) {
      failures.push(prefix + 'REVIEW_SOURCE_IDENTITY_DRIFT');
      continue;
    }
    if (curated.inspectForbidden(review).length) {
      failures.push(prefix + 'PROHIBITED_PAID_OFFER_CLAIM');
      continue;
    }
    const sourceUpdatedAt = research.instant(candidate.sourceLatestEffectiveAt);
    if (!sourceUpdatedAt || sourceUpdatedAt > graph.observedAt) {
      failures.push(prefix + 'SOURCE_TIME_INVALID');
      continue;
    }
    const initial=Date.parse(data.ledger.initializedAt);
    const first=Date.parse(entry.firstObservedAt);
    if (first <= initial) {
      excluded.push({entityId:id,reason:'BASELINE_EXISTING_NOT_A_NEW_OBSERVATION'});
      continue;
    }
    const pickedSection = section(
      entry.firstObservedAt,customer.baselineAt,
      customer.starterSnapshotEnabled,data.ledger.initializedAt
    );
    if (!pickedSection) {
      excluded.push({entityId:id,reason:'OUTSIDE_SUBSCRIBER_BASELINE'});
      continue;
    }
    const key = signalKey(activated.subscriptionId,entry);
    if (delivered.has(key)) {
      excluded.push({entityId:id,reason:'ALREADY_DELIVERED'});
      continue;
    }
    selected.push({
      signalKey:key,
      section:pickedSection,
      firstObservedAt:entry.firstObservedAt,
      businessName:candidate.canonicalName,
      address:candidate.address,
      borough:candidate.borough,
      stage:candidate.lifecycleStage,
      whyItMatters:review.whyItMatters,
      sourceUpdatedAt,
      reviewedAt,
      sourceUrls:[primaryUrl(candidate)]
    });
  }
  if (failures.length) return reject(failures,{
    subscriberId:activated.subscriptionId,
    excludedCount:excluded.length
  });

  // Keep normal events before optional starter context, with stable ties.
  selected.sort((a,b) =>
    (a.section === b.section ? 0 : a.section === 'NORMAL' ? -1 : 1) ||
    b.firstObservedAt.localeCompare(a.firstObservedAt) ||
    a.signalKey.localeCompare(b.signalKey)
  );
  // Preserve NORMAL/STARTER classification and genuine first-observation
  // timestamps through CSV and HTML; never relabel an extraction as a filing.
  const signals = selected.map(signal => ({...signal}));
  const brief = curated.buildCuratedBrief({
    subscriptionId:activated.subscriptionId,
    recipientEmail:customer.recipientEmail,
    preparedAt,
    reviewer:String(data.reviewer).trim(),
    ownerReviewed:true,
    preferences:prefs,
    signals
  });
  if (!['READY','NO_MATCHES'].includes(brief.status)) {
    return reject(['CURATED_BRIEF_REVIEW_REQUIRED',...(brief.failures||[])]);
  }
  const attempt = delivery.createDeliveryAttempt({
    status:'READY',
    planFingerprint:brief.artifactFingerprint,
    signals:brief.signalKeys.map(key=>({signalKey:key}))
  },customer.recipientEmail);
  const artifact = {
    status:'READY',artifactFingerprint:brief.artifactFingerprint,
    signalKeys:brief.signalKeys
  };
  const message = {
    status:'READY',messageFingerprint:brief.messageFingerprint,
    signalKeys:brief.signalKeys
  };
  const preflight = transport.validateTransportAuthorization({
    artifact,message,attempt,authorization:null,now:preparedAt
  });
  if (preflight.allowed !== false ||
      !preflight.failures.includes('OWNER_AUTHORIZATION_MISSING')) {
    throw new Error('CURATED_NO_SEND_BOUNDARY_FAILED');
  }
  return {
    runnerVersion:VERSION,
    status:brief.status === 'READY' ? 'READY_FOR_OWNER_REVIEW' : 'NO_MATCHES_REVIEW',
    failures:[],
    subscriberId:activated.subscriptionId,
    profileFingerprint:activated.profileFingerprint,
    sourceGraphDigest:graph.graphDigest,
    sourceArtifactFingerprint:graph.artifactFingerprint,
    ledgerFingerprint:data.ledger.ledgerFingerprint,
    baselineAt:customer.baselineAt,
    signalCount:brief.signalCount,
    excluded,
    brief,
    attempt,
    transportPreflight:preflight,
    transportAllowed:false,
    externalSendCalls:0
  };
}

module.exports = {
  VERSION,EXPECTED_PRICE_ID,MAX_SOURCE_AGE_MS,STARTER_WINDOW_MS,
  digest,candidateIdentity,primaryUrl,section,signalKey,prepare
};
