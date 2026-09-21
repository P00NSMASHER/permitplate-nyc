'use strict';

const model = require('../model-v7');

const SCORING_VERSION = 'permitplate-score-v3-2026-09-21';
const CATEGORIES = Object.freeze(['POS','Insurance','Equipment','Hood/Fire','Waste','Pest','Linen','Distribution']);

const STAGE_WEIGHTS = Object.freeze({
  1:{POS:28,Insurance:25,Equipment:15,'Hood/Fire':8,Waste:12,Pest:10,Linen:8,Distribution:10},
  2:{POS:25,Insurance:24,Equipment:35,'Hood/Fire':35,Waste:18,Pest:15,Linen:15,Distribution:18},
  3:{POS:20,Insurance:17,Equipment:25,'Hood/Fire':25,Waste:28,Pest:30,Linen:25,Distribution:32},
  4:{POS:15,Insurance:10,Equipment:10,'Hood/Fire':12,Waste:32,Pest:35,Linen:30,Distribution:34}
});

const FIT = Object.freeze({HIGH:20,MEDIUM:10,LOW:-20});

function clamp(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

function recency(ageDays) {
  const n = Number(ageDays);
  if (!Number.isFinite(n) || n < 0) throw new Error('materialAgeDays must be a nonnegative number');
  if (n <= 3) return 15;
  if (n <= 7) return 10;
  if (n <= 30) return 5;
  return 0;
}

function corroboration(sourceCount) {
  const n = Number(sourceCount);
  if (!Number.isInteger(n) || n < 1) throw new Error('sourceCount must be an integer >= 1');
  if (n >= 3) return 18;
  if (n === 2) return 10;
  return 0;
}

function normalizedSource(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function sourceSet(values) {
  return new Set((values || []).map(normalizedSource));
}

function hasSla(values) {
  const set = sourceSet(values);
  return set.has('SLA') || set.has('SLAPENDING');
}

function directConceptFlags(input) {
  const supplied = input && input.conceptEvidence;
  if (!supplied || supplied.authority !== 'DIRECT_SOURCE_TEXT') {
    return {hotFood:false,restaurant:false,pokeBowl:false,lightPrep:false};
  }
  return {
    hotFood:supplied.hotFood === true,
    restaurant:supplied.restaurant === true,
    pokeBowl:supplied.pokeBowl === true,
    lightPrep:supplied.lightPrep === true
  };
}

function authorityNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function validateInput(input) {
  const errors = [];
  const fit = String(input && input.commercialFit || '').toUpperCase();
  if (fit !== 'EXCLUDE' && !(fit in FIT)) errors.push('COMMERCIAL_FIT_UNPROVEN');

  const stage = authorityNumber(input && input.stageNumber);
  if (stage === null || !STAGE_WEIGHTS[stage]) errors.push('STAGE_UNPROVEN');

  const age = authorityNumber(input && input.materialAgeDays);
  if (age === null || age < 0) errors.push('MATERIAL_AGE_UNPROVEN');

  const count = authorityNumber(input && input.sourceCount);
  if (count === null || !Number.isInteger(count) || count < 1) errors.push('SOURCE_COUNT_INVALID');

  if (input && input.strictVenueLinkedHospitalityDob === true &&
      input.buildingLevelUnmatchedDob === true) {
    errors.push('DOB_IDENTITY_CONTRADICTION');
  }
  return errors;
}

function computeScores(input) {
  const errors = validateInput(input || {});
  if (errors.length) return {status:'REVIEW',errors,scoringVersion:SCORING_VERSION};

  const fit = String(input.commercialFit).toUpperCase();
  if (fit === 'EXCLUDE') {
    const scores = Object.fromEntries(CATEGORIES.map((category) => [category,0]));
    return {
      status:'SCORED',
      scoringVersion:SCORING_VERSION,
      scores,
      bestVendorFit:'SUPPRESSED',
      bestScore:0,
      reasons:{common:['Commercial Fit EXCLUDE => all scores 0']}
    };
  }

  const stage = Number(input.stageNumber);
  const common =
    FIT[fit] +
    recency(input.materialAgeDays) +
    corroboration(input.sourceCount) +
    (input.publicPhone === true ? 5 : 0);

  const scores = {};
  const reasons = {common:[
    `Fit ${fit} ${FIT[fit] >= 0 ? '+' : ''}${FIT[fit]}`,
    `Recency +${recency(input.materialAgeDays)}`,
    `Corroboration +${corroboration(input.sourceCount)}`,
    `Public phone +${input.publicPhone === true ? 5 : 0}`
  ]};

  for (const category of CATEGORIES) {
    scores[category] = common + STAGE_WEIGHTS[stage][category];
    reasons[category] = [`Stage ${stage} +${STAGE_WEIGHTS[stage][category]}`];
  }

  if (hasSla(input.sources)) {
    scores.POS += 8;
    scores.Insurance += 10;
    reasons.POS.push('Accepted SLA corroboration +8');
    reasons.Insurance.push('Accepted SLA corroboration +10');
  }

  const matchedDob = input.strictVenueLinkedHospitalityDob === true &&
    input.buildingLevelUnmatchedDob !== true;

  if (matchedDob) {
    scores.Equipment += 20;
    reasons.Equipment.push('Accepted venue-linked hospitality DOB +20');

    if (input.directHoodFireDobScope === true) {
      scores['Hood/Fire'] += 18;
      reasons['Hood/Fire'].push('Accepted direct hood/fire DOB scope +18');
    }

    const cost = Number(input.dobInitialCost);
    if (Number.isFinite(cost) && cost >= 150000) {
      scores.Equipment += 8;
      reasons.Equipment.push('Accepted DOB cost >=150k +8');
    } else if (Number.isFinite(cost) && cost >= 50000) {
      scores.Equipment += 5;
      reasons.Equipment.push('Accepted DOB cost >=50k +5');
    }

    if (input.directHoodExtraScope === true) {
      scores['Hood/Fire'] += 8;
      reasons['Hood/Fire'].push('Accepted plumbing/mechanical/commercial-kitchen scope +8');
    }
  }

  const concept = directConceptFlags(input);
  if (concept.hotFood) {
    scores.Equipment += 20;
    scores['Hood/Fire'] += 18;
    scores.Linen += 10;
    scores.Distribution += 12;
    reasons.Equipment.push('Direct-source hot-food concept +20');
    reasons['Hood/Fire'].push('Direct-source hot-food concept +18');
    reasons.Linen.push('Direct-source hot-food concept +10');
    reasons.Distribution.push('Direct-source hot-food concept +12');
  }
  if (concept.restaurant) {
    scores.Equipment += 12;
    scores['Hood/Fire'] += 12;
    scores.Linen += 12;
    scores.Distribution += 10;
    reasons.Equipment.push('Direct-source restaurant/pub/bistro +12');
    reasons['Hood/Fire'].push('Direct-source restaurant/pub/bistro +12');
    reasons.Linen.push('Direct-source restaurant/pub/bistro +12');
    reasons.Distribution.push('Direct-source restaurant/pub/bistro +10');
  }
  if (concept.pokeBowl) {
    scores.Equipment += 8;
    scores['Hood/Fire'] += 6;
    scores.Distribution += 8;
    reasons.Equipment.push('Direct-source poke/bowl +8');
    reasons['Hood/Fire'].push('Direct-source poke/bowl +6');
    reasons.Distribution.push('Direct-source poke/bowl +8');
  }
  if (concept.lightPrep) {
    scores['Hood/Fire'] -= 12;
    scores.Linen -= 8;
    reasons['Hood/Fire'].push('Direct-source light-prep -12');
    reasons.Linen.push('Direct-source light-prep -8');
  }

  if (input.knownCuisineType === true) {
    scores.Distribution += 8;
    reasons.Distribution.push('Known cuisine/type +8');
  }
  if (input.actualDohmhPrePermit === true) {
    scores.Pest += 5;
    scores.Waste += 5;
    scores.Distribution += 5;
    reasons.Pest.push('Current-CAMIS DOHMH pre-permit +5');
    reasons.Waste.push('Current-CAMIS DOHMH pre-permit +5');
    reasons.Distribution.push('Current-CAMIS DOHMH pre-permit +5');
  }

  for (const category of CATEGORIES) scores[category] = clamp(scores[category]);

  const evidenceTags = [];
  if (input.directEquipmentDobScope === true) evidenceTags.push('EQUIPMENT');
  if (input.directHoodFireDobScope === true) evidenceTags.push('HOOD_FIRE');

  for (const category of ['Equipment','Hood/Fire']) {
    const result = model.applyVerticalEvidenceCeiling({
      category,
      score:scores[category],
      posScore:scores.POS,
      insuranceScore:scores.Insurance,
      evidenceTags,
      hotFoodSpecialistEvidence:concept.hotFood
    });
    if (result.reviewRequired) {
      return {status:'REVIEW',errors:['REFERENCE_SCORE_AUTHORITY_MISSING'],scoringVersion:SCORING_VERSION};
    }
    scores[category] = result.score;
    if (result.capped) reasons[category].push('Vertical evidence ceiling applied');
  }

  const best = selectBestVendor(scores, {
    stageNumber:stage,
    sources:input.sources,
    matchedDob,
    directHoodFireDobScope:input.directHoodFireDobScope === true,
    dobInitialCost:input.dobInitialCost,
    concept
  });

  return {
    status:'SCORED',
    scoringVersion:SCORING_VERSION,
    scores,
    bestVendorFit:best.bestVendorFit,
    bestScore:best.bestScore,
    reasons
  };
}

function selectBestVendor(scores, context) {
  const max = Math.max(...CATEGORIES.map((category) => Number(scores[category])));
  const tied = CATEGORIES.filter((category) => Number(scores[category]) === max);
  if (tied.length === 1) return {bestVendorFit:tied[0],bestScore:max};

  const ctx = context || {};
  const preferences = [];
  if (ctx.matchedDob && ctx.directHoodFireDobScope) preferences.push('Hood/Fire');
  if (ctx.matchedDob && Number(ctx.dobInitialCost) >= 50000) preferences.push('Equipment');
  if (ctx.concept && ctx.concept.hotFood) preferences.push('Equipment');
  if (hasSla(ctx.sources) && Number(ctx.stageNumber) === 1) preferences.push('Insurance');
  preferences.push(...CATEGORIES);

  for (const candidate of preferences) {
    if (tied.includes(candidate)) return {bestVendorFit:candidate,bestScore:max};
  }
  throw new Error('unable to select best vendor fit');
}

module.exports = {
  SCORING_VERSION,
  CATEGORIES,
  STAGE_WEIGHTS,
  FIT,
  recency,
  corroboration,
  directConceptFlags,
  authorityNumber,
  validateInput,
  computeScores,
  selectBestVendor
};
