'use strict';

// Transparent, evidence-bound review triage. A keyword or applicant record
// never proves a vendor need, buying intent or an opening date.
const crypto=require('node:crypto');
const profiles=require('./subscriber-profile');
const curated=require('./founder-curated-offer');

const VERSION='PermitPlate-category-evidence-v1.0.0';
const TAGS_BY_CATEGORY=Object.freeze({
  'Equipment':'EQUIPMENT',
  'Hood/Fire':'HOOD_FIRE',
  'Waste':'WASTE'
});
const ACCEPTED_SYSTEMS=new Set(['DOHMH','DOB_NOW','SLA_PENDING']);

function stable(value){
  if(Array.isArray(value)) return '['+value.map(stable).join(',')+']';
  if(value&&typeof value==='object'){
    return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';
  }
  return JSON.stringify(value);
}
function hash(value){
  return crypto.createHash('sha256').update(stable(value)).digest('hex');
}
function text(value){return value==null?'':String(value).trim();}
function primaryUrl(candidate){
  const camis=text(candidate&&candidate.camis);
  return /^\d+$/.test(camis)?
    'https://data.cityofnewyork.us/resource/43nn-pn8j.json?camis='+encodeURIComponent(camis):
    null;
}
function supportedRecord(candidate,item){
  const id=text(item&&item.sourceRecordId);
  const system=text(item&&item.sourceSystem);
  if(!id||!ACCEPTED_SYSTEMS.has(system)||
    !curated.officialSourceUrl(item&&item.sourceUrl)) return false;
  const systems=Array.isArray(candidate&&candidate.sourceSystems)?
    candidate.sourceSystems:[];
  if(!systems.includes(system)) return false;
  if(system==='DOHMH'){
    return /^\d+$/.test(text(candidate&&candidate.camis)) &&
      id.startsWith('DOHMH:'+text(candidate.camis)+':');
  }
  return Array.isArray(candidate&&candidate.acceptedCorroboration) &&
    candidate.acceptedCorroboration.some(row=>
      text(row&&row.sourceRecordId)===id &&
      text(row&&row.sourceSystem)===system &&
      text(row&&row.sourceUrl)===text(item.sourceUrl));
}
function knownUrls(candidate){
  const urls=[];
  const primary=primaryUrl(candidate);
  if(primary) urls.push(primary);
  for(const row of candidate&&candidate.acceptedCorroboration||[]){
    if(supportedRecord(candidate,row)) urls.push(text(row.sourceUrl));
  }
  return [...new Set(urls)].sort();
}
function classify(candidate,categoryInput){
  const category=profiles.canonicalCategory(categoryInput);
  if(!category) return {
    version:VERSION,status:'REVIEW',category:null,
    sourceEvidence:[],sourceUrls:[],manualReviewRequired:true,
    evidenceFingerprint:hash({version:VERSION,category:null,status:'REVIEW'})
  };
  const c=candidate||{};
  const expectedTag=TAGS_BY_CATEGORY[category]||null;
  const refs=[];
  for(const evidence of Array.isArray(c.commercialEvidence)?c.commercialEvidence:[]){
    if(!expectedTag||evidence.tag!==expectedTag ||
      !supportedRecord(c,evidence) ||
      !Array.isArray(evidence.matchedPatterns) ||
      !evidence.matchedPatterns.some(pattern=>text(pattern))) continue;
    refs.push({
      tag:expectedTag,
      sourceSystem:text(evidence.sourceSystem),
      sourceRecordId:text(evidence.sourceRecordId),
      sourceUrl:text(evidence.sourceUrl),
      matchedPatterns:[...new Set(evidence.matchedPatterns.map(text).filter(Boolean))].sort()
    });
  }
  // Never turn an arbitrary source-specific keyword into another category's
  // claim, and do not treat mere multi-source co-location as a verified match.
  const sourceEvidence=[...new Map(refs.map(row=>[stable(row),row])).values()]
    .sort((a,b)=>stable(a).localeCompare(stable(b)));
  const sourceUrls=knownUrls(c);
  const acceptedOther=Array.isArray(c.acceptedCorroboration)&&
    c.acceptedCorroboration.some(record=>supportedRecord(c,record));
  const status=sourceEvidence.length?'SOURCE_KEYWORD_CONTEXT':
    acceptedOther?'RELATED_OFFICIAL_ACTIVITY':'APPLICANT_CONTEXT_ONLY';
  const core={
    version:VERSION,category,status,sourceEvidence,
    sourceUrls,
    entityId:text(c.entityId),
    sourceSystems:Array.isArray(c.sourceSystems)?[...new Set(c.sourceSystems)].sort():[]
  };
  return {...core,manualReviewRequired:true,evidenceFingerprint:hash(core)};
}
function validateFounderReview(candidate,category,review){
  const evidence=classify(candidate,category);
  const check=review||{};
  const failures=[];
  if(evidence.status==='REVIEW') failures.push('CATEGORY_INVALID');
  if(check.approved!==true) failures.push('CATEGORY_FIT_NOT_APPROVED');
  if(check.evidenceFingerprint!==evidence.evidenceFingerprint){
    failures.push('CATEGORY_EVIDENCE_STALE');
  }
  const rationale=text(check.rationale);
  if(rationale.length<30) failures.push('CATEGORY_FIT_RATIONALE_TOO_SHORT');
  if(rationale.length>220) failures.push('CATEGORY_FIT_RATIONALE_TOO_LONG');
  if(curated.forbiddenClaim(rationale)) failures.push('CATEGORY_FIT_CLAIM_UNSUPPORTED');
  const url=text(check.sourceUrl);
  const linked=evidence.status==='SOURCE_KEYWORD_CONTEXT'?
    evidence.sourceEvidence.map(row=>row.sourceUrl):evidence.sourceUrls;
  if(!curated.officialSourceUrl(url) || !linked.includes(url)){
    failures.push('CATEGORY_REVIEW_SOURCE_NOT_BOUND');
  }
  return {
    valid:failures.length===0,
    failures,
    evidence,
    category:evidence.category,
    basis:evidence.status,
    rationale,
    sourceUrl:url
  };
}
module.exports={
  VERSION,TAGS_BY_CATEGORY,ACCEPTED_SYSTEMS,stable,hash,text,
  primaryUrl,supportedRecord,knownUrls,classify,validateFounderReview
};
