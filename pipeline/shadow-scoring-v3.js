'use strict';

const model = require('../model-v7');
const commercialFit = require('./commercial-fit');

const SHADOW_SCORING_VERSION = 'permitplate-shadow-score-v3-2026-09-21';
const CATEGORIES = Object.freeze([
  'POS','Insurance','Equipment','Hood/Fire','Waste','Pest','Linen','Distribution'
]);
const STAGE_WEIGHTS = Object.freeze({
  1:{POS:28,Insurance:25,Equipment:15,'Hood/Fire':8,Waste:12,Pest:10,Linen:8,Distribution:10},
  2:{POS:25,Insurance:24,Equipment:35,'Hood/Fire':35,Waste:18,Pest:15,Linen:15,Distribution:18},
  3:{POS:20,Insurance:17,Equipment:25,'Hood/Fire':25,Waste:28,Pest:30,Linen:25,Distribution:32},
  4:{POS:15,Insurance:10,Equipment:10,'Hood/Fire':12,Waste:32,Pest:35,Linen:30,Distribution:34}
});
const FIT = Object.freeze({HIGH:20,MEDIUM:10,LOW:-20});

function clamp(n) {
  return Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
}

function stageNumber(stage) {
  const map = {
    'JUST FILED':1,
    'BUILDOUT / LICENSING':2,
    'HEALTH PRE-PERMIT':3,
    'MULTI-SOURCE NEAR-OPENING':4
  };
  return map[String(stage || '').toUpperCase()] || null;
}

function ageDays(effectiveAt, observedAt) {
  const a = Date.parse(String(effectiveAt || ''));
  const b = Date.parse(String(observedAt || ''));
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return (b - a) / (24 * 60 * 60 * 1000);
}

function recency(days) {
  if (!Number.isFinite(days) || days < 0) return null;
  if (days <= 3) return 15;
  if (days <= 7) return 10;
  if (days <= 30) return 5;
  return 0;
}

function corroboration(sourceCount) {
  const n = Number(sourceCount);
  if (!Number.isInteger(n) || n < 1) return null;
  if (n >= 3) return 18;
  if (n === 2) return 10;
  return 0;
}

function sourceMap(records) {
  const map = new Map();
  for (const record of records || []) {
    if (record && record.sourceRecordId) map.set(String(record.sourceRecordId), record);
  }
  return map;
}

function acceptedRecords(candidate, recordsById) {
  const accepted = candidate && candidate.projectSignal &&
    candidate.projectSignal.corroboration &&
    candidate.projectSignal.corroboration.accepted || [];
  return accepted
    .map((item) => recordsById.get(String(item && item.sourceRecordId || '')))
    .filter(Boolean);
}

function acceptedDob(candidate, recordsById) {
  return acceptedRecords(candidate, recordsById)
    .filter((record) => record.sourceSystem === 'DOB_NOW');
}

function acceptedSla(candidate, recordsById) {
  return acceptedRecords(candidate, recordsById)
    .filter((record) => record.sourceSystem === 'SLA_PENDING');
}

function dobScopeFacts(records) {
  const descriptions = (records || []).map((record) =>
    String(record && record.facts && record.facts.job_description || '')
  ).join(' | ');
  const costs = (records || [])
    .map((record) => Number(record && record.facts && record.facts.initial_cost_number))
    .filter(Number.isFinite);
  return {
    text:descriptions,
    maxCost:costs.length ? Math.max(...costs) : 0,
    equipment:/INTERIOR|BUILDOUT|KITCHEN|EQUIPMENT|PLUMBING|MECHANICAL|COMMERCIAL KITCHEN|TAKE[ -]?OUT/i.test(descriptions),
    hoodFire:/HOOD|FIRE SUPPRESSION|KITCHEN EXHAUST|COMMERCIAL KITCHEN/i.test(descriptions),
    hoodExtra:/PLUMBING|MECHANICAL|PLACE OF ASSEMBLY|COMMERCIAL KITCHEN/i.test(descriptions)
  };
}

