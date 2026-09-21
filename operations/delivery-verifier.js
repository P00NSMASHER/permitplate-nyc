'use strict';

const crypto = require('crypto');
const model = require('../model-v7');

const SCORE_COLUMNS = Object.freeze([
  ['POS Score', 'POS'],
  ['Insurance Score', 'Insurance'],
  ['Equipment Score', 'Equipment'],
  ['Hood/Fire Score', 'Hood/Fire'],
  ['Waste Score', 'Waste'],
  ['Pest Score', 'Pest'],
  ['Linen Score', 'Linen'],
  ['Distribution Score', 'Distribution']
]);

function asText(value) {
  return value == null ? '' : String(value).trim();
}

function rowObjects(rows) {
  if (!Array.isArray(rows) || !rows.length) return [];
  const header = rows[0].map(asText);
  return rows.slice(1).map((row) => Object.fromEntries(header.map((key, i) => [key, row[i] == null ? '' : row[i]])));
}

function normalizeCell(value) {
  return value == null || value === '' ? '' : String(value);
}

function canonicalRows(rows) {
  return (rows || []).map((row) => (row || []).map(normalizeCell));
}

function assert(condition, message, failures) {
  if (!condition) failures.push(message);
}

function uniqueNonblank(values) {
  const seen = new Set();
  for (const value of values.map(asText).filter(Boolean)) {
    if (seen.has(value)) return false;
    seen.add(value);
  }
  return true;
}

function validIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(asText(value));
}

function planEligible(row) {
  return ['HIGH', 'MEDIUM'].includes(asText(row['Commercial Fit']).toUpperCase()) &&
    !asText(row['Venue Key']).startsWith('UNRESOLVED:');
}

function score(row, column) {
  const number = Number(row[column]);
  return Number.isFinite(number) ? number : -1;
}

function validateSnapshot(input) {
  const failures = [];
  const graph = rowObjects(input.graph);
  const graphStaging = rowObjects(input.graphStaging);
  const leads = rowObjects(input.leads);
  const sourceEvents = rowObjects(input.sourceEvents);
  const deliveryState = rowObjects(input.deliveryState);
  const graphKeys = graph.map((row) => asText(row['Venue Key']));
  const leadKeys = leads.map((row) => asText(row['Lead Key']));

  assert(JSON.stringify(canonicalRows(input.graph)) === JSON.stringify(canonicalRows(input.graphStaging)),
    'Live Venue Graph differs from staging.', failures);
  assert(JSON.stringify(canonicalRows(input.leads)) === JSON.stringify(canonicalRows(input.leadsStaging)),
    'Live Leads differs from staging.', failures);
  assert(graph.length === leads.length, 'Graph and queue row counts differ.', failures);
  assert(uniqueNonblank(graphKeys) && graphKeys.every(Boolean), 'Venue keys are blank or duplicated.', failures);
  assert(uniqueNonblank(leadKeys) && leadKeys.every(Boolean), 'Lead keys are blank or duplicated.', failures);
  assert(new Set(graphKeys).size === new Set(leads.map((row) => asText(row['Venue Key']))).size &&
    graphKeys.every((key) => leads.some((row) => asText(row['Venue Key']) === key)),
    'Graph and queue venue-key sets differ.', failures);
  assert(uniqueNonblank(sourceEvents.map((row) => asText(row['Event ID']))), 'Source Event IDs are duplicated.', failures);
  assert(deliveryState.length === 0, 'Delivery State changed during a no-send verification.', failures);

  for (const row of graph) {
    const venueKey = asText(row['Venue Key']);
    assert(validIsoDate(row['First Signal Date']) && validIsoDate(row['Latest Signal Date']),
      `${venueKey}: signal dates are not ISO dates.`, failures);
    const scores = SCORE_COLUMNS.map(([column]) => score(row, column));
    assert(scores.every((value) => Number.isInteger(value) && value >= 0 && value <= 100),
      `${venueKey}: category score outside integer 0-100.`, failures);
    assert(score(row, 'Best Score') === Math.max(...scores), `${venueKey}: Best Score is not the category maximum.`, failures);
    if (['LOW', 'EXCLUDE'].includes(asText(row['Commercial Fit']).toUpperCase())) {
      assert(!planEligible(row), `${venueKey}: suppressed fit is eligible.`, failures);
    }
    const exactEvents = sourceEvents.filter((event) => asText(event['Venue Key']) === venueKey);
    const claimedSources = asText(row['Sources']).split(';').map(asText).filter(Boolean);
    const eventSources = new Set(exactEvents.map((event) => asText(event['Source'])).filter(Boolean));
    assert(Number(row['Source Count']) === claimedSources.length,
      `${venueKey}: Source Count differs from the claimed source list.`, failures);
    assert(claimedSources.length >= 1 && claimedSources.every((source) => eventSources.has(source)),
      `${venueKey}: a claimed source lacks an exact Source Event.`, failures);
  }

  return {
    passed: failures.length === 0,
    failures,
    counts: {
      graph: graph.length,
      leads: leads.length,
      sourceEvents: sourceEvents.length,
      deliveryRows: deliveryState.length,
      deliverable: graph.filter(planEligible).length,
      suppressed: graph.filter((row) => !planEligible(row)).length
    }
  };
}

