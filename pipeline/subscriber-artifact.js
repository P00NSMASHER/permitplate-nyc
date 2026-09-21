'use strict';

const crypto=require('crypto');
const opportunity=require('./opportunity-ledger');
const profiles=require('./subscriber-profile');

const SUBSCRIBER_ARTIFACT_VERSION='PermitPlate-subscriber-artifact-v1.0.0';
const DAY_MS=24*60*60*1000;

const CSV_HEADERS=Object.freeze([
  'Signal Key','Delivery Class','Detected At','Detection Class',
  'Business','Address','Borough','ZIP','Stage',
  'Commercial Fit','Selected Category','Selected Score',
  'POS Score','Insurance Score','Equipment Score','Hood/Fire Score',
  'Waste Score','Pest Score','Linen Score','Distribution Score',
  'Best Vendor Fit','Best Score','Source Systems','Source Record IDs',
  'Evidence Tags','Source URLs','Package ID'
]);

function stableStringify(value){
  if(Array.isArray(value)) return '['+value.map(stableStringify).join(',')+']';
  if(value&&typeof value==='object'){
    return '{'+Object.keys(value).sort()
      .map((key)=>JSON.stringify(key)+':'+stableStringify(value[key])).join(',')+'}';
  }
  return JSON.stringify(value);
}
function sha256(value){
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}
function text(value){
  return value==null?'':String(value).trim();
}
function timeMs(value){
  const ms=Date.parse(text(value));
  return Number.isFinite(ms)?ms:null;
}
function profileEnvelope(input){
  if(input&&input.status==='ACTIVE'&&input.profile&&input.profileFingerprint) return input;
  return profiles.normalizeProfile(input);
}
function validScore(value){
  const n=Number(value);
  return Number.isInteger(n)&&n>=0&&n<=100?n:null;
}
function selectCategoryScore(packageReceipt,categories){
  const scores=packageReceipt&&packageReceipt.scores||{};
  const choices=(categories||[]).map((category)=>({
    category,
    score:validScore(scores[category])
  })).filter((item)=>item.score!==null);

  choices.sort((a,b)=>
    b.score-a.score ||
    profiles.CATEGORY_ORDER.indexOf(a.category)-profiles.CATEGORY_ORDER.indexOf(b.category)
  );
  return choices[0]||null;
}
function boroughMatches(packageReceipt,profile){
  return (profile.boroughs||[]).includes(text(packageReceipt&&packageReceipt.borough));
}
function eventDetectedAt(entry){
  return entry&&(
    entry.detectedAt ||
    entry.package&&entry.package.detectedAt ||
    entry.package&&entry.package.detectionReceipt&&(
      entry.package.detectionReceipt.materialChangeAt ||
      entry.package.detectionReceipt.firstDetectedAt ||
      entry.package.detectionReceipt.reopenAt
    )
  ) || null;
}
function signalKey(profile,deliveryClass,eventKey){
  if(deliveryClass==='STARTER'){
    return `starter:${profile.subscriberId}:${profile.baselineAt}:${eventKey}`;
  }
  return `normal:${profile.subscriberId}:${eventKey}`;
}
function evidenceTags(packageReceipt){
  return Array.from(new Set((packageReceipt&&packageReceipt.commercialEvidence||[])
    .map((item)=>text(item&&item.tag))
    .filter(Boolean))).sort();
}
function sourceUrls(packageReceipt){
  return Array.from(new Set((packageReceipt&&packageReceipt.sourceUrls||[])
    .map(text).filter((url)=>/^https:\/\//i.test(url)))).sort();
}
function sourceRecordIds(packageReceipt){
  return Array.from(new Set((packageReceipt&&packageReceipt.sourceRecordIds||[])
    .map(text).filter(Boolean))).sort();
}
function sourceSystems(packageReceipt){
  return Array.from(new Set((packageReceipt&&packageReceipt.sourceSystems||[])
    .map(text).filter(Boolean))).sort();
}
function rowFromSelection(selection){
  const p=selection.package;
  const scores=p.scores||{};
  return {
    'Signal Key':selection.signalKey,
    'Delivery Class':selection.deliveryClass,
    'Detected At':selection.detectedAt,
    'Detection Class':p.detectionClass||'',
    'Business':p.businessName||'',
    'Address':p.address||'',
    'Borough':p.borough||'',
    'ZIP':p.zip||'',
    'Stage':p.lifecycleStage||'',
    'Commercial Fit':p.commercialFit||'',
    'Selected Category':selection.selectedCategory,
    'Selected Score':selection.selectedScore,
    'POS Score':scores.POS,
    'Insurance Score':scores.Insurance,
    'Equipment Score':scores.Equipment,
    'Hood/Fire Score':scores['Hood/Fire'],
    'Waste Score':scores.Waste,
    'Pest Score':scores.Pest,
    'Linen Score':scores.Linen,
    'Distribution Score':scores.Distribution,
    'Best Vendor Fit':p.bestVendorFit||'',
    'Best Score':p.bestScore,
    'Source Systems':sourceSystems(p).join('; '),
    'Source Record IDs':sourceRecordIds(p).join(' | '),
    'Evidence Tags':evidenceTags(p).join('; '),
    'Source URLs':sourceUrls(p).join(' | '),
    'Package ID':p.packageId||''
  };
}
function emailRowFromCsv(row){
  return {
    signalKey:row['Signal Key'],
    deliveryClass:row['Delivery Class'],
    detectedAt:row['Detected At'],
    headline:[row.Business,row.Address].filter(Boolean).join(' — '),
    stage:row.Stage,
    category:row['Selected Category'],
    score:row['Selected Score'],
    fit:row['Commercial Fit'],
    evidenceTags:row['Evidence Tags'],
    sourceSystems:row['Source Systems'],
    sourceUrls:row['Source URLs'],
    packageId:row['Package ID']
  };
}
function neutralizeFormula(value){
  if(typeof value!=='string') return value;
  return /^[=+\-@]/.test(value)?"'"+value:value;
}
function escapeCsv(value){
  let v=neutralizeFormula(value);
  if(v===null||v===undefined) v='';
  v=String(v);
  if(/[",\r\n]/.test(v)) return '"'+v.replace(/"/g,'""')+'"';
  return v;
}
function toCsv(rows){
  const lines=[CSV_HEADERS.map(escapeCsv).join(',')];
  for(const row of rows){
    lines.push(CSV_HEADERS.map((header)=>escapeCsv(row[header])).join(','));
  }
  return '\uFEFF'+lines.join('\r\n')+'\r\n';
}
function selectionSort(a,b){
  return b.selectedScore-a.selectedScore ||
    text(b.detectedAt).localeCompare(text(a.detectedAt)) ||
    text(a.eventKey).localeCompare(text(b.eventKey));
}

function buildSubscriberArtifact(input){
  const data=input||{};
  const normalized=profileEnvelope(data.profile);
  if(normalized.status!=='ACTIVE'){
    return {
      artifactVersion:SUBSCRIBER_ARTIFACT_VERSION,
      status:'REVIEW',
      failures:['PROFILE_NOT_ACTIVE',...(normalized.failures||[])],
      profileFingerprint:normalized.profileFingerprint||null,
      rows:[],
      emailRows:[],
      csvRows:[],
      csv:null
    };
  }
  const profile=normalized.profile;
  const ledger=data.opportunityLedger;
  const ledgerValidation=opportunity.validateLedger(ledger);
  if(!ledgerValidation.valid){
    return {
      artifactVersion:SUBSCRIBER_ARTIFACT_VERSION,
      status:'REVIEW',
      failures:['OPPORTUNITY_LEDGER_INVALID',...ledgerValidation.errors],
      profileFingerprint:normalized.profileFingerprint,
      rows:[],
      emailRows:[],
      csvRows:[],
      csv:null
    };
  }

  const baseline=timeMs(profile.baselineAt);
  const lower=baseline-profile.starterDays*DAY_MS;
  const delivered=data.deliveredSignalKeys instanceof Set?
    data.deliveredSignalKeys:new Set(data.deliveredSignalKeys||[]);

  const normal=[];
  const starter=[];
  const excluded=[];
  const review=[];

  for(const entry of Object.values(ledger.entries||{})){
    const p=entry&&entry.package;
    const reasons=[];
    if(!p||p.status!=='READY_FOR_PROFILE_MATCHING'||p.productionAuthorized!==true){
      reasons.push('PACKAGE_NOT_PRODUCTION_READY');
    }
    if(p&&p.commercialFit==='EXCLUDE') reasons.push('COMMERCIAL_FIT_EXCLUDED');
    if(p&&!boroughMatches(p,profile)) reasons.push('BOROUGH_FILTERED');

    const selected=p?selectCategoryScore(p,profile.categories):null;
    if(p&&!selected) reasons.push('CATEGORY_SCORE_UNAVAILABLE');
    if(selected&&selected.score<profile.minimumScore) reasons.push('BELOW_SCORE_THRESHOLD');

    const detectedAt=eventDetectedAt(entry);
    const detected=timeMs(detectedAt);
    if(detected===null) reasons.push('DETECTION_TIME_INVALID');

    if(reasons.length){
      const hard=reasons.some((reason)=>
        reason.includes('NOT_PRODUCTION_READY') ||
        reason.includes('UNAVAILABLE') ||
        reason.includes('INVALID')
      );
      (hard?review:excluded).push({eventKey:entry.eventKey||null,reasons});
      continue;
    }

    let deliveryClass=null;
    if(detected>=baseline){
      deliveryClass='NORMAL';
    }else if(profile.starterSnapshotEnabled&&detected>=lower&&detected<baseline){
      deliveryClass='STARTER';
    }else{
      excluded.push({
        eventKey:entry.eventKey,
        reasons:[detected<baseline?'PRE_BASELINE_NOT_IN_STARTER_WINDOW':'NOT_ELIGIBLE']
      });
      continue;
    }

    const key=signalKey(profile,deliveryClass,entry.eventKey);
    if(delivered.has(key)){
      excluded.push({eventKey:entry.eventKey,reasons:['ALREADY_DELIVERED'],signalKey:key});
      continue;
    }

    const selection={
      eventKey:entry.eventKey,
      signalKey:key,
      deliveryClass,
      detectedAt:new Date(detected).toISOString(),
      selectedCategory:selected.category,
      selectedScore:selected.score,
      package:p
    };
    (deliveryClass==='NORMAL'?normal:starter).push(selection);
  }

  normal.sort(selectionSort);
  starter.sort(selectionSort);

  const selectedNormal=normal.slice(0,profile.maxSignals);
  const remaining=Math.max(0,profile.maxSignals-selectedNormal.length);
  const selectedStarter=starter.slice(0,Math.min(profile.starterLimit,remaining));
  const selections=selectedNormal.concat(selectedStarter);
  const csvRows=selections.map(rowFromSelection);
  const emailRows=csvRows.map(emailRowFromCsv);

  const csvSignalKeys=csvRows.map((row)=>row['Signal Key']);
  const emailSignalKeys=emailRows.map((row)=>row.signalKey);
  if(stableStringify(csvSignalKeys)!==stableStringify(emailSignalKeys)){
    throw new Error('EMAIL_CSV_SIGNAL_PARITY_FAIL');
  }

  const artifactCore={
    artifactVersion:SUBSCRIBER_ARTIFACT_VERSION,
    profileFingerprint:normalized.profileFingerprint,
    opportunityLedgerFingerprint:ledger.ledgerFingerprint,
    subscriberId:profile.subscriberId,
    baselineAt:profile.baselineAt,
    categories:profile.categories,
    boroughs:profile.boroughs,
    minimumScore:profile.minimumScore,
    normalCount:selectedNormal.length,
    starterCount:selectedStarter.length,
    signalKeys:csvSignalKeys,
    csvRows
  };
  const artifactFingerprint=sha256(stableStringify(artifactCore));
  const date=(data.reportDate||new Date().toISOString().slice(0,10));
  const filename=`permitplate-nyc-${date}.csv`;

  return {
    artifactVersion:SUBSCRIBER_ARTIFACT_VERSION,
    status:'READY',
    failures:[],
    profileFingerprint:normalized.profileFingerprint,
    opportunityLedgerFingerprint:ledger.ledgerFingerprint,
    subscriberId:profile.subscriberId,
    recipientEmail:profile.recipientEmail,
    baselineAt:profile.baselineAt,
    normalCount:selectedNormal.length,
    starterCount:selectedStarter.length,
    signalCount:selections.length,
    rows:csvRows,
    csvRows,
    emailRows,
    csv:toCsv(csvRows),
    filename,
    excluded,
    review,
    signalKeys:csvSignalKeys,
    artifactFingerprint
  };
}

module.exports={
  SUBSCRIBER_ARTIFACT_VERSION,
  DAY_MS,
  CSV_HEADERS,
  stableStringify,
  sha256,
  text,
  timeMs,
  profileEnvelope,
  validScore,
  selectCategoryScore,
  boroughMatches,
  eventDetectedAt,
  signalKey,
  evidenceTags,
  sourceUrls,
  sourceRecordIds,
  sourceSystems,
  rowFromSelection,
  emailRowFromCsv,
  neutralizeFormula,
  escapeCsv,
  toCsv,
  selectionSort,
  buildSubscriberArtifact
};