function knownCuisine(primary) {
  const cuisine = String(primary && primary.facts && primary.facts.cuisine_description || '').trim();
  return Boolean(cuisine && !/^(UNKNOWN|OTHER|NOT LISTED|N\/A|NA)$/i.test(cuisine));
}

function publicPhone(primary) {
  return Boolean(String(primary && primary.facts && primary.facts.phone || '').trim());
}

function deriveInput(candidate, recordsById, observedAt) {
  const fitReceipt = commercialFit.classifyCommercialFit({
    candidate,
    recordsById
  });
  if (fitReceipt.status !== 'CLASSIFIED') {
    return {status:'REVIEW',errors:['FIT_UNCLASSIFIED'],fitReceipt};
  }

  const stage = stageNumber(candidate.lifecycleStage);
  const age = ageDays(candidate.sourceLatestEffectiveAt, observedAt);
  const corr = corroboration(candidate.sourceCount);
  if (!stage) return {status:'REVIEW',errors:['STAGE_UNPROVEN'],fitReceipt};
  if (age === null) return {status:'REVIEW',errors:['MATERIAL_AGE_UNPROVEN'],fitReceipt};
  if (corr === null) return {status:'REVIEW',errors:['SOURCE_COUNT_INVALID'],fitReceipt};

  const dobRecords = acceptedDob(candidate, recordsById);
  const slaRecords = acceptedSla(candidate, recordsById);
  const dob = dobScopeFacts(dobRecords);
  return {
    status:'READY',
    fitReceipt,
    input:{
      commercialFit:fitReceipt.fit,
      stageNumber:stage,
      materialAgeDays:age,
      sourceCount:Number(candidate.sourceCount),
      publicPhone:publicPhone(candidate.primaryRecord),
      conceptEvidence:fitReceipt.conceptEvidence || {
        authority:'DIRECT_SOURCE_TEXT',
        hotFood:false,restaurant:false,pokeBowl:false,lightPrep:false
      },
      knownCuisineType:knownCuisine(candidate.primaryRecord),
      actualDohmhPrePermit:candidate.lifecycleStage === 'HEALTH PRE-PERMIT',
      acceptedSla:slaRecords.length > 0,
      acceptedDob:dobRecords.length > 0,
      directEquipmentDobScope:dob.equipment,
      directHoodFireDobScope:dob.hoodFire,
      directHoodExtraScope:dob.hoodExtra,
      dobInitialCost:dob.maxCost,
      dobScopeText:dob.text
    }
  };
}

function selectBest(scores, context) {
  const max = Math.max(...CATEGORIES.map((category) => Number(scores[category])));
  const tied = CATEGORIES.filter((category) => Number(scores[category]) === max);
  if (tied.length === 1) return {bestVendorFit:tied[0],bestScore:max};

  const preferences = [];
  if (context.acceptedDob && context.directHoodFireDobScope) preferences.push('Hood/Fire');
  if (context.acceptedDob && Number(context.dobInitialCost) >= 50000) preferences.push('Equipment');
  if (context.conceptEvidence && context.conceptEvidence.hotFood) preferences.push('Equipment');
  if (context.acceptedSla && Number(context.stageNumber) === 1) preferences.push('Insurance');
  preferences.push(...CATEGORIES);
  for (const category of preferences) {
    if (tied.includes(category)) return {bestVendorFit:category,bestScore:max};
  }
  return {bestVendorFit:tied[0],bestScore:max};
}

