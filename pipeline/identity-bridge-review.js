'use strict';

// PRIVATE identity hypotheses only. Address, owner or even exact trade name
// are research signals; none is an approved identity bridge or customer lead.
const research=require('./curated-research-ledger');
const independent=require('./independent-source-review');
const history=require('./independent-source-history');
const project=require('./project-signal');
const profiles=require('./subscriber-profile');

const VERSION='PermitPlate-identity-bridge-review-v1.0.0';
const MAX_PROPOSALS=300;
const REVIEW_CLASSES=new Set([
  'PREMISE_ONLY','NAME_AND_PREMISE_TO_VERIFY',
  'PROPERTY_OWNER_TEXT_ONLY','MULTIPLE_CAMIS_SAME_PREMISE',
  'SUPPRESSED_IDENTITY','CAMIS_NAME_DRIFT_REVIEW','DOB_SLA_SHARED_PREMISE'
]);
const text=v=>v==null?'':String(v).trim();
const hash=history.hash;
function sourceUrlForRecord(record){
  if(record?.sourceSystem==='DOB_NOW')return independent.officialUrl(
    'DOB_NOW',record.entityKeys?.jobFilingNumber
  );
  if(record?.sourceSystem==='SLA_PENDING')return independent.officialUrl(
    'SLA_PENDING',record.entityKeys?.applicationId
  );
  return null;
}
function sourceBorough(record){
  const raw=record?.sourceSystem==='DOB_NOW'?
    record.property?.borough:record?.property?.county;
  return profiles.canonicalBorough(raw);
}
function addressKey(record){
  return independent.reviewKey({
    borough:sourceBorough(record),address:record?.property?.address
  });
}
function candidateKey(candidate){
  return independent.reviewKey({
    borough:profiles.canonicalBorough(candidate?.borough),
    address:candidate?.address
  });
}
// A private Git receipt must hash the same bytes it will serialize. Earlier
// code hashed optional own properties with value undefined, then JSON omitted
// them, making historical readback fail integrity verification. Normalize
// before hashing; never invent a field or trust a resealed unverified source.
function jsonSafe(value){
  if(Array.isArray(value))return value.map(item=>
    item===undefined?null:jsonSafe(item));
  if(value&&typeof value==='object'){
    return Object.fromEntries(Object.entries(value)
      .filter(([,item])=>item!==undefined)
      .map(([key,item])=>[key,jsonSafe(item)]));
  }
  return value;
}
function createProposal(core){
  // Rebuilding a review proposal may not reuse an earlier receipt fingerprint
  // or arbitrary proposal ID supplied by an untrusted caller.
  const {evidenceFingerprint:_oldProof,proposalId:_oldId,...verifiedCore}=core||{};
  const base=jsonSafe({
    version:VERSION,
    ...verifiedCore,
    customerDeliveryAllowed:false,
    automaticIdentityLinkAllowed:false,
    needsIndependentVerification:true,
    reviewStatus:'REVIEW_REQUIRED'
  });
  const proposalId='HYP:'+hash({
    kind:base.kind,sourceRecordIds:base.sourceRecordIds,
    candidateEntityId:base.candidateEntityId||null
  }).slice(0,24);
  const proposal={...base,proposalId};
  return {...proposal,evidenceFingerprint:hash(proposal)};
}
function verifyInputs(data){
  const errors=[];
  const graph=data?.graph||{};
  const independentReview=data?.independent||{};
  const batches=data?.batches||{};
  const checked=research.checkGraph(graph);
  const proof=history.verifyReview(independentReview);
  if(!checked.valid)errors.push('IDENTITY_GRAPH_INVALID');
  if(!proof.valid)errors.push('IDENTITY_RESEARCH_RECEIPT_INVALID');
  if(graph.observedAt!==data?.observedAt||
     independentReview.observedAt!==data?.observedAt||
     independentReview.sourceGraphDigest!==graph.graphDigest||
     independentReview.sourceArtifactFingerprint!==graph.artifactFingerprint){
    errors.push('IDENTITY_SNAPSHOT_MISMATCH');
  }
  if(independentReview.omittedByLimit>0){
    // Limit case is still a partial review list; proposals remain review-only
    // and must not be presented as exhaustive.
    // Not an execution error, but every output carries its coverage limits.
  }
  for(const key of research.REQUIRED_SOURCES){
    const batch=batches[key],ob=batch?.observation,source=graph.sourceObservations?.[key];
    if(!source||!ob||!Array.isArray(batch.records)||
       ob.observationId!==source.observationId||
       ob.state!=='COMPLETE_NONEMPTY'||
       source.state!=='COMPLETE_NONEMPTY'||
       ob.supportsAbsenceConclusion!==true||
       ob.sourceFresh!==true||ob.transportOk!==true||
       ob.observedAt!==data.observedAt||
       ob.publisherCount!==batch.records.length||
       ob.fetchedCount!==batch.records.length||
       source.publisherCount!==batch.records.length||
       source.fetchedCount!==batch.records.length||
       source.observedAt!==data.observedAt){
      errors.push('IDENTITY_SOURCE_NOT_COMPLETE:'+key);
    }
  }
  return [...new Set(errors)];
}
function recordIndex(batches){
  const byId=new Map(),duplicates=new Set();
  for(const key of ['DOB_NOW','SLA_PENDING']){
    for(const record of batches[key].records){
      const id=text(record?.sourceRecordId);
      if(byId.has(id))duplicates.add(id);
      else byId.set(id,record);
    }
  }
  return {byId,duplicates};
}
function verifyItem(item,record,observationId){
  if(!item||!record||
     item.sourceSystem!==record.sourceSystem||
     item.sourceRecordId!==record.sourceRecordId||
     item.officialSourceObservationId!==observationId||
     record.sourceObservationId!==observationId||
     item.officialUrl!==sourceUrlForRecord(record)||
     item.address!==record.property?.address||
     item.borough!==sourceBorough(record)||
     item.sourceEffectiveAt!==independent.date(record.sourceEffectiveAt)||
     item.sourceStatus!==(record.sourceSystem==='DOB_NOW'?
       text(record.facts?.filing_status):text(record.facts?.status))){
    return false;
  }
  const rules=record.sourceSystem==='DOB_NOW'?independent.DOB_TERMS:independent.SLA_TERMS;
  const description=record.sourceSystem==='DOB_NOW'?
    record.facts?.job_description:record.facts?.description;
  return JSON.stringify(item.matchedResearchTerms)===
    JSON.stringify(independent.hits(description,rules)) &&
    item.sourceExcerpt===independent.safeExcerpt(description);
}