function asBoolean(value) {
  if (value === true || value === false) return value;
  const text = asText(value).toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(text)) return true;
  if (['false', '0', 'no', 'n'].includes(text)) return false;
  return null;
}

function optionalNumber(value) {
  if (value === null || value === undefined || asText(value) === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function observationObjects(input) {
  if (!Array.isArray(input) || input.length === 0) return [];
  return Array.isArray(input[0]) ? rowObjects(input) : input;
}

function normalizeObservationReceipt(row) {
  if (!row || Array.isArray(row)) return {};
  const rawHashes = Array.isArray(row.rawPageHashes) ? row.rawPageHashes :
    asText(row['Raw Page Hashes']).split('|').map(asText).filter(Boolean);
  return {
    observationId: row.observationId || asText(row['Observation ID']),
    sourceId: row.sourceId || asText(row['Source ID']),
    connectorConfigHash: row.connectorConfigHash || asText(row['Connector Config Hash']),
    observedAt: row.observedAt || asText(row['Observed At']),
    sourceFresh: row.sourceFresh !== undefined ? row.sourceFresh : asBoolean(row['Source Fresh']),
    transportOk: row.transportOk !== undefined ? row.transportOk : asBoolean(row['Transport OK']),
    httpStatus: row.httpStatus !== undefined ? row.httpStatus : optionalNumber(row['HTTP Status']),
    sourceMoved: row.sourceMoved !== undefined ? row.sourceMoved : asBoolean(row['Source Moved']),
    redirected: row.redirected !== undefined ? row.redirected : asBoolean(row['Redirected']),
    redirectTarget: row.redirectTarget || asText(row['Redirect Target']),
    intendedFullScope: row.intendedFullScope !== undefined ? row.intendedFullScope : asBoolean(row['Intended Full Scope']),
    publisherCount: row.publisherCount !== undefined ? row.publisherCount : optionalNumber(row['Publisher Count']),
    fetchedCount: row.fetchedCount !== undefined ? row.fetchedCount : optionalNumber(row['Fetched Count']),
    cursorClosed: row.cursorClosed !== undefined ? row.cursorClosed : asBoolean(row['Cursor Closed']),
    schemaFingerprint: row.schemaFingerprint || asText(row['Schema Fingerprint']),
    rawPageHashes: rawHashes
  };
}

function validateSourceObservationReceipts(input) {
  const failures = [];
  const rows = observationObjects(input);
  if (!rows.length) {
    return {
      passed: true,
      enforced: false,
      failures,
      receiptCount: 0,
      states: {}
    };
  }

  const ids = [];
  const states = {};
  for (const row of rows) {
    const receipt = normalizeObservationReceipt(row);
    const id = receipt.observationId || receipt.sourceId || '(unidentified)';
    ids.push(receipt.observationId);
    const classified = model.classifySourceObservation(receipt);
    states[classified.state] = (states[classified.state] || 0) + 1;

    const declared = row.declaredState || asText(row['Declared State']);
    if (declared) {
      assert(declared === classified.state,
        `${id}: declared source state ${declared} differs from computed ${classified.state}.`, failures);
    }

    const absenceAllowed = row.absenceActionsAllowed !== undefined ?
      row.absenceActionsAllowed : asBoolean(row['Absence Actions Allowed']);
    if (absenceAllowed === true) {
      assert(classified.supportsAbsenceConclusion,
        `${id}: absence actions are enabled without complete source authority.`, failures);
    }
  }

  assert(uniqueNonblank(ids) && ids.every(Boolean),
    'Source Observation receipt IDs are blank or duplicated.', failures);

  return {
    passed: failures.length === 0,
    enforced: true,
    failures,
    receiptCount: rows.length,
    states
  };
}

function validatePredecessorScan(graphRows, scan) {
  const failures = [];
  const graph = rowObjects(graphRows);
  const conflicts = Array.isArray(scan && scan.predecessor_conflicts) ? scan.predecessor_conflicts : [];
  let presentInGraph = 0;
  for (const conflict of conflicts) {
    const camis = asText(conflict && conflict.applicant && conflict.applicant.camis);
    const row = graph.find((candidate) => asText(candidate['DOHMH CAMIS']) === camis);
    if (!row) continue;
    presentInGraph += 1;
    assert(!planEligible(row), `${camis}: applicant with an operational predecessor remains deliverable.`, failures);
  }
  return {passed: failures.length === 0, failures, conflicts: conflicts.length, presentInGraph};
}

function comparePlans(a, b) {
  return score(b, b._profile.scoreColumn) - score(a, a._profile.scoreColumn) ||
    score(b, 'Best Score') - score(a, 'Best Score') ||
    asText(b['Latest Signal Date']).localeCompare(asText(a['Latest Signal Date'])) ||
    asText(a['Venue Key']).localeCompare(asText(b['Venue Key']));
}

function makeSignalKey(section, baselineDate, row) {
  return `${section}:${baselineDate}:${asText(row['Venue Key'])}`;
}

function buildShadowPlan(graphRows, sourceEventRows, profile, normalKeys, baselineDate) {
  if (!validIsoDate(baselineDate)) throw new Error('baselineDate must be YYYY-MM-DD');
  const graph = rowObjects(graphRows);
  const events = rowObjects(sourceEventRows);
  const normalSet = new Set(normalKeys);
  const start = new Date(`${baselineDate}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 7);
  const starterFloor = start.toISOString().slice(0, 10);
  const match = (row) => planEligible(row) &&
    (!profile.boroughs || profile.boroughs.includes(asText(row['Borough']))) &&
    score(row, profile.scoreColumn) >= profile.minimumScore;
  const decorate = (row) => Object.assign({}, row, {_profile: profile});
  const normal = graph.filter((row) => match(row) && normalSet.has(asText(row['Venue Key'])))
    .map(decorate).sort(comparePlans).slice(0, 25);
  const remaining = Math.max(0, 25 - normal.length);
  const starter = graph.filter((row) => match(row) && !normalSet.has(asText(row['Venue Key'])) &&
    asText(row['First Signal Date']) >= starterFloor && asText(row['First Signal Date']) <= baselineDate)
    .map(decorate).sort(comparePlans).slice(0, Math.min(10, remaining));
  const used = new Set();
  const signals = normal.map((row) => ({section: 'normal', row}))
    .concat(starter.map((row) => ({section: 'starter', row})))
    .map(({section, row}) => {
      const venueKey = asText(row['Venue Key']);
      if (used.has(venueKey)) throw new Error(`Normal/starter overlap: ${venueKey}`);
      used.add(venueKey);
      const evidence = events.filter((event) => asText(event['Venue Key']) === venueKey);
      if (!evidence.length || evidence.some((event) => !asText(event['Source Record ID']) || !/^https:\/\//.test(asText(event['Source URL'])))) {
        throw new Error(`Missing source ID/URL for ${venueKey}`);
      }
      return {
        section,
        signalKey: makeSignalKey(section, baselineDate, row),
        venueKey,
        name: asText(row['Best Name']),
        borough: asText(row['Borough']),
        stage: asText(row['Stage']),
        selectedScore: score(row, profile.scoreColumn),
        bestScore: score(row, 'Best Score'),
        whyNow: asText(row['Why Now']),
        purchaseWindow: asText(row['Purchase Window']),
        evidence: evidence.map((event) => ({id: asText(event['Source Record ID']), url: asText(event['Source URL'])}))
      };
    });
  const attemptId = 'PP-SHADOW-' + crypto.createHash('sha256')
    .update(JSON.stringify([profile.name, baselineDate, signals.map((signal) => signal.signalKey)]))
    .digest('hex').slice(0, 18);
  return {profile: profile.name, baselineDate, normalCount: normal.length, starterCount: starter.length, signals, attemptId};
}

function safeCsvCell(value) {
  const text = asText(value);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function csvEncode(rows) {
  return rows.map((row) => row.map((value) => {
    const safe = safeCsvCell(value);
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  }).join(',')).join('\r\n') + '\r\n';
}

function renderArtifacts(plan) {
  const emailRows = plan.signals.map((signal) => signal.signalKey);
  const csvRows = [['Section', 'Signal Key', 'Venue', 'Borough', 'Stage', 'Selected Score', 'Best Score', 'Source IDs', 'Source URLs']]
    .concat(plan.signals.map((signal) => [
      signal.section, signal.signalKey, signal.name, signal.borough, signal.stage,
      signal.selectedScore, signal.bestScore,
      signal.evidence.map((item) => item.id).join(' | '),
      signal.evidence.map((item) => item.url).join(' | ')
    ]));
  return {emailRows, csvRows, csv: csvEncode(csvRows)};
}

function pendingSignalKeys(plan, recipientEmail, deliveredPairs) {
  const email = asText(recipientEmail).toLowerCase();
  const delivered = deliveredPairs instanceof Set ? deliveredPairs : new Set(deliveredPairs || []);
  return plan.signals.map((signal) => signal.signalKey)
    .filter((signalKey) => !delivered.has(JSON.stringify([email, signalKey])));
}

function markDelivered(deliveredPairs, recipientEmail, signalKeys) {
  const email = asText(recipientEmail).toLowerCase();
  const delivered = deliveredPairs instanceof Set ? deliveredPairs : new Set(deliveredPairs || []);
  for (const signalKey of signalKeys) delivered.add(JSON.stringify([email, signalKey]));
  return delivered;
}

function verifyPlans(plans) {
  const failures = [];
  const fingerprints = [];
  for (const plan of plans) {
    const keys = plan.signals.map((signal) => signal.signalKey);
    assert(keys.length <= 25, `${plan.profile}: more than 25 signals.`, failures);
    assert(plan.starterCount <= 10, `${plan.profile}: more than 10 starter signals.`, failures);
    assert(uniqueNonblank(keys), `${plan.profile}: duplicate signal key.`, failures);
    assert(plan.signals.every((signal) => signal.section === 'normal' || signal.section === 'starter'),
      `${plan.profile}: invalid section.`, failures);
    const rendered = renderArtifacts(plan);
    assert(JSON.stringify(rendered.emailRows) === JSON.stringify(rendered.csvRows.slice(1).map((row) => row[1])),
      `${plan.profile}: email/CSV order differs.`, failures);
    const rerendered = renderArtifacts(plan);
    assert(rendered.csv === rerendered.csv, `${plan.profile}: CSV is not deterministic.`, failures);
    assert(plan.signals.every((signal) => signal.evidence.length && signal.evidence.every((evidence) => evidence.id && evidence.url)),
      `${plan.profile}: evidence missing.`, failures);
    const syntheticRecipient = `${plan.profile.toLowerCase().replace(/[^a-z0-9]+/g, '.')}@shadow.invalid`;
    let delivered = new Set();
    const firstPending = pendingSignalKeys(plan, syntheticRecipient, delivered);
    delivered = markDelivered(delivered, syntheticRecipient, firstPending.slice(0, Math.floor(firstPending.length / 2)));
    const partialRetry = pendingSignalKeys(plan, syntheticRecipient, delivered);
    assert(partialRetry.length === firstPending.length - Math.floor(firstPending.length / 2),
      `${plan.profile}: partial-recipient retry plan is incorrect.`, failures);
    delivered = markDelivered(delivered, syntheticRecipient, partialRetry);
    assert(pendingSignalKeys(plan, syntheticRecipient, delivered).length === 0,
      `${plan.profile}: second-run duplicate suppression failed.`, failures);
    fingerprints.push(crypto.createHash('sha256').update(JSON.stringify(plan)).digest('hex'));
  }
  const neutralizationProbe = csvEncode([['=1+1', '+SUM(A1:A2)', '-2+3', '@cmd', 'safe']]);
  assert(neutralizationProbe.includes("'=1+1") && neutralizationProbe.includes("'+SUM") &&
    neutralizationProbe.includes("'-2+3") && neutralizationProbe.includes("'@cmd"),
    'CSV formula neutralization failed.', failures);
  return {
    passed: failures.length === 0,
    failures,
    fingerprint: crypto.createHash('sha256').update(fingerprints.join('|')).digest('hex')
  };
}

module.exports = {
  SCORE_COLUMNS,
  rowObjects,
  validateSnapshot,
  validateSourceObservationReceipts,
  validatePredecessorScan,
  buildShadowPlan,
  renderArtifacts,
  verifyPlans,
  pendingSignalKeys,
  markDelivered,
  safeCsvCell,
  csvEncode
};
