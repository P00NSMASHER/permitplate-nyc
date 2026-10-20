'use strict';

// A separate, source-rich diagnostic population: NOT scored calibration,
// NOT the 70-case Equipment tuning sample, and NOT the sealed 30-case holdout.
// Every identity/contract opinion here is review-only and non-actionable.
const research=require('./curated-research-ledger');
const independentHistory=require('./independent-source-history');
const independentReview=require('./independent-source-review');
const identityReview=require('./identity-bridge-review');
const scopeEvidence=require('./construction-scope-evidence');
const {csvCell}=require('./identity-review-workbench');

const VERSION='PermitPlate-construction-source-diagnostic-v1.0.0';
const CATEGORY='Equipment';
const MAX_PRIVATE_ROWS=300;
function jobRoot(value){
  const s=String(value||'').replace(/^DOB_NOW:/,'');
  return s.replace(/-[IPS]\d+$/i,'');
}
function validateSource(input){
  const data=input||{},g=data.graph||{},
    i=data.independent||{},hypotheses=data.identities||{},
    batch=data.batches?.DOB_NOW;
  const fails=[];
  if(!research.checkGraph(g).valid||g.observedAt!==data.observedAt||
     g.graphState!=='COMPLETE'||g.passed!==true)fails.push('CONSTRUCTION_GRAPH_INVALID');
  if(!independentHistory.verifyReview(i).valid||
     i.sourceGraphDigest!==g.graphDigest||
     i.sourceArtifactFingerprint!==g.artifactFingerprint||
     i.observedAt!==data.observedAt)fails.push('CONSTRUCTION_PRIVATE_SOURCE_RECEIPT_INVALID');
  if(!identityReview.validate(hypotheses).valid||
     hypotheses.sourceReviewFingerprint!==i.artifactFingerprint||
     hypotheses.sourceGraphDigest!==g.graphDigest||
     hypotheses.sourceArtifactFingerprint!==g.artifactFingerprint||
     hypotheses.observedAt!==data.observedAt)fails.push('CONSTRUCTION_IDENTITY_RECEIPT_MISMATCH');
  const observed=g.sourceObservations?.DOB_NOW;
  if(!batch||!observed||
     observed.observationId!==batch.observation?.observationId||
     observed.state!=='COMPLETE_NONEMPTY'||
     observed.observedAt!==data.observedAt||
     batch.observation?.transportOk!==true||
     batch.observation?.sourceFresh!==true||
     batch.observation?.supportsAbsenceConclusion!==true||
     !Array.isArray(batch.records)||
     observed.fetchedCount!==batch.records?.length||
     batch.observation?.fetchedCount!==batch.records?.length){
    fails.push('CONSTRUCTION_OFFICIAL_SOURCE_INCOMPLETE');
  }
  if(i.omittedByLimit!==0){
    fails.push('CONSTRUCTION_PRIVATE_REVIEW_CAPPED');
  }
  return [...new Set(fails)];
}
function build(input){
  const data=input||{},fails=validateSource(data);
  if(fails.length)return {status:'REVIEW',version:VERSION,failures:fails,
    customerDeliveryAllowed:false,productionAuthorized:false};
  const dobRows=data.batches.DOB_NOW.records;
  const byId=new Map();
  for(const rec of dobRows){
    if(rec.sourceSystem!=='DOB_NOW'||byId.has(rec.sourceRecordId)){
      return {status:'REVIEW',version:VERSION,
        failures:['CONSTRUCTION_DUPLICATE_OR_INVALID_PUBLISHER_ROW'],
        customerDeliveryAllowed:false,productionAuthorized:false};
    }
    byId.set(rec.sourceRecordId,rec);
  }
  const hypotheticals=new Map();
  for(const proposal of data.identities.proposals){
    for(const id of proposal.sourceRecordIds||[]){
      if(!id.startsWith('DOB_NOW:'))continue;
      const entries=hypotheticals.get(id)||[];
      entries.push(proposal);hypotheticals.set(id,entries);
    }
  }
  const cases=[];
  const ids=new Set();
  for(const item of data.independent.items){
    if(item.sourceSystem!=='DOB_NOW')continue;
    const rec=byId.get(item.sourceRecordId),scope=item.constructionScope;
    if(!rec||ids.has(item.sourceRecordId)||
       !scope||!scopeEvidence.validate(scope,rec).valid||
       item.officialUrl!==independentReview.officialUrl('DOB_NOW',
         rec.entityKeys?.jobFilingNumber)||
       Date.parse(item.sourceEffectiveAt)!==Date.parse(rec.sourceEffectiveAt)||
       item.sourceExcerpt!==independentReview.safeExcerpt(rec.facts.job_description)||
       item.sourceStatus!==String(rec.facts.filing_status||'').trim()){
      return {status:'REVIEW',version:VERSION,
        failures:['CONSTRUCTION_REVIEW_ROW_SOURCE_MISMATCH'],
        customerDeliveryAllowed:false,productionAuthorized:false};
    }
    ids.add(item.sourceRecordId);
    const links=hypotheticals.get(item.sourceRecordId)||[];
    const conflicts=links.some(p=>p.premiseEvidence?.manualConflictHold===true);
    const propertyMatches=links.some(p=>p.premiseEvidence?.assessment===
      'MATCHED_PREMISE_IDENTIFIER_REVIEW');
    const identityStatus=conflicts?'OFFICIAL_PROPERTY_CONFLICT_REVIEW':
      propertyMatches?'MATCHING_PREMISE_KEYS_OPERATOR_NOT_VERIFIED':
      links.length?'ADDRESS_LINK_HYPOTHESIS_ONLY':
      'UNLINKED_RESEARCH_ONLY';
    const broad=scope.specificTags.length>0||
      scope.contextTags.includes('COMMERCIAL_KITCHEN');
    const specific=scope.scopeClass==='SPECIFIC_COMPONENT_AND_ACTION';
    const grouping=jobRoot(item.sourceRecordId);
    const card={
      caseId:'DOBCASE:'+research.hash({
        sourceRecordId:item.sourceRecordId,
        textHash:scope.sourceTextSha256
      }).slice(0,24),
      sourceRecordId:item.sourceRecordId,
      officialRecordUrl:item.officialUrl,
      publisherObservationId:item.officialSourceObservationId,
      sourceFactFingerprint:scope.sourceFactFingerprint,
      scopeFingerprint:scope.scopeFingerprint,
      officialFilingDate:item.sourceEffectiveAt,
      lastObservedByPermitPlateAt:data.observedAt,
      firstObservedByPermitPlateAt:item.firstObservedByPermitPlateAt||
        item.firstObservedByThisReviewAt,
      borough:item.borough,address:item.address,
      filingStatus:item.sourceStatus,
      fullOfficialScopeText:scope.fullText,
      fullScopeCharacterLength:scope.sourceTextLength,
      scopeBeyond180Characters:scope.sourceTextLength>180,
      contextTags:scope.contextTags,
      specificComponentTags:scope.specificTags,
      scopeActionTags:scope.actionTags,
      scopeClass:scope.scopeClass,
      existingOrRepairContext:scope.existingOrRepairContext,
      officialJobRootForGroupingOnly:grouping,
      possibleCamisIdentities:links.map(p=>p.candidateEntityId)
        .filter(Boolean).sort(),
      manualIdentityReview:links.length>0,
      identityStatus,
      reviewedOperatorIdentity:false,
      syntheticScopeRules:{
        broadCategoryContext:Boolean(broad),
        explicitComponentAndAction:Boolean(specific),
        rulesAgree:Boolean(broad)===Boolean(specific)
      },
      independentHumanLabels:0,
      purchaseOrderVerified:false,
      customerDeliveryAllowed:false,
      productionAuthorized:false
    };
    cases.push(card);
  }
  cases.sort((a,b)=>
    b.officialFilingDate.localeCompare(a.officialFilingDate)||
    a.sourceRecordId.localeCompare(b.sourceRecordId));
  if(cases.length>MAX_PRIVATE_ROWS){
    return {status:'REVIEW',version:VERSION,
      failures:['CONSTRUCTION_DIAGNOSTIC_BOUNDED_POPULATION_EXCEEDED'],
      customerDeliveryAllowed:false,productionAuthorized:false};
  }
  const scopeTiers={};
  const identityTiers={};
  for(const row of cases){
    scopeTiers[row.scopeClass]=(scopeTiers[row.scopeClass]||0)+1;
    identityTiers[row.identityStatus]=(identityTiers[row.identityStatus]||0)+1;
  }
  const a=cases.filter(x=>x.syntheticScopeRules.broadCategoryContext).length;
  const b=cases.filter(x=>x.syntheticScopeRules.explicitComponentAndAction).length;
  const agreed=cases.filter(x=>x.syntheticScopeRules.rulesAgree).length;
  const n=cases.length;
  const core={
    version:VERSION,status:'SOURCE_RICH_DIAGNOSTIC_ONLY',
    sourceObservedAt:data.observedAt,
    sourceGraphDigest:data.graph.graphDigest,
    sourceGraphFingerprint:data.graph.artifactFingerprint,
    privateSourceReceiptFingerprint:data.independent.artifactFingerprint,
    privateIdentityReceiptFingerprint:data.identities.artifactFingerprint,
    officialDataset:'NYC_DOB_NOW_JOB_APPLICATION_FILINGS',
    sourcePopulationDescription:'Unlinked, currently in-window, NYC restaurant-related DOB filings from the exact complete source observation; this is a selected research population, not random customers.',
    category:CATEGORY,
    filings:n,
    uniqueJobNumberRoots:new Set(cases.map(x=>x.officialJobRootForGroupingOnly)).size,
    categories:scopeTiers,identityReviewClasses:identityTiers,
    equipmentBroadSourceTextRules:a,
    equipmentSpecificComponentAndActionRules:b,
    simulatedRuleAgreementCount:agreed,
    simulatedRuleAgreementRate:n?Number((agreed/n).toFixed(6)):null,
    officialRowsWithScopeBeyond180:cases.filter(x=>x.scopeBeyond180Characters).length,
    originalCalibrationCaseIdsRead:0,
    originalCalibrationTuningRowsRead:0,
    originalCalibrationHoldoutRowsRead:0,
    sourceOnlyDiagnostic:true,
    classSampling:'ALL_CURRENT_UNLINKED_DOB_REVIEW_RECORDS',
    hiddenHoldoutOpened:false,
    reviewerIndependenceEstablished:false,
    genuineIndependentReviewerCount:0,
    acceptedCalibrationLabels:0,
    verifiedEquipmentOrders:0,
    scoredPromotionAllowed:false,
    customerDeliveryAllowed:false,
    automaticIdentityLinks:0,
    productionAuthorized:false,
    externalSendCalls:0,
    caveats:[
      'Official filing scope and identity hints are private research, NOT buyer intent.',
      'A matching BIN/BBL refers to a property, not the legal restaurant operator.',
      'Rule agreement measures deterministic source-text heuristics, NOT human agreement or accuracy.',
      'This population was selected for DOB restaurant context and is NOT a representative scoring benchmark.',
      'No existing blind calibration tuning or holdout data was accessed, altered or reused.'
    ],
    cases
  };
  return {...core,artifactFingerprint:research.hash(core)};
}
const CSV_HEADERS=Object.freeze([
  'Case ID','DOB Official Record ID','Official Source URL','Filing Date','Borough',
  'Premise Address','Filing Status','Full Original DOB Job Description',
  'Scope More Than 180 Characters','Specific Component Terms','Scope Action Terms',
  'Scope Assessment','Existing Or Repair Context','Official Job Root Group',
  'Cross Source Identity Status','Possible CAMIS (Unverified)',
  'Synthetic Broad Context Rule','Synthetic Specific Scope Rule',
  'Independent Human Review','Customer Delivery Allowed'
]);
function csv(panel){
  if(panel?.status!=='SOURCE_RICH_DIAGNOSTIC_ONLY'||
     panel.customerDeliveryAllowed!==false||panel.productionAuthorized!==false||
     !Array.isArray(panel.cases)){
    throw Error('VERIFIED_PRIVATE_CONSTRUCTION_DIAGNOSTIC_REQUIRED');
  }
  const lines=[CSV_HEADERS.map(csvCell).join(',')];
  for(const x of panel.cases){
    const cells=[
      x.caseId,x.sourceRecordId,x.officialRecordUrl,x.officialFilingDate,
      x.borough,x.address,x.filingStatus,x.fullOfficialScopeText,
      x.scopeBeyond180Characters,x.specificComponentTags.join(' | '),
      x.scopeActionTags.join(' | '),x.scopeClass,x.existingOrRepairContext,
      x.officialJobRootForGroupingOnly,x.identityStatus,
      x.possibleCamisIdentities.join(' | '),
      x.syntheticScopeRules.broadCategoryContext,
      x.syntheticScopeRules.explicitComponentAndAction,
      'NOT_REVIEWED','NO'
    ];
    lines.push(cells.map(csvCell).join(','));
  }
  return '\ufeff'+lines.join('\r\n')+'\r\n';
}
function report(panel){
  if(panel?.status!=='SOURCE_RICH_DIAGNOSTIC_ONLY'){
    throw Error('VERIFIED_PRIVATE_CONSTRUCTION_DIAGNOSTIC_REQUIRED');
  }
  return [
    '# PermitPlate — Full-scope NYC DOB construction diagnostic',
    '',
    '**PRIVATE — RESEARCH ONLY. No verified buyer identities, no scoring promotion, no customer sends.**',
    '',
    'Source observation: '+panel.sourceObservedAt,
    '',
    '| Property | Count |','|---|---:|',
    '| Official unlinked DOB filing records | '+panel.filings+' |',
    '| Distinct official job-number roots (grouping only) | '+panel.uniqueJobNumberRoots+' |',
    '| Source descriptions longer than old 180-char preview | '+panel.officialRowsWithScopeBeyond180+' |',
    '| Broad category-context rule matches | '+panel.equipmentBroadSourceTextRules+' |',
    '| Specific equipment/mechanical component plus action wording | '+panel.equipmentSpecificComponentAndActionRules+' |',
    '| Agreement between synthetic source-text rules | '+panel.simulatedRuleAgreementCount+' |',
    '| Verified procurement orders | 0 (not established by these records) |',
    '| Validated operator-to-DOB identities | 0 |',
    '| Independent human judgments | 0 |',
    '| Original scoring holdout rows accessed | 0 |',
    '',
    'The full official job-description field is preserved in the private JSON and CSV.',
    'The accompanying two rule decisions are deterministic diagnostics, not real independent reviewers.',
    'Building BIN/BBL matches or conflicts are reference evidence requiring manual review.',
    'The original Equipment 70 tuning + 30 holdout cohort was never read or rewritten.',
    '',
    'Scored leads and customer delivery remain blocked.',
    ''
  ].join('\n');
}
module.exports={VERSION,CATEGORY,MAX_PRIVATE_ROWS,CSV_HEADERS,jobRoot,
  validateSource,build,csv,report};