function computeShadowScores(candidate, recordsById, observedAt) {
  const derived = deriveInput(candidate, recordsById, observedAt);
  if (derived.status !== 'READY') {
    return {
      status:'REVIEW',
      scoringVersion:SHADOW_SCORING_VERSION,
      errors:derived.errors,
      fitReceipt:derived.fitReceipt || null
    };
  }

  const input = derived.input;
  const fit = String(input.commercialFit || '').toUpperCase();
  if (fit === 'EXCLUDE') {
    const scores = Object.fromEntries(CATEGORIES.map((category) => [category,0]));
    return {
      status:'SHADOW_SCORED',
      scoringVersion:SHADOW_SCORING_VERSION,
      fitReceipt:derived.fitReceipt,
      input,
      scores,
      bestVendorFit:'SUPPRESSED',
      bestScore:0
    };
  }
  if (!(fit in FIT)) {
    return {status:'REVIEW',scoringVersion:SHADOW_SCORING_VERSION,errors:['FIT_INVALID'],fitReceipt:derived.fitReceipt};
  }

  const common =
    FIT[fit] +
    recency(input.materialAgeDays) +
    corroboration(input.sourceCount) +
    (input.publicPhone ? 5 : 0);

  const scores = {};
  for (const category of CATEGORIES) {
    scores[category] = common + STAGE_WEIGHTS[input.stageNumber][category];
  }

  if (input.acceptedSla) {
    scores.POS += 8;
    scores.Insurance += 10;
  }

  if (input.acceptedDob) {
    scores.Equipment += 20;
    if (input.directHoodFireDobScope) scores['Hood/Fire'] += 18;
    if (input.dobInitialCost >= 150000) scores.Equipment += 8;
    else if (input.dobInitialCost >= 50000) scores.Equipment += 5;
    if (input.directHoodExtraScope) scores['Hood/Fire'] += 8;
  }

  const concept = input.conceptEvidence || {};
  if (concept.hotFood === true) {
    scores.Equipment += 20;
    scores['Hood/Fire'] += 18;
    scores.Linen += 10;
    scores.Distribution += 12;
  }
  if (concept.restaurant === true) {
    scores.Equipment += 12;
    scores['Hood/Fire'] += 12;
    scores.Linen += 12;
    scores.Distribution += 10;
  }
  if (concept.pokeBowl === true) {
    scores.Equipment += 8;
    scores['Hood/Fire'] += 6;
    scores.Distribution += 8;
  }
  if (concept.lightPrep === true) {
    scores['Hood/Fire'] -= 12;
    scores.Linen -= 8;
  }
  if (input.knownCuisineType) scores.Distribution += 8;
  if (input.actualDohmhPrePermit) {
    scores.Pest += 5;
    scores.Waste += 5;
    scores.Distribution += 5;
  }

  for (const category of CATEGORIES) scores[category] = clamp(scores[category]);

  for (const category of ['Equipment','Hood/Fire']) {
    const ceiling = model.applyVerticalEvidenceCeiling({
      category,
      score:scores[category],
      posScore:scores.POS,
      insuranceScore:scores.Insurance,
      evidenceTags:[
        input.directEquipmentDobScope ? 'EQUIPMENT' : null,
        input.directHoodFireDobScope ? 'HOOD_FIRE' : null
      ].filter(Boolean),
      hotFoodSpecialistEvidence:concept.hotFood === true
    });
    if (ceiling.reviewRequired) {
      return {
        status:'REVIEW',
        scoringVersion:SHADOW_SCORING_VERSION,
        errors:['VERTICAL_CEILING_INPUT_INVALID'],
        fitReceipt:derived.fitReceipt
      };
    }
    scores[category] = ceiling.score;
  }

  const best = selectBest(scores,input);
  return {
    status:'SHADOW_SCORED',
    scoringVersion:SHADOW_SCORING_VERSION,
    fitReceipt:derived.fitReceipt,
    input,
    scores,
    bestVendorFit:best.bestVendorFit,
    bestScore:best.bestScore
  };
}

module.exports = {
  SHADOW_SCORING_VERSION,
  CATEGORIES,
  STAGE_WEIGHTS,
  FIT,
  clamp,
  stageNumber,
  ageDays,
  recency,
  corroboration,
  sourceMap,
  acceptedRecords,
  acceptedDob,
  acceptedSla,
  dobScopeFacts,
  knownCuisine,
  publicPhone,
  deriveInput,
  selectBest,
  computeShadowScores
};
