'use strict';

const fs = require('fs');
const path = require('path');
const v = require('./delivery-verifier');

const root = __dirname;
const workbook = JSON.parse(fs.readFileSync(path.join(root, 'permitplate-verification-input.json'), 'utf8'));
const unformatted = JSON.parse(fs.readFileSync(path.join(root, 'permitplate-unformatted-leads.json'), 'utf8'));
const sourceScan = JSON.parse(fs.readFileSync(path.join(root, 'permit-current-source-scan.json'), 'utf8'));
const graphRows = workbook['Venue Graph'];
const previousCommittedCount = 38;
const normalKeys = v.rowObjects(graphRows).slice(previousCommittedCount).map((row) => String(row['Venue Key']));
const profiles = [
  {name: 'General', scoreColumn: 'Best Score', minimumScore: 0, boroughs: null},
  {name: 'Equipment Brooklyn/Queens >=65', scoreColumn: 'Equipment Score', minimumScore: 65, boroughs: ['Brooklyn', 'Queens']},
  {name: 'Waste Brooklyn >=60', scoreColumn: 'Waste Score', minimumScore: 60, boroughs: ['Brooklyn']},
  {name: 'POS Manhattan >=60', scoreColumn: 'POS Score', minimumScore: 60, boroughs: ['Manhattan']},
  {name: 'Hood/Fire NYC >=70', scoreColumn: 'Hood/Fire Score', minimumScore: 70, boroughs: null}
];
const snapshot = v.validateSnapshot({
  graph: graphRows,
  graphStaging: workbook['Venue Graph Staging'],
  leads: unformatted.Leads,
  leadsStaging: unformatted['Leads Staging'],
  sourceEvents: workbook['Source Events'],
  deliveryState: workbook['Delivery State']
});
const plans = profiles.map((profile) => v.buildShadowPlan(graphRows, workbook['Source Events'], profile, normalKeys, '2026-09-18'));
const repeatedPlans = profiles.map((profile) => v.buildShadowPlan(graphRows, workbook['Source Events'], profile, normalKeys, '2026-09-18'));
const planVerification = v.verifyPlans(plans);
const predecessorVerification = v.validatePredecessorScan(graphRows, sourceScan);
if (JSON.stringify(plans) !== JSON.stringify(repeatedPlans)) throw new Error('Repeated planning was not deterministic.');
const artifactDirectory = path.join(root, 'permitplate-shadow-artifacts');
fs.mkdirSync(artifactDirectory, {recursive: true});
for (const plan of plans) {
  const name = plan.profile.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  fs.writeFileSync(path.join(artifactDirectory, `${name}.csv`), v.renderArtifacts(plan).csv);
}
const result = {
  runAt: new Date().toISOString(),
  mode: 'NO_SEND_SHADOW',
  liveStripeSubscriptions: 0,
  noSendReason: 'No eligible live subscription; no customer contact or Delivery State mutation.',
  snapshot,
  planVerification,
  predecessorVerification,
  profiles: plans.map((plan) => ({
    profile: plan.profile,
    normal: plan.normalCount,
    starter: plan.starterCount,
    total: plan.signals.length,
    attemptId: plan.attemptId
  }))
};
result.passed = snapshot.passed && planVerification.passed && predecessorVerification.passed;
fs.writeFileSync(path.join(root, 'permitplate-delivery-verification-result.json'), JSON.stringify(result, null, 2) + '\n');
if (!result.passed) {
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(result, null, 2));
