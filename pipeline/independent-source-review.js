'use strict';

// Early DOB/SLA research before a health-department CAMIS match exists.
// Every result is PRIVATE, REVIEW_ONLY and ineligible for customer delivery.
const crypto=require('node:crypto');
const profiles=require('./subscriber-profile');
const research=require('./curated-research-ledger');

const VERSION='PermitPlate-independent-source-review-v1.0.0';
const MAX_ITEMS=300;
const DOB_DAYS=30; // Source query itself is a narrower rolling 14-day window.
const SLA_DAYS=45;
const BOROUGHS=new Set(profiles.BOROUGH_ORDER);
const DOB_TERMS=Object.freeze([
  ['RESTAURANT',/\brestaurants?\b/i],
  ['COMMERCIAL_KITCHEN',/\bcommercial\s+kitchen\b/i],
  ['FOOD_SERVICE',/\bfood[ -]?service\b/i],
  ['CAFE',/\bcaf[eé]\b/i],
  ['COFFEE_SHOP',/\bcoffee\s+shop\b/i],
  ['PIZZERIA',/\bpizzeria\b/i],
  ['BAKERY',/\bbaker(?:y|ies)\b/i],
  ['EATING_DRINKING_ESTABLISHMENT',/\beating\s+and\s+drinking\s+establishment\b/i]
]);
const SLA_TERMS=Object.freeze([
  ['RESTAURANT',/\brestaurants?\b/i],
  ['TAVERN',/\btavern\b/i],
  ['ON_PREMISES',/\bon[ -]?premises\b/i],
  ['EATING_PLACE',/\beating\s+place\b/i],
  ['WINE_BAR',/\bwine\s+bar\b/i],
  ['BREWPUB',/\bbrewpub\b/i]
]);
function text(value){return value==null?'':String(value).trim()}
function stable(value){
  if(Array.isArray(value)) return '['+value.map(stable).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort()
    .map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')+'}';
  return JSON.stringify(value);
}
function hash(value){return crypto.createHash('sha256').update(stable(value)).digest('hex')}
function date(value){
  const ms=Date.parse(text(value));
  return Number.isFinite(ms)?new Date(ms).toISOString():null;
}
function within(value,observed,days){
  const at=Date.parse(text(value)),now=Date.parse(text(observed));
  return Number.isFinite(at)&&Number.isFinite(now)&&
    at<=now && at>=now-days*24*3600*1000;
}
function hits(value,rules){
  return rules.filter(([,pattern])=>pattern.test(text(value))).map(([key])=>key);
}
function reviewKey(candidate){
  return [
    text(candidate&&candidate.borough).normalize('NFKC').replace(/\s+/g,' ').toUpperCase(),
    text(candidate&&candidate.address).normalize('NFKC').replace(/[.,#]/g,' ').replace(/\s+/g,' ').toUpperCase()
  ].join('|');
}
function officialUrl(system,id){
  const value=encodeURIComponent(id);
  if(system==='DOB_NOW') return 'https://data.cityofnewyork.us/resource/w9ak-ipjd.json?job_filing_number='+value;
  if(system==='SLA_PENDING') return 'https://data.ny.gov/resource/f8i8-k2gm.json?application_id='+value;
  return null;
}
function safeExcerpt(raw){
  return text(raw).replace(/[\x00-\x1f\x7f]/g,' ').replace(/\s+/g,' ').slice(0,180);
}
function inspect(input){
  const data=input||{};
  const graph=data.graph||{};
  const batches=data.batches||{};
  const failures=[];
  const now=date(data.observedAt);
  const graphValidation=research.checkGraph(graph);
  if(!now||!graphValidation.valid||graph.observedAt!==now){
    failures.push('SOURCE_REVIEW_GRAPH_INVALID');
  }
  for(const key of research.REQUIRED_SOURCES){
    const batch=batches[key];
    const source=graph.sourceObservations&&graph.sourceObservations[key];
    const observation=batch&&batch.observation;
    if(!source||!observation||!Array.isArray(batch.records)||
      observation.observationId!==source.observationId ||
      observation.observedAt!==now ||
      observation.state!=='COMPLETE_NONEMPTY' ||
      observation.supportsAbsenceConclusion!==true ||
      observation.sourceFresh!==true ||
      observation.transportOk!==true){
      failures.push('SOURCE_REVIEW_OBSERVATION_INVALID:'+key);
    }
  }
  if(failures.length)return {version:VERSION,status:'REVIEW',failures,customerDeliveryAllowed:false};

  const alreadyLinked=new Set((graph.candidates||[]).flatMap(candidate=>
    (candidate.acceptedCorroboration||[]).map(item=>text(item.sourceRecordId))));
  const collocated=new Map();
  for(const candidate of graph.candidates){
    if(!candidate||!text(candidate.entityId))continue;
    const borough=profiles.canonicalBorough(candidate.borough);
    if(!BOROUGHS.has(borough))continue;
    const key=reviewKey({borough,address:candidate.address});
    if(!collocated.has(key))collocated.set(key,new Set());
    collocated.get(key).add(candidate.entityId);
  }

  const items=[],seen=new Set();
  const ignored={oldOrFuture:0,unrelated:0,nonNyc:0,alreadyLinked:0,incomplete:0};
  for(const key of ['DOB_NOW','SLA_PENDING']){
    const source=batches[key];
    for(const record of source.records){
      const system=text(record&&record.sourceSystem);
      if(system!==key){ignored.incomplete++;continue}
      const eventDate=date(record.sourceEffectiveAt);
      if(!within(eventDate,now,key==='DOB_NOW'?DOB_DAYS:SLA_DAYS)){
        ignored.oldOrFuture++;continue;
      }
      const facts=record.facts||{};
      const property=record.property||{};
      const id=key==='DOB_NOW'?
        text(record.entityKeys&&record.entityKeys.jobFilingNumber):
        text(record.entityKeys&&record.entityKeys.applicationId);
      if(!id||!text(property.address)||
        !text(record.sourceRecordId)||seen.has(record.sourceRecordId)){
        ignored.incomplete++;continue;
      }
      const borough=profiles.canonicalBorough(
        key==='DOB_NOW'?property.borough:property.county
      );
      if(!BOROUGHS.has(borough)||
        (key==='SLA_PENDING'&&!['NY','NEW YORK'].includes(
          text(property.state).toUpperCase()))){
        ignored.nonNyc++;continue;
      }
      let markers=[];
      if(key==='DOB_NOW'){
        const type=text(facts.building_type);
        if(/^\s*(?:1|2|3)\s*family\b/i.test(type)){
          ignored.unrelated++;continue;
        }
        markers=hits(facts.job_description,DOB_TERMS);
      }else{
        markers=hits(facts.description,SLA_TERMS);
      }
      if(!markers.length){ignored.unrelated++;continue}
      if(alreadyLinked.has(record.sourceRecordId)){
        ignored.alreadyLinked++;continue;
      }
      seen.add(record.sourceRecordId);
      const possible=[...collocated.get(reviewKey({borough,address:property.address}))||[]].sort();
      items.push({
        sourceSystem:key,
        sourceRecordId:record.sourceRecordId,
        officialUrl:officialUrl(key,id),
        officialSourceObservationId:source.observation.observationId,
        sourceEffectiveAt:eventDate,
        firstObservedByThisReviewAt:now,
        borough,address:text(property.address),
        matchedResearchTerms:markers,
        sourceExcerpt:key==='DOB_NOW'?safeExcerpt(facts.job_description):
          safeExcerpt(facts.description),
        sourceStatus:key==='DOB_NOW'?text(facts.filing_status):text(facts.status),
        possibleRelatedCamis:possible.slice(0,5),
        needsIdentityReview:possible.length>0,
        reviewStatus:'REVIEW_ONLY_UNLINKED',
        customerDeliveryAllowed:false
      });
    }
  }
  items.sort((a,b)=>b.sourceEffectiveAt.localeCompare(a.sourceEffectiveAt)||
    a.sourceSystem.localeCompare(b.sourceSystem)||
    a.sourceRecordId.localeCompare(b.sourceRecordId));
  const maxItems=Number.isInteger(data.limit)&&data.limit>0?
    Math.min(MAX_ITEMS,data.limit):MAX_ITEMS;
  const selected=items.slice(0,maxItems);
  const summary={
    version:VERSION,status:'REVIEW_ONLY',
    observedAt:now,
    sourceGraphDigest:graph.graphDigest,
    sourceArtifactFingerprint:graph.artifactFingerprint,
    sourceObservationIds:Object.fromEntries(
      ['DOB_NOW','SLA_PENDING'].map(k=>[k,batches[k].observation.observationId])),
    totalResearchMatches:items.length,
    storedCount:selected.length,
    omittedByLimit:items.length-selected.length,
    sourceCounts:Object.fromEntries(['DOB_NOW','SLA_PENDING'].map(key=>[
      key,items.filter(row=>row.sourceSystem===key).length
    ])),
    ignored,
    items:selected,
    customerDeliveryAllowed:false,
    externalSendCalls:0,
    notices:[
      'Review-only: unlinked filings do not prove a restaurant, future opening, or buyer demand.',
      'An exact shared address does not establish identity; investigate possibleRelatedCamis.',
      'Source effective dates are official filing/received dates, not first-observation dates.'
    ]
  };
  return {...summary,artifactFingerprint:hash(summary)};
}
module.exports={
  VERSION,MAX_ITEMS,DOB_DAYS,SLA_DAYS,BOROUGHS,DOB_TERMS,SLA_TERMS,
  text,stable,hash,date,within,hits,reviewKey,officialUrl,safeExcerpt,inspect
};
