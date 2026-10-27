'use strict';

// Keep the complete publisher batch intact. Only the private construction
// diagnostic may omit an ambiguous ID that cannot affect any current or
// previously protected research case. No variant is selected as authoritative.
const adapters=require('./source-adapters');
const research=require('./curated-research-ledger');
const independent=require('./independent-source-review');
const profiles=require('./subscriber-profile');
const materialChange=require('./material-change');

const VERSION='PermitPlate-DOB-source-collision-scope-v1.0.0';
const HEX=/^[a-f0-9]{64}$/;
function decoded(value){
  let result=String(value);
  for(let i=0;i<2;i++){
    try{const next=decodeURIComponent(result);if(next===result)break;result=next;}
    catch(_error){break;}
  }
  return result;
}
function referencePaths(value,filing,path='references',found=[]){
  // A related job family is a conservative exclusion guard, not an identity
  // assertion or permission to merge separate applications.
  const family=filing.replace(/-[A-Z]+[0-9]+$/i,'');
  const matches=text=>decoded(text).includes(filing)||decoded(text).includes(family);
  if(typeof value==='string'){
    if(matches(value))found.push(path);
  }else if(Array.isArray(value)){
    value.forEach((item,index)=>referencePaths(item,filing,path+'['+index+']',found));
  }else if(value&&typeof value==='object'){
    for(const [key,item] of Object.entries(value)){
      if(matches(key))found.push(path+'.<key>');
      referencePaths(item,filing,path+'.'+key,found);
    }
  }
  return [...new Set(found)].sort();
}
function validRecord(record,observation){
  const filing=record?.entityKeys?.jobFilingNumber;
  // Same broad publisher-ID alphabet as the existing source-panel contract;
  // genuine amendments include suffixes such as AR01, not only I1/P1/S1.
  return typeof filing==='string'&&/^[A-Za-z0-9-]+$/.test(filing)&&
    record.sourceSystem==='DOB_NOW'&&record.sourceRecordId==='DOB_NOW:'+filing&&
    record.facts?.job_filing_number===filing&&
    record.sourceObservationId===observation.observationId&&
    record.observedAt===observation.observedAt&&
    HEX.test(record.rawFactFingerprint||'')&&
    record.rawFactFingerprint===adapters.sha256(adapters.stableStringify(record.facts));
}
function rejectedOnlyReferences(graph,id){
  const results=[];
  for(const [index,candidate] of (graph?.candidates||[]).entries()){
    // The existing source-link contract excludes this exact negative result.
    // Prove the candidate is DOHMH-only before treating it as non-use; every
    // other kind of reference continues to require adjudication.
    if(!Array.isArray(candidate.sourceSystems)||candidate.sourceSystems.length!==1||
      candidate.sourceSystems[0]!=='DOHMH'||
      !Array.isArray(candidate.acceptedCorroboration)||candidate.acceptedCorroboration.length||
      !Array.isArray(candidate.commercialEvidence)||candidate.commercialEvidence.some(e=>
        e?.sourceSystem!=='DOHMH'||!String(e.sourceRecordId||'').startsWith('DOHMH:'))||
      !materialChange.valid(candidate.materiality)||!candidate.materiality.sourceKeys.length||
      candidate.materiality.sourceKeys.some(key=>!key.startsWith('DOHMH:'))||
      !Array.isArray(candidate.rejectedCorroboration))continue;
    for(const [rejectedIndex,rejected] of candidate.rejectedCorroboration.entries()){
      const r=rejected?.result;
      if(rejected?.sourceRecordId!==id||rejected.sourceSystem!=='DOB_NOW'||
        rejected.sourceUrl!==adapters.SOURCE_CONFIGS.DOB_NOW.landingUrl||
        Object.keys(rejected).sort().join('|')!=='result|sourceRecordId|sourceSystem|sourceUrl'||
        !r||Object.keys(r).sort().join('|')!=='coLocated|confidence|conflict|corroborates|reasons'||
        r.corroborates!==false||r.coLocated!==true||r.confidence!=='LOW'||r.conflict!==null||
        !Array.isArray(r.reasons)||r.reasons.slice().sort().join('|')!=='COLOCATED_ONLY|NO_ENTITY_NAME_BRIDGE')continue;
      results.push({path:'references.graph.candidates['+index+'].rejectedCorroboration['+rejectedIndex+'].sourceRecordId',
        candidateEntityId:candidate.entityId,sourceSystems:structuredClone(candidate.sourceSystems),
        materialityFingerprint:candidate.materiality.fingerprint,
        materialitySourceKeys:structuredClone(candidate.materiality.sourceKeys),
        acceptedCorroboration:structuredClone(candidate.acceptedCorroboration),
        commercialEvidence:structuredClone(candidate.commercialEvidence),
        rejection:structuredClone(rejected),classification:'EXPLICIT_REJECTED_COLOCATION_NOT_USED_AS_EVIDENCE'});
    }
  }
  return results.sort((a,b)=>a.path.localeCompare(b.path));
}
function assess(input){
  const data=input||{},batch=data.batch||{},ob=batch.observation||{};
  const records=Array.isArray(batch.records)?batch.records:[];
  const invalid=!Array.isArray(batch.records)||ob.state!=='COMPLETE_NONEMPTY'||
    ob.transportOk!==true||ob.sourceFresh!==true||ob.supportsAbsenceConclusion!==true||
    ob.publisherCount!==records.length||ob.fetchedCount!==records.length||
    !research.instant(ob.observedAt)||!ob.observationId;
  if(invalid)return {status:'REVIEW',failures:['DOB_COLLISION_SOURCE_NOT_COMPLETE']};
  const groups=new Map();
  for(const row of records){
    if(!validRecord(row,ob))return {status:'REVIEW',failures:['DOB_COLLISION_SOURCE_ROW_INVALID']};
    const group=groups.get(row.sourceRecordId)||[];group.push(row);groups.set(row.sourceRecordId,group);
  }
  const references={graph:data.graph,independent:data.independent,
    identities:data.identities,protected:data.protectedReferences||{}};
  const referenceScopeComplete=Array.isArray(data.graph?.candidates)&&
    Array.isArray(data.independent?.items)&&data.independent.omittedByLimit===0&&
    Array.isArray(data.identities?.proposals)&&data.identities.omittedByLimit===0&&
    data.identities.reviewQueueComplete===true&&data.identities.skippedWithoutDohmhProvenance===0;
  const byId=new Map(),collisions=[];
  for(const [id,rows] of [...groups].sort(([a],[b])=>a.localeCompare(b))){
    if(rows.length===1){byId.set(id,rows[0]);continue;}
    const variants=new Map();
    for(const row of rows){
      const fingerprint=research.hash(row),prior=variants.get(fingerprint);
      if(prior){prior.occurrences++;continue;}
      const description=row.facts.job_description;
      const knownScope=typeof description==='string'&&description.trim().length>0&&
        Boolean(row.property?.address)&&
        profiles.BOROUGH_ORDER.includes(profiles.canonicalBorough(row.property?.borough))&&
        independent.within(row.sourceEffectiveAt,ob.observedAt,independent.DOB_DAYS);
      const matchedResearchTerms=independent.hits(description,independent.DOB_TERMS);
      variants.set(fingerprint,{recordFingerprint:fingerprint,occurrences:1,
        rawFactFingerprint:row.rawFactFingerprint,knownScope,matchedResearchTerms,
        record:structuredClone(row)});
    }
    const sorted=[...variants.values()].sort((a,b)=>a.recordFingerprint.localeCompare(b.recordFingerprint));
    const negativeReferences=rejectedOnlyReferences(data.graph,id);
    const negativePaths=new Set(negativeReferences.map(r=>r.path));
    const referencesFound=referencePaths(references,id.slice('DOB_NOW:'.length))
      .filter(path=>!negativePaths.has(path));
    const reasons=[];
    if(!referenceScopeComplete)reasons.push('DOB_COLLISION_REFERENCE_SCOPE_INCOMPLETE');
    if(sorted.some(v=>!v.knownScope))reasons.push('DOB_COLLISION_SCOPE_UNKNOWN');
    if(sorted.some(v=>v.matchedResearchTerms.length))reasons.push('DOB_COLLISION_RESTAURANT_SCOPE');
    if(referencesFound.length)reasons.push('DOB_COLLISION_REFERENCED');
    collisions.push({sourceRecordId:id,publisherRowCount:rows.length,
      distinctVariantCount:sorted.length,
      disposition:reasons.length?'REVIEW':'QUARANTINED_OUTSIDE_RESEARCH_SCOPE',
      reasons,referencePaths:referencesFound,negativeReferences,variants:sorted,
      authoritativeVariantSelected:false,customerDeliveryAllowed:false});
  }
  const failures=[...new Set(collisions.flatMap(c=>c.reasons))].sort();
  const status=failures.length?'REVIEW':collisions.length?'QUARANTINED_OUTSIDE_RESEARCH_SCOPE':'NO_COLLISIONS';
  const decision={version:VERSION,status,collisions};
  const core={...decision,observedAt:ob.observedAt,
    sourceObservationId:ob.observationId,sourceObservation:structuredClone(ob),
    publisherRowCount:ob.publisherCount,fetchedRowCount:records.length,
    uniqueSourceIdCount:groups.size,unambiguousSourceIdCount:byId.size,
    collisionIdCount:collisions.length,
    quarantinedIdCount:collisions.filter(c=>c.disposition==='QUARANTINED_OUTSIDE_RESEARCH_SCOPE').length,
    quarantinedRowCount:collisions.filter(c=>c.disposition==='QUARANTINED_OUTSIDE_RESEARCH_SCOPE')
      .reduce((n,c)=>n+c.publisherRowCount,0),
    // This digest deliberately preserves original publisher sequence. The
    // separate decision digest is stable when the same rows are reordered.
    sourceRecordSequenceFingerprint:research.hash(records),
    protectedReferencesFingerprint:research.hash(references),
    decisionFingerprint:research.hash(decision),
    rawRowsRemoved:0,sourceCountsModified:false,authoritativeVariantSelected:false,
    customerDeliveryAllowed:false,productionAuthorized:false};
  return {status,failures,byId,receipt:{...core,receiptFingerprint:research.hash(core)}};
}
module.exports={VERSION,referencePaths,validRecord,assess};
