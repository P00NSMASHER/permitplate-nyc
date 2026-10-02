'use strict';

const STAGES = Object.freeze({
  JUST_FILED: 'JUST_FILED',
  BUILDOUT_LICENSING: 'BUILDOUT_LICENSING',
  HEALTH_PRE_PERMIT: 'HEALTH_PRE_PERMIT',
  NEAR_OPENING: 'NEAR_OPENING',
});

const rank = Object.freeze({
  [STAGES.JUST_FILED]: 1,
  [STAGES.BUILDOUT_LICENSING]: 2,
  [STAGES.HEALTH_PRE_PERMIT]: 3,
  [STAGES.NEAR_OPENING]: 4,
});

function strongestStage(evidence = {}) {
  let stage = evidence.currentFiling ? STAGES.JUST_FILED : null;

  // Only identity-validated cross-source records can move the venue.
  if (evidence.validatedSlaLicensing || evidence.validatedDobHospitalityBuildout) {
    stage = STAGES.BUILDOUT_LICENSING;
  }

  // Canonical hard rule: actual current-CAMIS DOHMH pre-permit only.
  if (evidence.currentCamisPrePermit === true) {
    stage = STAGES.HEALTH_PRE_PERMIT;
  }

  // Higher production trigger is not reconstructed; require an explicit,
  // independently validated flag rather than inferring from source count.
  if (evidence.explicitNearOpeningEvidence === true) {
    stage = STAGES.NEAR_OPENING;
  }

  // Suppression-only predecessor/shared-site evidence can never promote.
  if (evidence.onlyPredecessorEvidence === true && !evidence.currentFiling) {
    return null;
  }
  return stage;
}

function applyStageCeiling(currentStage, candidateStage, evidence = {}) {
  if (!candidateStage) return currentStage || null;
  if (evidence.sharedSiteUnmatchedDob || evidence.predecessorEvidenceOnly) {
    return currentStage || (evidence.currentFiling ? STAGES.JUST_FILED : null);
  }
  if (!currentStage) return candidateStage;
  return rank[candidateStage] > rank[currentStage] ? candidateStage : currentStage;
}

function applyKnownKokeRegression(venue) {
  if (String(venue.camis) !== '50192488') return venue;
  if (!venue.predecessor || String(venue.predecessor.camis) !== '50184059') return venue;

  return {
    ...venue,
    stage: STAGES.JUST_FILED,
    confidence: 'LOW',
    sourceMode: 'DOHMH_ONLY',
    bestScore: 28,
    purchaseWindow: 'SUPPRESSED',
    deliverySuppressed: true,
    predecessorEvidenceRole: 'SUPPRESSION_ONLY',
  };
}

module.exports = { STAGES, strongestStage, applyStageCeiling, applyKnownKokeRegression };
