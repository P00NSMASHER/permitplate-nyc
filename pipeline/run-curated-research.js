'use strict';

// Private, source-only research refresh. It does not score, bill or deliver.
// The workflow publishes the ledger + graph together to a private Git commit.
const fs = require('fs');
const path = require('path');
const {replay} = require('./run-current-graph');
const {buildCurrentGraph} = require('./candidate-builder');
const internalV4 = require('./nyc-v4-internal-production-scoring');
const reviewBoard = require('./nyc-v4-review-workbench');
const ledger = require('./curated-research-ledger');
const independentReview=require('./independent-source-review');
const independentHistory=require('./independent-source-history');
const identityReview=require('./identity-bridge-review');
const identityWorkbench=require('./identity-review-workbench');
const constructionPanel=require('./construction-validation-panel');
const constructionBlind=require('./construction-blind-diagnostic');
const constructionFrozen=require('./construction-frozen-reference');
const constructionWorksheet=require('./construction-reviewer-worksheet');
const identityHistory=require('./identity-triage-history');
const receiptRecovery=require('./identity-receipt-recovery');
const {privateMaterialPath} = require('./run-subscriber-intake');

const VERSION = 'PermitPlate-curated-research-runner-v1.0.0';

function readOptional(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file,'utf8')) : null;
}
function atomicJson(file, data) {
  const target = privateMaterialPath(file);
  fs.mkdirSync(path.dirname(target),{recursive:true});
  const temporary = target + '.' + process.pid + '.tmp';
  try {
    fs.writeFileSync(temporary,JSON.stringify(data,null,2) + '\n',{flag:'wx',mode:0o600});
    fs.renameSync(temporary,target);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}
function atomicText(file,contents){
  const target=privateMaterialPath(file);
  fs.mkdirSync(path.dirname(target),{recursive:true});
  const temporary=target+'.'+process.pid+'.tmp';
  try{
    fs.writeFileSync(temporary,String(contents),{flag:'wx',mode:0o600});
    fs.renameSync(temporary,target);
  }finally{
    if(fs.existsSync(temporary))fs.unlinkSync(temporary);
  }
}
function baselineAnchor(currentLedger) {
  const core={
    version:'PermitPlate-curated-baseline-anchor-v1.0.0',
    initializedAt:currentLedger.initializedAt,
    baselineGraphDigest:currentLedger.graphDigest,
    baselineLedgerFingerprint:currentLedger.ledgerFingerprint
  };
  return {...core,anchorFingerprint:ledger.hash(core)};
}
function verifyBaselineAnchor(previous,anchor) {
  if (!previous && !anchor) return {valid:true};
  if (!previous || !anchor) return {valid:false,reason:'CURATED_BASELINE_ANCHOR_MISSING'};
  const core={
    version:anchor.version,
    initializedAt:anchor.initializedAt,
    baselineGraphDigest:anchor.baselineGraphDigest,
    baselineLedgerFingerprint:anchor.baselineLedgerFingerprint
  };
  if (core.version!=='PermitPlate-curated-baseline-anchor-v1.0.0' ||
      core.initializedAt!==previous.initializedAt ||
      ledger.hash(core)!==anchor.anchorFingerprint) {
    return {valid:false,reason:'CURATED_BASELINE_ANCHOR_INVALID'};
  }
  return {valid:true};
}
function prepare(previous, graph) {
  const advanced = ledger.advance(previous,graph);
  if (advanced.status === 'REVIEW') {
    return {status:'REVIEW',failures:advanced.failures,ready:false};
  }
  return {
    status:advanced.status,
    ready:true,
    ledger:advanced.ledger,
    graph,
    summary:{
      runnerVersion:VERSION,
      status:advanced.status,
      graphState:graph.graphState,
      graphDigest:graph.graphDigest,
      observedAt:graph.observedAt,
      sourceGraphFingerprint:graph.artifactFingerprint,
      ledgerFingerprint:advanced.ledger.ledgerFingerprint,
      candidateCount:advanced.candidateCount,
      newlyObservedResearchCount:advanced.newResearchCount,
      verifiedMaterialChangeCount:advanced.newMaterialEventCount||0,
      materialChangesHeldForReview:advanced.materialReviewCount||0,
      heldForReviewCount:advanced.heldReviewCount,
      externalSendCalls:0,
      customerDataRead:false
    }
  };
}
function prepareIndependentHistory(priorHistory,priorReview,currentReview){
  let migrated=false;
  if(!priorHistory&&priorReview){
    // If an annotated snapshot exists but its companion ledger disappears,
    // a fresh bootstrap would falsely reclassify existing records as new.
    if(priorReview.historyVersion===independentHistory.VERSION){
      return {status:'REVIEW',ready:false,failures:['INDEPENDENT_HISTORY_FILE_MISSING']};
    }
    const baseline=independentHistory.bootstrap(priorReview);
    if(baseline.status==='REVIEW'){
      return {status:'REVIEW',ready:false,failures:baseline.failures};
    }
    priorHistory=baseline.ledger;
    migrated=true;
  }
  // Prior version hashed changing sourceObservationId into the full-scope
  // receipt, creating false rechecks each day. Rebase ONLY from the exact
  // sealed historical private review, never by trusting today's new graph.
  const semanticRebase=priorHistory?
    independentHistory.rebaseLegacyScopeHistory(priorHistory,priorReview):
    {valid:true,ledger:null,rebasedCount:0,legacyAlertCaveats:0};
  if(!semanticRebase.valid){
    return {status:'REVIEW',ready:false,failures:semanticRebase.failures};
  }
  const advancedHistory=independentHistory.advance(
    semanticRebase.ledger,currentReview);
  if(advancedHistory.status==='REVIEW'){
    return {status:'REVIEW',ready:false,failures:advancedHistory.failures};
  }
  const annotated=independentHistory.annotate(
    currentReview,advancedHistory.ledger,
    advancedHistory.newObservationIds,advancedHistory.contextChangeIds
  );
  if(annotated.status==='REVIEW'){
    return {status:'REVIEW',ready:false,failures:annotated.failures};
  }
  return {ready:true,migrated,advancedHistory,annotated,
    scopeSemanticRebasedCount:semanticRebase.rebasedCount||0,
    legacyScopeAlertCaveats:semanticRebase.legacyAlertCaveats||0};
}
function prepareIdentityHistory(previous,priorReceipt,currentReceipt){
  if(!previous&&priorReceipt){
    // Never silently erase a previous tracked history when its separate
    // durable state file has been deleted.
    if(priorReceipt.identityHistoryVersion===identityHistory.VERSION){
      return {ready:false,status:'REVIEW',
        failures:['IDENTITY_TRIAGE_HISTORY_MISSING']};
    }
    const recovered=receiptRecovery.normalizeReceipt(priorReceipt);
    if(!recovered.ready)return {
      ready:false,status:'REVIEW',failures:recovered.failures
    };
    const initial=identityHistory.bootstrap(recovered.receipt);
    if(initial.status==='REVIEW')return {
      ready:false,status:'REVIEW',failures:initial.failures
    };
    const updated=identityHistory.advance(initial.ledger,currentReceipt);
    if(updated.status==='REVIEW')return {
      ready:false,status:'REVIEW',failures:updated.failures
    };
    const annotated=identityHistory.annotate(currentReceipt,updated.ledger,
      updated.newProposalIds,updated.contextRecheckIds);
    if(annotated.status==='REVIEW')return {
      ready:false,status:'REVIEW',failures:annotated.failures
    };
    return {ready:true,migrated:true,bootstrapped:false,
      normalizedLegacyReceipt:recovered.legacy,
      updated,annotated};
  }
  if(!previous){
    const initial=identityHistory.bootstrap(currentReceipt);
    if(initial.status==='REVIEW')return {
      ready:false,status:'REVIEW',failures:initial.failures
    };
    const annotated=identityHistory.annotate(currentReceipt,initial.ledger,
      [],[],true);
    if(annotated.status==='REVIEW')return {
      ready:false,status:'REVIEW',failures:annotated.failures
    };
    return {ready:true,migrated:false,bootstrapped:true,
      normalizedLegacyReceipt:false,updated:initial,annotated};
  }
  const updated=identityHistory.advance(previous,currentReceipt);
  if(updated.status==='REVIEW')return {
    ready:false,status:'REVIEW',failures:updated.failures
  };
  const annotated=identityHistory.annotate(currentReceipt,updated.ledger,
    updated.newProposalIds,updated.contextRecheckIds);
  if(annotated.status==='REVIEW')return {
    ready:false,status:'REVIEW',failures:annotated.failures
  };
  return {ready:true,migrated:false,bootstrapped:false,
    normalizedLegacyReceipt:false,updated,annotated};
}
async function run(input) {
  const opts = input || {};
  if (!opts.ledgerPath || !opts.graphPath) {
    throw new Error('PRIVATE_LEDGER_AND_GRAPH_PATH_REQUIRED');
  }
  const ledgerPath = privateMaterialPath(opts.ledgerPath);
  const graphPath = privateMaterialPath(opts.graphPath);
  const anchorPath=path.join(path.dirname(ledgerPath),'curated-baseline-anchor.json');
  const sourceDir=path.dirname(ledgerPath);
  const formerParts={
    panel:readOptional(path.join(sourceDir,'construction-validation-panel.json')),
    reviewerPacket:readOptional(path.join(sourceDir,'construction-blind-reviewer.json')),
    reservedAudit:readOptional(path.join(sourceDir,'construction-reserved-audit.json')),
    manifest:readOptional(path.join(sourceDir,'construction-blind-manifest.json'))
  };
  const freezeDir=path.join(path.dirname(sourceDir),'research','construction-frozen-reference-v1');
  const frozenParts={
    panel:readOptional(path.join(freezeDir,'source-panel.json')),
    reviewerPacket:readOptional(path.join(freezeDir,'reviewer-packet.json')),
    reservedAudit:readOptional(path.join(freezeDir,'reserved-audit.json')),
    manifest:readOptional(path.join(freezeDir,'split-manifest.json')),
    anchor:readOptional(path.join(freezeDir,'anchor.json'))
  };
  if(constructionFrozen.allOrNone(frozenParts)==='NONE'&&frozenParts.anchor){
    return {status:'REVIEW',ready:false,failures:['FROZEN_CONSTRUCTION_ANCHOR_WITHOUT_DATA']};
  }
  const previous=readOptional(ledgerPath);
  const anchor=readOptional(anchorPath);
  const anchorCheck=verifyBaselineAnchor(previous,anchor);
  if (!anchorCheck.valid) return {
    status:'REVIEW',ready:false,failures:[anchorCheck.reason]
  };
  const collected = await replay(opts.nowIso,{withBatches:true});
  const result = prepare(previous,collected.result);
  if (!result.ready) return result;
  // Review-only DOB/SLA evidence uses the exact source observations already
  // included in the graph. It cannot be confused with customer-ready CAMIS.
  const independent=independentReview.inspect({
    graph:result.graph,
    batches:collected.batches,
    observedAt:result.graph.observedAt
  });
  if(independent.status!=='REVIEW_ONLY') {
    return {status:'REVIEW',ready:false,failures:independent.failures||[
      'INDEPENDENT_REVIEW_NOT_READY'
    ]};
  }
  const independentPath=path.join(path.dirname(ledgerPath),'independent-source-review.json');
  const historyPath=path.join(path.dirname(ledgerPath),'independent-source-history.json');
  const previousIndependentHistory=readOptional(historyPath);
  const previousIndependentReview=readOptional(independentPath);
  const historyState=prepareIndependentHistory(
    previousIndependentHistory,previousIndependentReview,independent
  );
  if(!historyState.ready)return historyState;
  const {advancedHistory,annotated,migrated}=historyState;
  // This cannot alter CAMIS candidate identities or grant a reviewed bridge.
  // It only saves hypotheses for a separate independently documented review.
  const identity=identityReview.prepare({
    graph:result.graph,batches:collected.batches,independent:annotated,
    observedAt:result.graph.observedAt
  });
  if(identity.status!=='REVIEW_ONLY'){
    return {status:'REVIEW',ready:false,failures:identity.failures||[
      'IDENTITY_HYPOTHESES_UNVERIFIED'
    ]};
  }
  // Check the exact disk readback representation, not only an in-memory
  // receipt that may contain unserializable optional fields.
  const identityValidation=identityReview.validate(JSON.parse(JSON.stringify(identity)));
  if(!identityValidation.valid){
    return {status:'REVIEW',ready:false,failures:identityValidation.failures};
  }
  const identityPath=path.join(path.dirname(ledgerPath),'identity-bridge-review.json');
  const identityHistoryPath=path.join(path.dirname(ledgerPath),'identity-triage-history.json');
  const previousIdentityReview=readOptional(identityPath);
  const triage=prepareIdentityHistory(
    readOptional(identityHistoryPath),previousIdentityReview,identity
  );
  if(!triage.ready)return triage;
  // The rich DOB diagnostic is compiled from the SAME independently verified
  // source batches. It never reads the scoring cohort, holdout or labels.
  const scopeDiagnostic=constructionPanel.build({
    graph:result.graph,batches:collected.batches,
    independent:annotated,identities:triage.annotated,
    // An ambiguous filing cannot disappear from protected history or the
    // original source panel merely because today's scope classifier skips it.
    // No reviewer judgments, reserved audit, or scoring holdout are read here.
    protectedReferences:{previousLedger:previous,previousIndependentHistory,
      previousIndependentReview,previousIdentityReview,
      previousDiagnosticCases:formerParts.panel?.cases||[],
      frozenSourceCases:frozenParts.panel?.cases||[]},
    observedAt:result.graph.observedAt
  });
  if(scopeDiagnostic.status!=='SOURCE_RICH_DIAGNOSTIC_ONLY'||
     scopeDiagnostic.customerDeliveryAllowed!==false||
     scopeDiagnostic.productionAuthorized!==false){
    return {status:'REVIEW',ready:false,
      failures:scopeDiagnostic.failures||['CONSTRUCTION_DIAGNOSTIC_HOLD']};
  }
  const blind=constructionBlind.split(scopeDiagnostic);
  if(blind.status!=='READY_FOR_REAL_REVIEW'||
     !constructionBlind.verify(blind,scopeDiagnostic).valid||
     blind.manifest.productionAuthorized!==undefined||
     blind.manifest.scoringPromotionAuthorized!==false||
     blind.manifest.customerDeliveryAllowed!==false||
     blind.manifest.originalScoringHoldoutCasesRead!==0){
    return {status:'REVIEW',ready:false,
      failures:blind.failures||['CONSTRUCTION_BLIND_SPLIT_FAILED_CLOSED']};
  }
  const freeze=constructionFrozen.choose({
    previousFrozen:frozenParts,legacy:formerParts,
    current:{
      panel:scopeDiagnostic,
      reviewerPacket:blind.reviewerPacket,
      reservedAudit:blind.reservedAudit,
      manifest:blind.manifest
    },
    now:result.graph.observedAt
  });
  if(!['FROZEN_ALREADY','FROZEN_CREATED'].includes(freeze.status)){
    return {status:'REVIEW',ready:false,failures:freeze.failures||[
      'CONSTRUCTION_REFERENCE_FREEZE_FAILED'
    ]};
  }
  // Provide one immutable, no-score reviewer worksheet. Refuse partial or
  // modified archived documents instead of overwriting them on a new run.
  const reviewerWorksheet=constructionWorksheet.render(freeze.frozen);
  const worksheetPaths={
    html:path.join(freezeDir,'reviewer-worksheet.html'),
    csv:path.join(freezeDir,'reviewer-worksheet.csv'),
    receipt:path.join(freezeDir,'reviewer-worksheet-receipt.json')
  };
  const existingWorksheetFiles=Object.values(worksheetPaths)
    .filter(file=>fs.existsSync(file)).length;
  if(existingWorksheetFiles!==0&&existingWorksheetFiles!==3){
    return {status:'REVIEW',ready:false,
      failures:['FROZEN_REVIEW_WORKSHEET_PARTIAL']};
  }
  if(existingWorksheetFiles===3){
    const oldDocs={
      html:fs.readFileSync(worksheetPaths.html,'utf8'),
      csv:fs.readFileSync(worksheetPaths.csv,'utf8'),
      receipt:readOptional(worksheetPaths.receipt)
    };
    const worksheetCheck=constructionWorksheet.verifyFiles(freeze.frozen,oldDocs);
    if(!worksheetCheck.valid){
      return {status:'REVIEW',ready:false,failures:worksheetCheck.failures};
    }
  }
  result.summary.constructionFrozenReviewerWorksheetCases=reviewerWorksheet.receipt.caseCount;
  result.summary.constructionFrozenReviewerWorksheetCreated=existingWorksheetFiles===0;
    result.summary.constructionReferenceOriginalObservedAt=freeze.frozen.anchor.originalSourceObservedAt;
  result.summary.constructionReferenceCreated=freeze.newlyFrozen;
  result.summary.constructionReferenceReviewerCases=freeze.frozen.anchor.reviewCases;
  result.summary.constructionReferenceReservedCases=freeze.frozen.anchor.reservedCases;
  result.summary.constructionReferenceOriginalScoringHoldoutRead=0;
  // Current source data may continue changing; the original 67/26 reference
  // and its reserved audit remain fixed, even when daily strata shift.
    result.summary.constructionProvisionalReviewerCards=blind.manifest.reviewCases;
  result.summary.constructionProvisionalAuditCases=blind.manifest.reservedCases;
  result.summary.constructionReviewerCards=freeze.frozen.anchor.reviewCases;
  result.summary.constructionReservedAuditCases=freeze.frozen.anchor.reservedCases;
  result.summary.constructionReviewerPremiseGroups=freeze.frozen.anchor.reviewPremiseGroups;
  result.summary.constructionReservedPremiseGroups=freeze.frozen.anchor.reservedPremiseGroups;
  result.summary.constructionOriginalScoringHoldoutRead=0;
  result.summary.constructionDiagnosticFilings=scopeDiagnostic.filings;
  result.summary.constructionDiagnosticUniqueJobRoots=scopeDiagnostic.uniqueJobNumberRoots;
  result.summary.constructionDiagnosticFullDescriptionsBeyond180=scopeDiagnostic.officialRowsWithScopeBeyond180;
  result.summary.constructionDiagnosticSpecificComponentAndAction=scopeDiagnostic.equipmentSpecificComponentAndActionRules;
  result.summary.constructionDiagnosticHumanReviewers=0;
  result.summary.constructionDiagnosticHoldoutRead=0;
  result.summary.constructionCollisionIds=scopeDiagnostic.sourceCollisionReceipt.collisionIdCount;
  result.summary.constructionQuarantinedOutOfScopeIds=scopeDiagnostic.sourceCollisionReceipt.quarantinedIdCount;
  result.summary.constructionQuarantinedPublisherRows=scopeDiagnostic.sourceCollisionReceipt.quarantinedRowCount;
  result.summary.constructionRawPublisherRowsRemoved=0;
  // Static human workbench has no approval endpoint, scripts, remote assets,
  // email transport, or public CI artifact. All output stays in private Git.
  const workbench=identityWorkbench.render(triage.annotated);
  if(workbench.customerDeliveryAllowed!==false||
     workbench.automaticIdentityLinkAllowed!==false){
    return {status:'REVIEW',ready:false,failures:['IDENTITY_WORKBENCH_SEND_BOUNDARY']};
  }
  result.summary.identityWorkbenchRows=workbench.renderedCount;
  result.summary.identityFirstSeenTracked=Object.keys(triage.updated.ledger.entries).length;
  result.summary.identityNewHypotheses=triage.updated.newProposalIds.length;
  result.summary.identityEvidenceRechecks=triage.updated.contextRecheckIds.length;
  result.summary.identityHistoryMigrated=triage.migrated;
  result.summary.identityLegacyReceiptRecovered=triage.normalizedLegacyReceipt;
  result.summary.identityReviewOnlyProposalCount=identity.storedCount;
  result.summary.identityReviewTotalProposals=identity.totalProposals;
  result.summary.identityReviewOmittedCount=identity.omittedByLimit;
  result.summary.identityOfficialPremiseConflicts=identity.proposals.filter(
    p=>p.premiseEvidence?.manualConflictHold===true).length;
  result.summary.identityOfficialPremiseMatches=identity.proposals.filter(
    p=>p.premiseEvidence?.assessment==='MATCHED_PREMISE_IDENTIFIER_REVIEW').length;
  result.summary.identityAutomaticMerges=0;
  result.summary.independentReviewOnlyCount=annotated.storedCount;
  result.summary.independentReviewTotalMatches=annotated.totalResearchMatches;
  result.summary.independentReviewOverflow=annotated.omittedByLimit;
  result.summary.independentNewObservations=advancedHistory.newObservationIds.length;
  result.summary.independentContextChangesForReview=advancedHistory.contextChangeIds.length;
  result.summary.independentHistoryEntries=Object.keys(advancedHistory.ledger.entries).length;
  result.summary.independentScopeBaselineMigrated=advancedHistory.scopeBaselineMigratedCount||0;
  result.summary.independentScopeChangesForReview=advancedHistory.scopeChangeCount||0;
  result.summary.independentScopeSemanticRebased=historyState.scopeSemanticRebasedCount||0;
  result.summary.independentLegacyScopeAlertCaveats=historyState.legacyScopeAlertCaveats||0;
  result.summary.independentHistoricalMigration=migrated;
  // Same exact official source batches as the private research ledger: never
  // refetch or score an unrelated source observation. Internal research scores
  // are deliberately separate from customer score receipts and transport.
  const fullGraph=buildCurrentGraph({
    dohmhBatch:collected.batches.DOHMH,
    dobBatch:collected.batches.DOB_NOW,
    slaBatch:collected.batches.SLA_PENDING,
    reviewedIdentityBridges:[]
  });
  const scores=internalV4.scoreSnapshot({
    publicGraph:result.graph,fullGraph,batches:collected.batches,
    observedAt:result.graph.observedAt
  });
  const scoreCheck=internalV4.validateSnapshot(scores);
  if(!scoreCheck.valid){
    return {status:'REVIEW',ready:false,failures:[
      'NYC_INTERNAL_V4_PRODUCTION_SCORE_NOT_VERIFIED',
      ...(scores.failures||[]),...scoreCheck.failures
    ]};
  }
  const scoreFile=path.join(sourceDir,'nyc-v4-internal-scores.json');
  const previousScores=readOptional(scoreFile);
  if(previousScores&&(
       !internalV4.validateSnapshot(previousScores).valid||
       Date.parse(previousScores.observedAt)>Date.parse(scores.observedAt))){
    return {status:'REVIEW',ready:false,
      failures:['PREVIOUS_PRIVATE_NYC_SCORE_SNAPSHOT_INVALID_OR_REWOUND']};
  }
  // Build the operator's evidence-linked review board from the EXACT same
  // private graph and V4 snapshot. Failure stops publication of all new
  // private research artifacts; no new customer work is started.
  const board=reviewBoard.build({graph:result.graph,scores});
  if(board.status!=='READY_FOR_PRIVATE_HUMAN_REVIEW'||
     board.customerDeliveryAllowed!==false||board.externalSendCalls!==0||
     board.receipt?.ownerApproved!==false||
     board.receipt?.scoreFingerprint!==scores.fingerprint){
    return {status:'REVIEW',ready:false,failures:[
      'NYC_PRIVATE_REVIEW_BOARD_NOT_VERIFIED',...(board.failures||[])
    ]};
  }
  result.summary.internalReviewBoardVersion=reviewBoard.VERSION;
  result.summary.internalReviewBoardCaseCount=board.receipt.sourceScoreCount;
  result.summary.internalReviewBoardCategoryRows=board.receipt.displayedRowCount;
  result.summary.internalReviewBoardFingerprint=board.receipt.fingerprint;
  result.summary.internalScoringMode=internalV4.MODE;
  result.summary.internalProductionScoringActive=true;
  result.summary.internalKnownEventResearchScores=scores.knownEventScoredCount;
  result.summary.internalUnknownDateHeld=scores.unknownEventHeldCount;
  result.summary.internalSuppressedHeld=scores.suppressedCount;
  result.summary.internalScoreFingerprint=scores.fingerprint;
  result.summary.customerScoredLeadReleaseAuthorized=false;
  atomicJson(graphPath,result.graph);
  atomicJson(ledgerPath,result.ledger);
  atomicJson(scoreFile,scores);
  // Private files only: scripts/forms/external assets are prohibited.
  atomicJson(path.join(sourceDir,'nyc-v4-review-workbench-receipt.json'),board.receipt);
  atomicText(path.join(sourceDir,'nyc-v4-review-workbench.csv'),board.csv);
  atomicText(path.join(sourceDir,'nyc-v4-review-workbench.html'),board.html);
  if (!anchor) atomicJson(anchorPath,baselineAnchor(result.ledger));
  atomicJson(historyPath,advancedHistory.ledger);
  atomicJson(independentPath,annotated);
  atomicJson(identityHistoryPath,triage.updated.ledger);
  atomicJson(identityPath,triage.annotated);
  atomicText(path.join(path.dirname(ledgerPath),'identity-bridge-review.csv'),workbench.csv);
  atomicText(path.join(path.dirname(ledgerPath),'identity-bridge-review.html'),workbench.html);
  atomicJson(path.join(path.dirname(ledgerPath),'construction-validation-panel.json'),scopeDiagnostic);
  atomicText(path.join(path.dirname(ledgerPath),'construction-validation-panel.csv'),
    constructionPanel.csv(scopeDiagnostic));
  atomicText(path.join(path.dirname(ledgerPath),'construction-validation-summary.md'),
    constructionPanel.report(scopeDiagnostic));
  // Distinct research-only split. The reviewer packet cannot include the
  // reserved audit examples, synthetic labels or scoring predictions.
  if(freeze.newlyFrozen){
    for(const [name,data] of Object.entries({
      'source-panel.json':freeze.frozen.panel,
      'reviewer-packet.json':freeze.frozen.reviewerPacket,
      'reserved-audit.json':freeze.frozen.reservedAudit,
      'split-manifest.json':freeze.frozen.manifest,
      'anchor.json':freeze.frozen.anchor
    })){
      const file=path.join(freezeDir,name);
      if(fs.existsSync(file)){
        return {status:'REVIEW',ready:false,
          failures:['CONSTRUCTION_FROZEN_REFERENCE_ALREADY_EXISTS']};
      }
      atomicJson(file,data);
    }
    // Only on fresh installation, initialize the legacy names once. For
    // existing deployments they are the historical cohort and MUST NOT move.
    if(!freeze.originalLegacyExists){
      atomicJson(path.join(sourceDir,'construction-blind-reviewer.json'),
        freeze.frozen.reviewerPacket);
      atomicJson(path.join(sourceDir,'construction-reserved-audit.json'),
        freeze.frozen.reservedAudit);
      atomicJson(path.join(sourceDir,'construction-blind-manifest.json'),
        freeze.frozen.manifest);
    }
  }
  if(existingWorksheetFiles===0){
    atomicText(worksheetPaths.html,reviewerWorksheet.html);
    atomicText(worksheetPaths.csv,reviewerWorksheet.csv);
    atomicJson(worksheetPaths.receipt,reviewerWorksheet.receipt);
  }
  return result;
}
async function main() {
  if (process.argv.length !== 4) throw new Error('Usage: node pipeline/run-curated-research.js PRIVATE_LEDGER_JSON PRIVATE_GRAPH_JSON');
  const result = await run({
    ledgerPath:process.argv[2],
    graphPath:process.argv[3]
  });
  if (!result.ready) {
    console.error(JSON.stringify({status:result.status,failures:result.failures}));
    process.exitCode=1;
  } else {
    console.log(JSON.stringify(result.summary,null,2));
  }
}
if (require.main === module) {
  main().catch(error=>{console.error(error.message);process.exitCode=1});
}
module.exports = {VERSION,readOptional,atomicJson,atomicText,baselineAnchor,verifyBaselineAnchor,prepare,prepareIndependentHistory,prepareIdentityHistory,run};