function dohmhProvenance(candidate,batch){
  const premise=candidateKey(candidate);
  const entityId=text(candidate?.entityId);
  const docs=(batch?.records||[]).filter(row=>
    row.sourceSystem==='DOHMH' &&
    row.sourceEntityId===entityId &&
    row.sourceObservationId===batch.observation.observationId &&
    independent.reviewKey({
      borough:profiles.canonicalBorough(row.property?.borough),
      address:row.property?.address
    })===premise &&
    ['DOHMH_APPLICANT_RECORD','DOHMH_PRE_PERMIT_EVENT'].includes(row.eventType)
  );
  docs.sort((a,b)=>
    (project.norm(a.parties?.operatorName)===project.norm(candidate.canonicalName)?-1:1)-
    (project.norm(b.parties?.operatorName)===project.norm(candidate.canonicalName)?-1:1)||
    a.sourceRecordId.localeCompare(b.sourceRecordId)
  );
  const row=docs[0];
  return row?{
    sourceRecordId:row.sourceRecordId,
    sourceObservationId:row.sourceObservationId,
    rowFingerprint:row.rowFingerprint,
    printedOperatorAgrees:docs.some(doc=>
      project.norm(doc.parties?.operatorName)&&
      project.norm(doc.parties?.operatorName)===project.norm(candidate.canonicalName))
  }:null;
}
function operatorAgreement(candidate,record){
  const operator=project.norm(candidate.canonicalName);
  if(!operator)return 'NOT_ESTABLISHED';
  const parties=record?.parties||{};
  if(record.sourceSystem==='SLA_PENDING'){
    if([parties.dba,parties.legalName].map(project.norm).includes(operator))
      return 'EXACT_OPERATOR_DBA_TEXT';
  }else if(record.sourceSystem==='DOB_NOW' &&
    project.norm(parties.ownerBusinessName)===operator){
    // Property owners can be landlords or contractors; this is not operator
    // corroboration even when the printed names happen to match.
    return 'PROPERTY_OWNER_NAME_EQUALITY_ONLY';
  }
  return 'NOT_ESTABLISHED';
}
function validate(receipt){
  const failures=[],r=receipt||{};
  if(r.version!==VERSION||r.status!=='REVIEW_ONLY'||
     r.customerDeliveryAllowed!==false||
     r.automaticIdentityLinkAllowed!==false||
     r.automaticMerges!==0||r.externalSendCalls!==0||
     !Array.isArray(r.proposals)||!Number.isInteger(r.totalProposals)||
     r.storedCount!==r.proposals?.length||
     r.omittedByLimit!==r.totalProposals-r.storedCount||
     !/^[a-f0-9]{64}$/.test(r.sourceArtifactFingerprint||'')){
    failures.push('IDENTITY_REVIEW_FORMAT_INVALID');
  }
  const {artifactFingerprint,...body}=r;
  if(artifactFingerprint!==hash(body))failures.push('IDENTITY_REVIEW_FINGERPRINT_INVALID');
  const seen=new Set();
  for(const p of r.proposals||[]){
    const {evidenceFingerprint,...core}=p||{};
    if(!p||p.version!==VERSION||
       p.reviewStatus!=='REVIEW_REQUIRED'||
       p.customerDeliveryAllowed!==false||
       p.automaticIdentityLinkAllowed!==false||
       p.needsIndependentVerification!==true||
       !REVIEW_CLASSES.has(p.reviewClass)||
       seen.has(p.proposalId)||
       p.proposalId!=='HYP:'+hash({
         kind:p.kind,sourceRecordIds:p.sourceRecordIds,
         candidateEntityId:p.candidateEntityId||null
       }).slice(0,24)||
       evidenceFingerprint!==hash(core)||
       !Array.isArray(p.sourceRecordIds)||p.sourceRecordIds.length<1||
       !Array.isArray(p.officialSourceUrls)||p.officialSourceUrls.length<2||
       p.officialSourceUrls.some(url=>typeof url!=='string'||!url.startsWith('https://'))){
      failures.push('IDENTITY_REVIEW_PROPOSAL_INVALID');
    }
    if(p?.proposalId)seen.add(p.proposalId);
  }
  return {valid:failures.length===0,failures:[...new Set(failures)]};
}
function prepare(data){
  const failures=verifyInputs(data);
  if(failures.length)return {version:VERSION,status:'REVIEW',
    failures,customerDeliveryAllowed:false,automaticIdentityLinkAllowed:false};
  const {graph,batches}=data;
  const researchReceipt=data.independent;
  const idx=recordIndex(batches);
  const linked=new Set(graph.candidates.flatMap(c=>
    (c.acceptedCorroboration||[]).map(x=>x.sourceRecordId)));
  const recordMap=new Map(),invalidRows=[];
  for(const item of researchReceipt.items){
    const id=item?.sourceRecordId,record=idx.byId.get(id);
    if(idx.duplicates.has(id)||linked.has(id)||
       !verifyItem(item,record,batches[item?.sourceSystem]?.observation?.observationId)){
      invalidRows.push(id||'unknown');
    }else recordMap.set(id,record);
  }
  if(invalidRows.length)return {
    version:VERSION,status:'REVIEW',failures:['IDENTITY_REVIEW_ROW_IDENTITY_MISMATCH'],
    invalidCount:invalidRows.length,customerDeliveryAllowed:false,
    automaticIdentityLinkAllowed:false
  };
  const camisByAddress=new Map();
  for(const c of graph.candidates){
    if(!/^CAMIS:[0-9]+$/.test(text(c.entityId)))continue;
    const key=candidateKey(c);
    if(!camisByAddress.has(key))camisByAddress.set(key,[]);
    camisByAddress.get(key).push(c);
  }
  const slaByAddress=new Map();
  for(const record of recordMap.values()){
    if(record.sourceSystem!=='SLA_PENDING')continue;
    const key=addressKey(record);
    if(!slaByAddress.has(key))slaByAddress.set(key,[]);
    slaByAddress.get(key).push(record);
  }
  const proposals=[];
  let skippedWithoutDohmhProvenance=0;
  for(const record of recordMap.values()){
    const key=addressKey(record);
    const possible=(camisByAddress.get(key)||[]).slice().sort((a,b)=>
      a.entityId.localeCompare(b.entityId));
    for(const candidate of possible){
      const origin=dohmhProvenance(candidate,batches.DOHMH);
      if(!origin){
        skippedWithoutDohmhProvenance++;
        continue;
      }
      const agreement=operatorAgreement(candidate,record);
      const conflict=candidate.deliverySuppressed===true ||
        (candidate.crossCamisOperationalConflicts||[]).length>0;
      const reviewClass=conflict?'SUPPRESSED_IDENTITY':
        possible.length>1?'MULTIPLE_CAMIS_SAME_PREMISE':
        !origin.printedOperatorAgrees?'CAMIS_NAME_DRIFT_REVIEW':
        agreement==='EXACT_OPERATOR_DBA_TEXT'?'NAME_AND_PREMISE_TO_VERIFY':
        agreement==='PROPERTY_OWNER_NAME_EQUALITY_ONLY'?'PROPERTY_OWNER_TEXT_ONLY':
        'PREMISE_ONLY';
      proposals.push(createProposal({
        kind:'CAMIS_TO_EARLY_SOURCE',
        sourceRecordId:record.sourceRecordId,
        sourceRecordIds:[record.sourceRecordId],
        candidateEntityId:candidate.entityId,
        sourceSystem:record.sourceSystem,
        premiseKey:key,
        nameAgreement:agreement,
        reviewClass,
        competingCamisCount:possible.length,
        officialSourceUrls:[
          sourceUrlForRecord(record),
          'https://data.cityofnewyork.us/resource/43nn-pn8j.json?camis='+
            encodeURIComponent(candidate.camis)
        ],
        sourceObservationId:record.sourceObservationId,
        sourceRowFingerprint:record.rowFingerprint,
        dohmhRecordId:origin.sourceRecordId,
        dohmhObservationId:origin.sourceObservationId,
        dohmhRowFingerprint:origin.rowFingerprint,
        candidateName:candidate.canonicalName,
        sourceTradeName:record.sourceSystem==='SLA_PENDING'?
          text(record.parties?.dba||record.parties?.legalName):null,
        sourceOwnerName:record.sourceSystem==='DOB_NOW'?
          text(record.parties?.ownerBusinessName):null,
        sourceGraphFingerprint:graph.artifactFingerprint
      }));
    }
    if(record.sourceSystem!=='DOB_NOW')continue;
    for(const sla of slaByAddress.get(key)||[]){
      const nameAgreement='NOT_ESTABLISHED'; // DOB owner != operator
      proposals.push(createProposal({
        kind:'DOB_TO_SLA_PREMISE_REVIEW',
        sourceRecordId:record.sourceRecordId,
        sourceRecordIds:[record.sourceRecordId,sla.sourceRecordId],
        candidateEntityId:null,sourceSystem:'DOB_NOW',
        premiseKey:key,nameAgreement,reviewClass:'DOB_SLA_SHARED_PREMISE',
        competingCamisCount:possible.length,
        officialSourceUrls:[sourceUrlForRecord(record),sourceUrlForRecord(sla)],
        sourceObservationId:record.sourceObservationId,
        sourceRowFingerprint:record.rowFingerprint,
        counterpartyObservationId:sla.sourceObservationId,
        counterpartyRowFingerprint:sla.rowFingerprint,
        sourceGraphFingerprint:graph.artifactFingerprint
      }));
    }
  }
  proposals.sort((a,b)=>a.kind.localeCompare(b.kind)||
    a.sourceRecordIds.join('|').localeCompare(b.sourceRecordIds.join('|'))||
    text(a.candidateEntityId).localeCompare(text(b.candidateEntityId)));
  const max=Number.isInteger(data.limit)&&data.limit>0?
    Math.min(data.limit,MAX_PROPOSALS):MAX_PROPOSALS;
  const stored=proposals.slice(0,max);
  const receipt={
    version:VERSION,status:'REVIEW_ONLY',
    observedAt:graph.observedAt,sourceGraphDigest:graph.graphDigest,
    sourceArtifactFingerprint:graph.artifactFingerprint,
    sourceReviewFingerprint:researchReceipt.artifactFingerprint,
    totalProposals:proposals.length,storedCount:stored.length,
    omittedByLimit:proposals.length-stored.length,
    reviewQueueComplete:proposals.length<=max && researchReceipt.omittedByLimit===0 &&
      skippedWithoutDohmhProvenance===0,
    skippedWithoutDohmhProvenance,
    proposals:stored,
    customerDeliveryAllowed:false,automaticIdentityLinkAllowed:false,
    automaticMerges:0,externalSendCalls:0,
    notices:[
      'A shared building address is not proof of the same business.',
      'An exact printed name remains a hypothesis until independently verified.',
      'Property owner or landlord is not interchangeable with the restaurant operator.',
      'This artifact cannot authorize reviewedIdentityBridges or customer delivery.'
    ]
  };
  return {...receipt,artifactFingerprint:hash(receipt)};
}
module.exports={
  VERSION,MAX_PROPOSALS,REVIEW_CLASSES,sourceUrlForRecord,sourceBorough,
  addressKey,candidateKey,verifyInputs,verifyItem,dohmhProvenance,operatorAgreement,
  jsonSafe,createProposal,validate,prepare
};
