'use strict';

function numeric(value, name) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error(`Invalid score ${name}`);
  return n;
}

/**
 * Production invariant recovered from PermitPlate QA:
 * Equipment and Hood/Fire may outrank max(POS, Insurance) only when there is
 * direct category-specific DOB scope or explicit hot-food specialist evidence.
 * Generic restaurant/SLA evidence, stage, corroboration, signs/awnings, or
 * building-level evidence cannot satisfy this gate.
 */
function applyVerticalEvidenceCeiling(scores, evidence = {}) {
  const out = { ...scores };
  const pos = numeric(out.POS ?? 0, 'POS');
  const insurance = numeric(out.Insurance ?? 0, 'Insurance');
  const baseline = Math.max(pos, insurance);
  const direct = Boolean(evidence.directCategoryDobScope || evidence.explicitHotFoodSpecialist);

  for (const key of ['Equipment','HoodFire']) {
    if (out[key] == null) continue;
    const value = numeric(out[key], key);
    if (!direct && value > baseline) out[key] = baseline;
  }
  return out;
}

/**
 * Building/shared-site evidence that lacks operator/DBA identity or matching
 * unit/stall/suite contributes zero production benefit.
 */
function sharedSiteContribution(match) {
  const directIdentity = Boolean(match.operatorOverlap || match.dbaOverlap || match.matchingUnit);
  if (!directIdentity) {
    return { stageDelta:0, scoreDelta:0, sourceCountDelta:0, confidenceDelta:0, accepted:false };
  }
  return {
    stageDelta:Number(match.stageDelta || 0),
    scoreDelta:Number(match.scoreDelta || 0),
    sourceCountDelta:Number(match.sourceCountDelta || 0),
    confidenceDelta:Number(match.confidenceDelta || 0),
    accepted:true,
  };
}

module.exports = { applyVerticalEvidenceCeiling, sharedSiteContribution };
