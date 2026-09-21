'use strict';

// Separate candidate scorer. Production policy and frozen V3 benchmark stay intact.
// Only recency input/presentation semantics change; existing non-temporal rules are
// reused verbatim. Do not subtract points from already-clamped V3 scores.
const model=require('../model-v7');
const commercialFit=require('./commercial-fit');
const v3=require('./shadow-scoring-v3');
const eventTime=require('./event-time');
const {CATEGORIES,STAGE_WEIGHTS,FIT,clamp,corroboration,selectBest}=v3;
const SHADOW_SCORING_VERSION='permitplate-shadow-score-v4-event-time-2026-09-21';

function deriveInput(candidate,recordsById,observedAt){
  const chronology=eventTime.describe(candidate,recordsById,observedAt);
  if(chronology.status==='REVIEW') return {status:'REVIEW',errors:chronology.failures,chronology};
  const fitReceipt=commercialFit.classifyCommercialFit({candidate,recordsById});
  if(fitReceipt.status!=='CLASSIFIED') return {status:'REVIEW',errors:['FIT_UNCLASSIFIED'],fitReceipt,chronology};
  const stage=v3.stageNumber(candidate.lifecycleStage);
  if(!stage) return {status:'REVIEW',errors:['STAGE_UNPROVEN'],fitReceipt,chronology};
  if(corroboration(candidate.sourceCount)===null) return {status:'REVIEW',errors:['SOURCE_COUNT_INVALID'],fitReceipt,chronology};
  const accepted=v3.acceptedRecords(candidate,recordsById);
  const dob=v3.dobScopeFacts(accepted.filter(r=>r.sourceSystem==='DOB_NOW'));
  const sla=accepted.filter(r=>r.sourceSystem==='SLA_PENDING');
  const concept=v3.scoringConceptEvidence(fitReceipt,accepted);
  return {status:'READY',fitReceipt,chronology,input:{
    commercialFit:fitReceipt.fit,stageNumber:stage,
    materialAgeDays:chronology.businessEventAgeCalendarDays,
    ageBasis:chronology.eventDateBasis,
    recencyPoints:chronology.recencyPoints,
    sourceCount:Number(candidate.sourceCount),publicPhone:v3.publicPhone(candidate.primaryRecord),
    conceptEvidence:concept,
    knownCuisineType:v3.knownCuisine(candidate.primaryRecord)||Boolean(fitReceipt.conceptEvidence&&fitReceipt.conceptEvidence.explicit)||v3.acceptedKnownType(accepted),
    actualDohmhPrePermit:candidate.lifecycleStage==='HEALTH PRE-PERMIT',
    acceptedSla:sla.length>0,acceptedDob:dob.hospitality,
    acceptedDobIdentityOnly:accepted.some(r=>r.sourceSystem==='DOB_NOW')&&!dob.hospitality,
    directEquipmentDobScope:dob.equipment,directHoodFireDobScope:dob.hoodFire,
    directHoodExtraScope:dob.hoodExtra,dobInitialCost:dob.maxCost,dobScopeText:dob.text
  }};
}

function computeShadowScores(candidate,recordsById,observedAt){
  const derived=deriveInput(candidate,recordsById,observedAt);
  if(derived.status!=='READY') return {
    status:'REVIEW',scoringVersion:SHADOW_SCORING_VERSION,productionAuthorized:false,
    errors:derived.errors,fitReceipt:derived.fitReceipt||null,eventChronology:derived.chronology
  };
  const input=derived.input;
  const fit=String(input.commercialFit||'').toUpperCase();
  if(fit==='EXCLUDE') return {
    status:'SHADOW_SCORED',scoringVersion:SHADOW_SCORING_VERSION,fitReceipt:derived.fitReceipt,
    input,eventChronology:derived.chronology,productionAuthorized:false,
    scores:Object.fromEntries(CATEGORIES.map(category=>[category,0])),bestVendorFit:'SUPPRESSED',bestScore:0
  };
  if(!(fit in FIT)) return {status:'REVIEW',productionAuthorized:false,scoringVersion:SHADOW_SCORING_VERSION,errors:['FIT_INVALID'],fitReceipt:derived.fitReceipt};

  const common=FIT[fit]+derived.chronology.recencyPoints+corroboration(input.sourceCount)+(input.publicPhone?5:0);
  const scores={};
  for(const category of CATEGORIES) scores[category]=common+STAGE_WEIGHTS[input.stageNumber][category];
  if(input.acceptedSla){scores.POS+=8;scores.Insurance+=10;}
  if(input.acceptedDob){
    scores.Equipment+=20;
    if(input.directHoodFireDobScope) scores['Hood/Fire']+=18;
    if(input.dobInitialCost>=150000) scores.Equipment+=8;
    else if(input.dobInitialCost>=50000) scores.Equipment+=5;
    if(input.directHoodExtraScope) scores['Hood/Fire']+=8;
  }
  const concept=input.conceptEvidence||{};
  if(concept.hotFood===true){scores.Equipment+=20;scores['Hood/Fire']+=18;scores.Linen+=10;scores.Distribution+=12;}
  if(concept.restaurant===true){scores.Equipment+=12;scores['Hood/Fire']+=12;scores.Linen+=12;scores.Distribution+=10;}
  if(concept.pokeBowl===true){scores.Equipment+=8;scores['Hood/Fire']+=6;scores.Distribution+=8;}
  if(concept.lightPrep===true){scores['Hood/Fire']-=12;scores.Linen-=8;}
  if(input.knownCuisineType) scores.Distribution+=8;
  if(input.actualDohmhPrePermit){scores.Pest+=5;scores.Waste+=5;scores.Distribution+=5;}
  for(const category of CATEGORIES) scores[category]=clamp(scores[category]);
  for(const category of ['Equipment','Hood/Fire']){
    const ceiling=model.applyVerticalEvidenceCeiling({
      category,score:scores[category],posScore:scores.POS,insuranceScore:scores.Insurance,
      evidenceTags:[input.directEquipmentDobScope?'EQUIPMENT':null,input.directHoodFireDobScope?'HOOD_FIRE':null].filter(Boolean),
      hotFoodSpecialistEvidence:concept.hotFood===true
    });
    if(ceiling.reviewRequired) return {
      status:'REVIEW',productionAuthorized:false,scoringVersion:SHADOW_SCORING_VERSION,
      errors:['VERTICAL_CEILING_INPUT_INVALID'],fitReceipt:derived.fitReceipt
    };
    scores[category]=ceiling.score;
  }
  const best=selectBest(scores,input);
  return {
    status:'SHADOW_SCORED',scoringVersion:SHADOW_SCORING_VERSION,
    fitReceipt:derived.fitReceipt,input,eventChronology:derived.chronology,productionAuthorized:false,
    scores,bestVendorFit:best.bestVendorFit,bestScore:best.bestScore
  };
}
module.exports={SHADOW_SCORING_VERSION,CATEGORIES,sourceMap:v3.sourceMap,deriveInput,computeShadowScores};
