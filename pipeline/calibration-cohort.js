'use strict';

// Read-only research boundary. Nothing produced here authorizes a score or send.
const {createHash}=require('node:crypto');
const v3=require('./shadow-scoring-v3');
const v4=require('./shadow-scoring-v4');
const clock=require('./event-time');
const VERSION='PermitPlate-blind-calibration-v1.0.0';
const PROTOCOL=Object.freeze({
  id:'PermitPlate-category-relevance-protocol-v1',
  target:'EVIDENCE_JUSTIFIES_VENDOR_RESEARCH_NOW_NOT_PURCHASE_PROBABILITY',
  population:'ONE_ELIGIBLE_ENTITY_PER_SITE_GROUP_IN_ONE_CURRENT_GRAPH_NOT_DELIVERED_FEED',
  thresholds:Object.freeze([30,35,40,45,50,55,60,65,70,75,80]),
  minimumTuningCases:50,minimumHoldoutCases:30,minimumSelected:20,
  minimumPrecision:0.8,minimumWilsonLower95:0.6,
  minimumReviewerAgreement:0.8,
  currentDefaultThreshold:60,
  automaticPromotion:false
});
const stable=clock.stable;
const hash=value=>createHash('sha256').update(stable(value)).digest('hex');
const text=v=>typeof v==='string'?v.trim():'';
const normalize=v=>text(v).toUpperCase().replace(/\s+/g,' ');
const safeUrl=value=>{
  try{const u=new URL(value);return u.protocol==='https:'&&
    ['data.cityofnewyork.us','data.ny.gov'].includes(u.hostname)&&
    !u.username&&!u.password&&!u.port?u.href:null;}
  catch{return null;}
};
function sealed(body,field='fingerprint'){return {...body,[field]:hash(body)};}
function verify(value,field='fingerprint'){
  if(!value||typeof value!=='object'||!value[field]) return false;
  const {[field]:expected,...body}=value;return expected===hash(body);
}
function siteKey(candidate){
  const c=candidate||{},borough=normalize(c.borough),address=normalize(c.address);
  // This is an evaluation grouping constraint, NOT an entity-resolution rule.
  return borough&&address?'SITE:'+borough+'|'+address:'ENTITY:'+text(c.entityId);
}
function sourceCard(record){
  const f=record.facts||{};
  // Deliberate allowlist: no phone, email, officer, owner, applicant or contact fields.
  const fields=record.sourceSystem==='DOHMH'?['inspection_date','inspection_type','action','cuisine_description']:
    record.sourceSystem==='SLA_PENDING'?['received_date','status','description']:
    record.sourceSystem==='DOB_NOW'?['filing_date','filing_status','job_description','work_on_floor','work_types','initial_cost_number']:[];
  return {sourceSystem:record.sourceSystem,recordId:record.sourceRecordId,
    sourceUrl:safeUrl(record.sourceUrl),eventType:record.eventType||null,
    facts:Object.fromEntries(fields.filter(k=>f[k]!==undefined&&f[k]!==null&&f[k]!=='')
      .map(k=>[k,typeof f[k]==='number'?f[k]:String(f[k]).slice(0,2400)]))};
}
function diagnosticBucket(item){
  if(!item.eligible) return 'SUPPRESSION_OR_REVIEW';
  if(item.chronology.status==='KNOWN') return 'DATED_EVIDENCE';
  if(Object.keys(item.predictions.v3).some(k=>item.predictions.v3[k]>=60&&item.predictions.v4[k]<60)) return 'CUTOFF_DISAGREEMENT';
  return 'UNDATED_OTHER';
}
function buildCohort({graph,batches,observedAt,sourceRevision,codeHashes,seed='permitplate-issue10-v1',
  categories=['POS','Insurance','Equipment'],benchmarkSize=100,diagnosticSize=24,isSynthetic=false}){
  if(graph?.graphState!=='COMPLETE'||!text(graph.graphDigest)) throw new Error('COMPLETE_GRAPH_REQUIRED');
  if(!clock.instant(observedAt)) throw new Error('VALID_OBSERVATION_REQUIRED');
  observedAt=clock.instant(observedAt);
  if(!/^[a-f0-9]{40}$/.test(sourceRevision||'')) throw new Error('EXACT_SOURCE_REVISION_REQUIRED');
  if(!codeHashes||Object.keys(codeHashes).length<3||Object.values(codeHashes).some(h=>!/^[a-f0-9]{64}$/.test(h))) throw new Error('CODE_HASHES_REQUIRED');
  if(!Array.isArray(categories)||!categories.length||new Set(categories).size!==categories.length||categories.some(c=>!v4.CATEGORIES.includes(c))) throw new Error('CATEGORIES_INVALID');
  if(!Number.isInteger(benchmarkSize)||benchmarkSize<2||benchmarkSize>500||!Number.isInteger(diagnosticSize)||diagnosticSize<0||diagnosticSize>100) throw new Error('SAMPLE_SIZE_INVALID');
  const records=v3.sourceMap(Object.values(batches||{}).flatMap(b=>b.records||[]));
  const seen=new Set(),items=[];
  for(const c of graph.candidates||[]){
    if(!text(c.entityId)||seen.has(c.entityId)) throw new Error('ENTITY_ID_MISSING_OR_DUPLICATE');
    seen.add(c.entityId);
    const before=v3.computeShadowScores(c,records,observedAt),after=v4.computeShadowScores(c,records,observedAt);
    const chronology=after.eventChronology||clock.describe(c,records,observedAt);
    const accepted=clock.acceptedSources(c,records);
    const eligible=after.status==='SHADOW_SCORED'&&before.status==='SHADOW_SCORED'&&
      after.fitReceipt?.fit!=='EXCLUDE'&&c.deliverySuppressed!==true&&!(c.crossCamisOperationalConflicts||[]).length;
    const card={businessName:text(c.canonicalName),address:text(c.address),borough:text(c.borough),
      stage:clock.customerStage(c.lifecycleStage),businessEventDate:chronology.latestKnownEventDate,
      eventDateBasis:chronology.eventDateBasis,eventTimeStatus:chronology.status,
      inspectedAsOf:clock.nycDate(observedAt),
      identityCaveat:c.deliverySuppressed===true||(c.crossCamisOperationalConflicts||[]).length?
        'Conflicting business identity at these premises; requires resolution.':null,
      chronologyLimitation:chronology.limitation,
      evidence:accepted.records.map(sourceCard)};
    items.push({entityId:c.entityId,groupId:hash(siteKey(c)),eligible,chronology,
      evidenceFingerprint:hash(card),card,
      predictions:{v3:before.status==='SHADOW_SCORED'?before.scores:{},v4:after.status==='SHADOW_SCORED'?after.scores:{}}});
  }
  const groups=new Map();
  for(const item of items.filter(i=>i.eligible)){
    if(!groups.has(item.groupId)) groups.set(item.groupId,[]);groups.get(item.groupId).push(item);
  }
  const ordered=[...groups.keys()].sort((a,b)=>hash([seed,'sample',a]).localeCompare(hash([seed,'sample',b])));
  const representatives=ordered.slice(0,benchmarkSize).map(g=>groups.get(g).slice().sort((a,b)=>
    hash([seed,'representative',a.entityId]).localeCompare(hash([seed,'representative',b.entityId])))[0]);
  const holdoutCount=Math.ceil(representatives.length*0.3);
  const splitOrder=representatives.slice().sort((a,b)=>hash([seed,'split',a.groupId]).localeCompare(hash([seed,'split',b.groupId])));
  const holdout=new Set(splitOrder.slice(0,holdoutCount).map(i=>i.groupId));
  const used=new Set(representatives.map(i=>i.groupId));
  const diagnosticCandidates=items.filter(i=>!used.has(i.groupId)).sort((a,b)=>
    hash([seed,'diagnostic',a.entityId]).localeCompare(hash([seed,'diagnostic',b.entityId])));
  const bucketNames=['SUPPRESSION_OR_REVIEW','DATED_EVIDENCE','CUTOFF_DISAGREEMENT','UNDATED_OTHER'];
  const buckets=Object.fromEntries(bucketNames.map(name=>[name,diagnosticCandidates.filter(i=>diagnosticBucket(i)===name)]));
  const diagnostics=[];
  while(diagnostics.length<diagnosticSize){
    let progress=false;
    for(const name of bucketNames){
      let next;
      while(buckets[name].length&&!next){const v=buckets[name].shift();if(!used.has(v.groupId))next=v;}
      if(next){used.add(next.groupId);diagnostics.push(next);progress=true;}
      if(diagnostics.length>=diagnosticSize)break;
    }
    if(!progress)break;
  }
  const rows=representatives.map(item=>({...item,panel:'BENCHMARK',split:holdout.has(item.groupId)?'HOLDOUT':'TUNING'}))
    .concat(diagnostics.map(item=>({...item,panel:'DIAGNOSTIC',split:'DIAGNOSTIC'})))
    .map(({chronology,...item})=>({...item,caseId:'CASE-'+hash([seed,item.entityId,item.evidenceFingerprint]).slice(0,20)}))
    .sort((a,b)=>a.caseId.localeCompare(b.caseId));
  const counts={graphCandidates:items.length,eligibleCandidates:items.filter(i=>i.eligible).length,
    eligibleSiteGroups:groups.size,benchmark:representatives.length,holdout:holdoutCount,
    tuning:representatives.length-holdoutCount,diagnostic:diagnostics.length};
  return sealed({version:VERSION,cohortId:'COHORT-'+hash([graph.graphDigest,seed,sourceRevision,categories,codeHashes]).slice(0,24),
    observedAt,sourceRevision,graphDigest:graph.graphDigest,codeHashes,seed,categories,protocol:PROTOCOL,
    isSynthetic:isSynthetic===true,population:PROTOCOL.population,
    sampling:'Deterministic uniform hash sample of site groups, one hash-selected eligible entity per group; diagnostic oversampling excluded from threshold metrics.',
    counts,rows,productionAuthorized:false,transportMode:'NO_SEND'});
}
function validateCohort(cohort){
  if(!verify(cohort)||cohort.version!==VERSION||cohort.productionAuthorized!==false||
    cohort.transportMode!=='NO_SEND'||stable(cohort.protocol)!==stable(PROTOCOL)) throw new Error('COHORT_INTEGRITY_INVALID');
  if(!Array.isArray(cohort.categories)||!cohort.categories.length||
    new Set(cohort.categories).size!==cohort.categories.length||
    cohort.categories.some(category=>!v4.CATEGORIES.includes(category))) throw new Error('COHORT_CATEGORIES_INVALID');
  if(!Array.isArray(cohort.rows))throw new Error('COHORT_ROWS_INVALID');
  const groups=new Map(),ids=new Set(),entities=new Set();
  const actual={benchmark:0,tuning:0,holdout:0,diagnostic:0};
  for(const row of cohort.rows){
    if(!row||!text(row.caseId)||!text(row.entityId)||typeof row.eligible!=='boolean'||
      !row.card||typeof row.card!=='object'||Array.isArray(row.card))throw new Error('COHORT_ROW_INVALID');
    if(ids.has(row.caseId))throw new Error('DUPLICATE_CASE');ids.add(row.caseId);
    if(entities.has(row.entityId))throw new Error('DUPLICATE_ENTITY');entities.add(row.entityId);
    if(groups.has(row.groupId)){
      if(groups.get(row.groupId)!==row.split)throw new Error('SITE_SPLIT_LEAKAGE');
      // Even within one split, a repeated site is not independent sample support.
      throw new Error('DUPLICATE_SITE_GROUP');
    }
    groups.set(row.groupId,row.split);
    if(!['BENCHMARK','DIAGNOSTIC'].includes(row.panel)||!['TUNING','HOLDOUT','DIAGNOSTIC'].includes(row.split))throw new Error('PANEL_OR_SPLIT_INVALID');
    if(row.panel==='BENCHMARK'&&!['TUNING','HOLDOUT'].includes(row.split))throw new Error('BENCHMARK_SPLIT_INVALID');
    if(row.panel==='DIAGNOSTIC'&&row.split!=='DIAGNOSTIC')throw new Error('DIAGNOSTIC_SPLIT_INVALID');
    if(row.panel==='BENCHMARK'&&!row.eligible)throw new Error('INELIGIBLE_BENCHMARK_CASE');
    if(hash(row.card)!==row.evidenceFingerprint)throw new Error('EVIDENCE_FINGERPRINT_MISMATCH');
    actual[row.panel==='BENCHMARK'?'benchmark':'diagnostic']++;
    if(row.split==='TUNING')actual.tuning++;
    if(row.split==='HOLDOUT')actual.holdout++;
    if(row.eligible){
      for(const model of ['v3','v4'])for(const category of cohort.categories){
        const score=row.predictions?.[model]?.[category];
        if(!Number.isInteger(score)||score<0||score>100)throw new Error('BENCHMARK_PREDICTION_INVALID');
      }
    }
  }
  // Check derived group bindings after duplicate/split checks for actionable errors.
  for(const row of cohort.rows){
    if(row.groupId!==hash(siteKey({entityId:row.entityId,borough:row.card.borough,address:row.card.address}))){
      throw new Error('SITE_GROUP_BINDING_INVALID');
    }
  }
  const counts=cohort.counts,fields=['graphCandidates','eligibleCandidates','eligibleSiteGroups',...Object.keys(actual)];
  if(!counts||fields.some(key=>!Number.isInteger(counts[key])||counts[key]<0)||
    Object.entries(actual).some(([key,value])=>counts[key]!==value)||
    counts.graphCandidates<cohort.rows.length||counts.graphCandidates<counts.eligibleCandidates||
    counts.eligibleCandidates<counts.eligibleSiteGroups||counts.eligibleSiteGroups<counts.benchmark||
    counts.holdout!==Math.ceil(counts.benchmark*0.3)||counts.tuning+counts.holdout!==counts.benchmark){
    throw new Error('COHORT_COUNTS_INVALID');
  }
  return cohort;
}
function blindPacket(cohort,phase='TUNING',lock=null){
  validateCohort(cohort);
  if(!['TUNING','HOLDOUT'].includes(phase))throw new Error('REVIEW_PHASE_INVALID');
  if(phase==='HOLDOUT'&&(!verify(lock)||lock.cohortFingerprint!==cohort.fingerprint||
    lock.status!=='THRESHOLDS_LOCKED_NOT_PRODUCTION'))throw new Error('HOLDOUT_REQUIRES_THRESHOLD_LOCK');
  const rows=cohort.rows.filter(r=>phase==='HOLDOUT'?r.split==='HOLDOUT':r.split!=='HOLDOUT');
  return sealed({version:VERSION,cohortId:cohort.cohortId,cohortFingerprint:cohort.fingerprint,phase,
    lockFingerprint:phase==='HOLDOUT'?lock.fingerprint:null,categories:cohort.categories,
    isSynthetic:cohort.isSynthetic,observedAt:cohort.observedAt,
    cards:rows.map(r=>({caseId:r.caseId,evidenceFingerprint:r.evidenceFingerprint,...r.card})),
    // No scores, model names, threshold membership, sampling bucket, fit, or split.
    instructions:'Judge the source evidence independently. PURSUE_NOW means worth researching now, not confirmed buying intent. WATCH is plausible fit without timely action evidence. NOT_RELEVANT is wrong-fit/identity. INSUFFICIENT_EVIDENCE is a valid negative actionability judgment. Explain with source record IDs. Do not contact anyone.'});
}
module.exports={VERSION,PROTOCOL,stable,hash,sealed,verify,siteKey,sourceCard,buildCohort,validateCohort,blindPacket};
