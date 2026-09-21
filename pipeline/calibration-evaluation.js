'use strict';

// Threshold selection is advisory and cannot modify production policy or transport.
// Reviewer attestations are declarations, not authentication of human expertise.
const {VERSION,PROTOCOL,stable,hash,sealed,verify,validateCohort,blindPacket}=require('./calibration-cohort');
const clock=require('./event-time');
const VERDICTS=Object.freeze(['PURSUE_NOW','WATCH','NOT_RELEVANT','INSUFFICIENT_EVIDENCE']);
const REVIEWER_ROLES=Object.freeze(['VENDOR_DOMAIN_REVIEWER','INDEPENDENT_DOMAIN_REVIEWER','FOUNDER_DOMAIN_REVIEWER']);
function validateReviews(cohort,envelopes,phase,lock=null){
  validateCohort(cohort);
  const packet=blindPacket(cohort,phase,lock),cases=new Map(packet.cards.map(c=>[c.caseId,c]));
  const errors=[],reviewers=new Set(),judgments=new Map();
  if(!Array.isArray(envelopes))throw new Error('REVIEW_ENVELOPES_ARRAY_REQUIRED');
  for(const e of envelopes){
    if(!e||e.version!==VERSION||e.cohortFingerprint!==cohort.fingerprint||
      e.packetFingerprint!==packet.fingerprint||e.phase!==phase||e.lockFingerprint!==packet.lockFingerprint){
      errors.push('REVIEW_PACKET_BINDING_INVALID');continue;
    }
    if(!/^[a-zA-Z0-9_-]{3,64}$/.test(e.reviewerId||'')||reviewers.has(e.reviewerId)){
      errors.push('REVIEWER_ID_INVALID_OR_DUPLICATE');continue;
    }
    reviewers.add(e.reviewerId);
    if(!REVIEWER_ROLES.includes(e.reviewerRole)||e.attestation!=='INDEPENDENT_HUMAN_SOURCE_REVIEW'||
      e.blinded!==true||e.isSynthetic!==false)errors.push('INDEPENDENT_HUMAN_REVIEW_REQUIRED');
    if(!Array.isArray(e.judgments)){errors.push('JUDGMENTS_ARRAY_REQUIRED');continue;}
    const seen=new Set();
    for(const j of e.judgments){
      const card=cases.get(j?.caseId),key=j?.caseId+'|'+j?.category;
      if(!card||!cohort.categories.includes(j.category)){errors.push('UNKNOWN_OR_WRONG_PHASE_CASE');continue;}
      if(seen.has(key)){errors.push('DUPLICATE_REVIEWER_JUDGMENT');continue;}seen.add(key);
      if(j.evidenceFingerprint!==card.evidenceFingerprint||!VERDICTS.includes(j.verdict))errors.push('JUDGMENT_BINDING_OR_VERDICT_INVALID');
      if(typeof j.reason!=='string'||j.reason.trim().length<12)errors.push('SOURCE_REASON_REQUIRED');
      const refs=new Set(card.evidence.map(r=>r.recordId));
      if(!Array.isArray(j.evidenceRefs)||!j.evidenceRefs.length||j.evidenceRefs.some(r=>!refs.has(r)))errors.push('SOURCE_REFERENCE_REQUIRED');
      const when=clock.instant(j.reviewedAt);
      if(!when||when<cohort.observedAt||Date.parse(when)>Date.now())errors.push('REVIEW_TIMESTAMP_INVALID');
      if(phase==='HOLDOUT'&&when&&when<lock.createdAt)errors.push('HOLDOUT_REVIEW_PREDATES_LOCK');
      if(!judgments.has(key))judgments.set(key,[]);
      judgments.get(key).push({...j,reviewerId:e.reviewerId});
    }
  }
  return {errors:[...new Set(errors)].sort(),reviewerCount:reviewers.size,judgments,
    reviewDigest:hash(envelopes),reviewerIds:[...reviewers].sort()};
}
function consensus(rows,category,judgments){
  const labeled=[],disagreements=[],missing=[];
  for(const row of rows){
    const labels=judgments.get(row.caseId+'|'+category)||[];
    if(labels.length<2){missing.push(row.caseId);continue;}
    // Exact label agreement, not majority vote. Disagreements need new independent
    // review/adjudication outside this module; they never become silent negatives.
    if(new Set(labels.map(l=>l.verdict)).size!==1){disagreements.push(row.caseId);continue;}
    labeled.push({...row,positive:labels[0].verdict==='PURSUE_NOW',verdict:labels[0].verdict});
  }
  const considered=rows.length-missing.length;
  return {rows:labeled,missing,disagreements,total:rows.length,reviewed:considered,
    agreementRate:considered?labeled.length/considered:null,
    coverage:rows.length?labeled.length/rows.length:0};
}
function wilsonLower(successes,n){
  if(!Number.isInteger(successes)||!Number.isInteger(n)||successes<0||successes>n||n<0)throw new Error('BINOMIAL_COUNTS_INVALID');
  if(n===0)return null;
  const z=1.959963984540054,p=successes/n,z2=z*z;
  return (p+z2/(2*n)-z*Math.sqrt((p*(1-p)+z2/(4*n))/n))/(1+z2/n);
}
function metrics(rows,category,model,threshold){
  if(!Number.isInteger(threshold)||threshold<0||threshold>100)throw new Error('THRESHOLD_INVALID');
  let tp=0,fp=0,fn=0,tn=0;
  for(const row of rows){
    const score=row.predictions?.[model]?.[category];
    if(!Number.isInteger(score)||score<0||score>100)throw new Error('SCORE_INVALID');
    const selected=row.eligible&&score>=threshold;
    if(selected&&row.positive)tp++;else if(selected)fp++;else if(row.positive)fn++;else tn++;
  }
  const selected=tp+fp,positives=tp+fn;
  return {n:rows.length,selected,tp,fp,fn,tn,
    precision:selected?tp/selected:null,recall:positives?tp/positives:null,
    selectedFraction:rows.length?selected/rows.length:null,
    precisionWilsonLower95:wilsonLower(tp,selected)};
}
function passes(m){return m.selected>=PROTOCOL.minimumSelected&&m.precision>=PROTOCOL.minimumPrecision&&
  m.precisionWilsonLower95>=PROTOCOL.minimumWilsonLower95;}
