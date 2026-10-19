'use strict';

// SIMULATION ONLY. Two different synthetic heuristics assess a BLIND packet.
// These are NOT people, never satisfy independence, never count as calibration,
// and never unlock tuning thresholds, holdout cases or production scoring.
const {hash,verify}=require('./calibration-cohort');
const evaluation=require('./calibration-evaluation');

const VERSION='PermitPlate-simulated-equipment-review-v1.0.0';
const PROFILES=Object.freeze([
  Object.freeze({
    id:'simulated-equipment-vendor-v1',
    role:'SIMULATED_EQUIPMENT_VENDOR',
    description:'Vendor-oriented desk-review heuristic: WATCH on a named foodservice applicant or pre-permit record, without presuming procurement.'
  }),
  Object.freeze({
    id:'simulated-source-auditor-v1',
    role:'SIMULATED_EVIDENCE_AUDITOR',
    description:'Source-verification heuristic: require dated, relatively recent substantive activity for even a WATCH; no equipment-specific claim without equipment evidence.'
  })
]);
const FOOD_TERMS=/\b(?:restaurant|cafe|coffee|pizza|pizzeria|sushi|ramen|grill|bakery|catering|chicken|kitchen|food|cake|taco|gelato|pub|diner|bar|roti|cuisine|fried|bistro|brew|steak|seafood|soup|burger|mexican|italian|indian|carnes|ice cream)\b/i;
const EQUIPMENT_TERMS=/\b(?:commercial kitchen equipment|kitchen exhaust|exhaust hood|fire suppression|walk-in cooler|commercial refrigeration|food service equipment)\b/i;
function present(value){return typeof value==='string'?value.trim():'';}
function validatePacket(packet){
  if(!verify(packet)||packet.phase!=='TUNING'||packet.isSynthetic!==false||
     !Array.isArray(packet.cards)||!packet.cards.length||
     packet.categories?.length!==1||packet.categories[0]!=='Equipment'||
     !packet.cards.every(card=>card&&present(card.caseId)&&
       /^[a-f0-9]{64}$/.test(card.evidenceFingerprint||'')&&
       Array.isArray(card.evidence)&&card.evidence.length>0&&
       card.evidence.every(e=>present(e.recordId))&&
       !Object.prototype.hasOwnProperty.call(card,'predictions')&&
       !Object.prototype.hasOwnProperty.call(card,'scores')&&
       !Object.prototype.hasOwnProperty.call(card,'v3')&&
       !Object.prototype.hasOwnProperty.call(card,'v4'))){
    throw Error('BLIND_SOURCE_PACKET_REQUIRED');
  }
  return packet;
}
function daysSince(value,observedAt){
  const date=Date.parse(String(value||'')),now=Date.parse(String(observedAt||''));
  if(!Number.isFinite(date)||!Number.isFinite(now)||date>now)return null;
  return Math.floor((now-date)/86400000);
}
function assess(card,profile,packetObservedAt){
  const evidence=card.evidence;
  const job=evidence.find(e=>e.sourceSystem==='DOB_NOW'&&
    EQUIPMENT_TERMS.test(present(e.facts?.job_description)));
  const pre=evidence.find(e=>e.eventType==='DOHMH_PRE_PERMIT_EVENT'&&
    present(e.facts?.inspection_date)&&
    !present(e.facts.inspection_date).startsWith('1900-'));
  const applicant=evidence.find(e=>e.eventType==='DOHMH_APPLICANT_RECORD');
  const dated=daysSince(card.businessEventDate,packetObservedAt);
  const nameFood=FOOD_TERMS.test(present(card.businessName));
  let verdict='INSUFFICIENT_EVIDENCE';
  let reason;
  if(card.identityCaveat){
    verdict='NOT_RELEVANT';
    reason='The supplied source card explicitly warns about conflicting operating identities. That identity question must be resolved before classifying an equipment-vendor prospect.';
  }else if(job){
    if(profile.id==='simulated-equipment-vendor-v1'){
      verdict=dated!=null&&dated<=60?'PURSUE_NOW':'WATCH';
      reason='A linked official DOB job description contains equipment-related wording. It merits a source-level vendor follow-up simulation, but the filing does not establish purchase intent, decision-maker access or award probability.';
    }else{
      verdict=dated!=null&&dated<=30?'PURSUE_NOW':'WATCH';
      reason='A DOB record includes explicit commercial equipment/ventilation language, but exact scope, permit timing and the restaurant operator still need independent source review before a sales claim can be made.';
    }
  }else if(pre){
    if(profile.id==='simulated-equipment-vendor-v1'||(dated!==null&&dated<=21)){
      verdict='WATCH';
      reason='The official DOHMH pre-permit inspection has a real dated event ('+
        String(card.businessEventDate||'date unavailable')+
        '). The simulated reviewer would monitor operational progress, not infer that kitchen equipment is being purchased; the record contains no verified procurement or DOB equipment scope.';
    }else{
      verdict='INSUFFICIENT_EVIDENCE';
      reason='The DOHMH pre-permit inspection is dated but outside this auditor simulation’s 21-day recency window. It is a regulatory event, not evidence of a current commercial-equipment request or purchase.';
    }
  }else if(applicant){
    if(profile.id==='simulated-equipment-vendor-v1'&&nameFood){
      verdict='WATCH';
      reason='An official DOHMH applicant record and a foodservice-related venue name establish limited restaurant research context. The inspection field is a 1900 placeholder; there is no proven filing event date, construction scope, equipment requirement, or buying intent. WATCH means possible background research only.';
    }else{
      verdict='INSUFFICIENT_EVIDENCE';
      reason='Only a DOHMH restaurant applicant record is shown, with an unusable 1900 inspection-date placeholder. No dated project milestone or official equipment-specific construction record supports an actionable equipment-vendor recommendation.';
    }
  }else{
    reason='The supplied official records do not establish a dated, verified equipment-relevant development; a venue identity or mere data refresh is insufficient evidence for sales action.';
  }
  // Distinct synthetic approaches may disagree. A conflict is an evaluation
  // diagnostic, not a reason to force consensus or fabricate reviewer labels.
  return {verdict,reason,evidenceRefs:[evidence[0].recordId]};
}
function simulate(packet,simulatedAt){
  validatePacket(packet);
  const at=new Date(simulatedAt);
  if(!Number.isFinite(at.valueOf())||at.toISOString()<packet.observedAt){
    throw Error('SIMULATION_TIME_INVALID');
  }
  return PROFILES.map(profile=>{
    const judgments=packet.cards.map(card=>({
      caseId:card.caseId,
      category:'Equipment',
      evidenceFingerprint:card.evidenceFingerprint,
      ...assess(card,profile,packet.observedAt),
      reviewedAt:at.toISOString()
    }));
    return {
      version:packet.version,
      simulationVersion:VERSION,
      reviewerId:profile.id,
      reviewerRole:profile.role,
      attestation:'SIMULATED_MODEL_REVIEW_NOT_INDEPENDENT_HUMAN',
      blinded:true,
      isSynthetic:true,
      phase:packet.phase,
      cohortFingerprint:packet.cohortFingerprint,
      packetFingerprint:packet.fingerprint,
      lockFingerprint:packet.lockFingerprint,
      simulatedAt:at.toISOString(),
      methodology:profile.description,
      judgments,
      provenance:{
        kind:'SIMULATED_NON_HUMAN',
        reviewerIsRealPerson:false,
        independentlyVerified:false,
        source:'BLIND_SOURCE_CARDS_ONLY',
        productionAuthorized:false
      }
    };
  });
}
function summarize(packet,envelopes){
  validatePacket(packet);
  if(!Array.isArray(envelopes)||envelopes.length!==2||
     envelopes.some(e=>e.isSynthetic!==true||
       e.attestation!=='SIMULATED_MODEL_REVIEW_NOT_INDEPENDENT_HUMAN'||
       e.judgments.length!==packet.cards.length)){
    throw Error('TWO_COMPLETE_SYNTHETIC_REVIEWERS_REQUIRED');
  }
  const totals={},caseOutcomes=[],agreement={same:0,different:0,disagreements:[]};
  for(const e of envelopes){
    totals[e.reviewerId]={};
    for(const j of e.judgments){
      const map=totals[e.reviewerId];
      map[j.verdict]=(map[j.verdict]||0)+1;
    }
  }
  for(let i=0;i<packet.cards.length;i++){
    const a=envelopes[0].judgments[i],b=envelopes[1].judgments[i];
    if(a.caseId!==b.caseId||a.caseId!==packet.cards[i].caseId||
       a.evidenceFingerprint!==packet.cards[i].evidenceFingerprint||
       b.evidenceFingerprint!==a.evidenceFingerprint){
      throw Error('SIMULATION_CASE_BINDING_INVALID');
    }
    const same=a.verdict===b.verdict;
    if(same)agreement.same++;
    else{
      agreement.different++;
      agreement.disagreements.push({
        caseId:a.caseId,
        businessName:packet.cards[i].businessName,
        vendorSimulation:a.verdict,
        auditorSimulation:b.verdict
      });
    }
    caseOutcomes.push({
      caseId:a.caseId,
      modelAgreement:same,
      vendorVerdict:a.verdict,
      auditorVerdict:b.verdict,
      officialEvidenceTypes:[...new Set(packet.cards[i].evidence.map(x=>x.eventType))],
      equipmentSourceTerms:packet.cards[i].evidence.some(x=>
        x.sourceSystem==='DOB_NOW'&&
        EQUIPMENT_TERMS.test(present(x.facts?.job_description)))
    });
  }
  const sourceKinds={};
  for(const card of packet.cards){
    const systems=[...new Set(card.evidence.map(x=>x.sourceSystem))].sort().join('+');
    sourceKinds[systems]=(sourceKinds[systems]||0)+1;
  }
  const body={
    version:VERSION,
    status:'SYNTHETIC_DIAGNOSTIC_ONLY',
    cohortId:packet.cohortId,
    cohortFingerprint:packet.cohortFingerprint,
    packetFingerprint:packet.fingerprint,
    phase:packet.phase,
    syntheticReviewerCount:2,
    uniqueBlindCases:packet.cards.length,
    simulatedJudgments:envelopes.reduce((n,e)=>n+e.judgments.length,0),
    sourceKinds,
    verdictCounts:totals,
    exactAgreementCases:agreement.same,
    disagreementCases:agreement.different,
    simulatedAgreementRate:packet.cards.length?agreement.same/packet.cards.length:null,
    disagreements:agreement.disagreements,
    caseOutcomes,
    actualIndependentHumanReviews:0,
    humanCalibrationSubstitute:false,
    holdoutOpened:false,
    productionAuthorized:false,
    transportMode:'NO_SEND',
    externalSendCalls:0,
    caution:'All judgments are AI/rule-simulated from the blinded source card. They do not represent independent human experts, cannot validate category precision or purchasing intent, cannot substitute for real source inspection, and must not be fed to production scoring authorization.'
  };
  return {...body,simulationFingerprint:hash(body)};
}
function dryRunGate(cohort,envelopes,at){
  if(!cohort||!Array.isArray(envelopes)||envelopes.some(e=>e.isSynthetic!==true)){
    throw Error('ONLY_SYNTHETIC_NONHUMAN_REVIEWS_ALLOWED');
  }
  const lock=evaluation.lockThresholds(cohort,envelopes,at);
  if(lock.status!=='BLOCKED'||lock.productionAuthorized!==false||
     !lock.failures.includes('INDEPENDENT_HUMAN_REVIEW_REQUIRED')){
    throw Error('SIMULATED_REVIEW_GATE_MUST_STAY_BLOCKED');
  }
  return {
    status:lock.status,productionAuthorized:false,
    failures:lock.failures,
    simulationOnly:true,
    independentHumanReviewsValidated:0
  };
}
module.exports={VERSION,PROFILES,FOOD_TERMS,EQUIPMENT_TERMS,
  validatePacket,daysSince,assess,simulate,summarize,dryRunGate};