function lockThresholds(cohort,reviews,createdAt){
  createdAt=clock.instant(createdAt);
  if(!clock.instant(createdAt)||Date.parse(createdAt)>Date.now()||createdAt<cohort.observedAt)throw new Error('LOCK_TIME_INVALID');
  const v=validateReviews(cohort,reviews,'TUNING'),failures=v.errors.slice();
  if(v.reviewerCount<2)failures.push('TWO_INDEPENDENT_REVIEWERS_REQUIRED');
  if(reviews.some(e=>(e.judgments||[]).some(j=>clock.instant(j.reviewedAt)>createdAt)))failures.push('LOCK_PREDATES_TUNING_REVIEW');
  const tuning=cohort.rows.filter(r=>r.split==='TUNING'),categories={};
  for(const category of cohort.categories){
    const c=consensus(tuning,category,v.judgments),reasons=[];
    if(c.total<PROTOCOL.minimumTuningCases)reasons.push('TUNING_SAMPLE_TOO_SMALL');
    if(c.missing.length)reasons.push('TUNING_LABELS_INCOMPLETE');
    if(c.disagreements.length)reasons.push('TUNING_DISAGREEMENTS_UNRESOLVED');
    if(c.agreementRate===null||c.agreementRate<PROTOCOL.minimumReviewerAgreement)reasons.push('REVIEWER_AGREEMENT_INSUFFICIENT');
    const grid=reasons.length||v.errors.length?[]:PROTOCOL.thresholds.map(threshold=>({threshold,...metrics(c.rows,category,'v4',threshold)}));
    const viable=grid.filter(passes).sort((a,b)=>b.tp-a.tp||a.fp-b.fp||b.threshold-a.threshold);
    const choice=viable[0]||null;
    if(!reasons.length&&!choice)reasons.push('NO_THRESHOLD_JUSTIFIED');
    categories[category]={threshold:choice?.threshold??null,selectedMetrics:choice,
      baselineV3:c.rows.length?metrics(c.rows,category,'v3',60):null,
      labelCoverage:c.coverage,missing:c.missing.length,disagreements:c.disagreements.length,
      agreementRate:c.agreementRate,grid,failures:reasons};
    failures.push(...reasons.map(r=>category+':'+r));
  }
  if(cohort.isSynthetic)failures.push('SYNTHETIC_COHORT_NOT_REAL_REVIEW');
  const valid=failures.length===0;
  return sealed({version:VERSION,cohortId:cohort.cohortId,cohortFingerprint:cohort.fingerprint,
    protocolId:PROTOCOL.id,createdAt,reviewDigest:v.reviewDigest,reviewerIds:v.reviewerIds,
    categories,status:valid?'THRESHOLDS_LOCKED_NOT_PRODUCTION':'BLOCKED',
    failures:[...new Set(failures)].sort(),productionAuthorized:false,transportMode:'NO_SEND',
    limitations:'Tuning scores measure agreed source-evidence usefulness on the sampled site-group panel, not purchase intent, sales, population precision, or delivered-feed performance. Hashes are integrity checks, not signatures.'});
}
function evaluateHoldout(cohort,lock,reviews){
  if(!verify(lock)||lock.cohortFingerprint!==cohort.fingerprint||lock.status!=='THRESHOLDS_LOCKED_NOT_PRODUCTION'||
    lock.productionAuthorized!==false||lock.protocolId!==PROTOCOL.id)throw new Error('VALID_THRESHOLD_LOCK_REQUIRED');
  const v=validateReviews(cohort,reviews,'HOLDOUT',lock),failures=v.errors.slice(),categories={};
  if(v.reviewerCount<2)failures.push('TWO_INDEPENDENT_REVIEWERS_REQUIRED');
  const heldout=cohort.rows.filter(r=>r.split==='HOLDOUT');
  for(const category of cohort.categories){
    const threshold=lock.categories?.[category]?.threshold;
    if(!PROTOCOL.thresholds.includes(threshold))throw new Error('LOCKED_THRESHOLD_INVALID');
    const c=consensus(heldout,category,v.judgments),reasons=[];
    if(c.total<PROTOCOL.minimumHoldoutCases)reasons.push('HOLDOUT_SAMPLE_TOO_SMALL');
    if(c.missing.length)reasons.push('HOLDOUT_LABELS_INCOMPLETE');
    if(c.disagreements.length)reasons.push('HOLDOUT_DISAGREEMENTS_UNRESOLVED');
    if(c.agreementRate===null||c.agreementRate<PROTOCOL.minimumReviewerAgreement)reasons.push('REVIEWER_AGREEMENT_INSUFFICIENT');
    const evaluated=!reasons.length&&!v.errors.length?metrics(c.rows,category,'v4',threshold):null;
    const baseline=!reasons.length&&!v.errors.length?metrics(c.rows,category,'v3',60):null;
    if(evaluated&&!passes(evaluated))reasons.push('HELDOUT_PRECISION_OR_SUPPORT_FAILED');
    categories[category]={threshold,metrics:evaluated,baselineV3:baseline,
      missing:c.missing.length,disagreements:c.disagreements.length,agreementRate:c.agreementRate,failures:reasons};
    failures.push(...reasons.map(r=>category+':'+r));
  }
  if(cohort.isSynthetic)failures.push('SYNTHETIC_COHORT_NOT_REAL_REVIEW');
  return sealed({version:VERSION,cohortId:cohort.cohortId,cohortFingerprint:cohort.fingerprint,
    thresholdLockFingerprint:lock.fingerprint,reviewDigest:v.reviewDigest,categories,
    status:failures.length?'HOLDOUT_BLOCKED_OR_FAILED':'ELIGIBLE_FOR_MANUAL_REVIEW_ONLY',
    failures:[...new Set(failures)].sort(),productionAuthorized:false,transportMode:'NO_SEND',
    remainingGates:['VERIFY_REVIEWER_IDENTITY_AND_INDEPENDENCE','ACTUAL_LONGITUDINAL_REFRESH_EVIDENCE',
      'EVENT_ELIGIBILITY_AND_SUBSCRIBER_FEED_VALIDATION','EXPLICIT_NEW_VERSION_PROMOTION'],
    limitation:'One prespecified threshold per category was assessed. Do not retune against this holdout; reuse would make it development data. A pass never changes production policy.'});
}
module.exports={VERDICTS,REVIEWER_ROLES,validateReviews,consensus,wilsonLower,metrics,passes,lockThresholds,evaluateHoldout};
