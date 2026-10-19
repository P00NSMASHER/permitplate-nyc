'use strict';

// Private, source-only research refresh. It does not score, bill or deliver.
// The workflow publishes the ledger + graph together to a private Git commit.
const fs = require('fs');
const path = require('path');
const {replay} = require('./run-current-graph');
const ledger = require('./curated-research-ledger');
const independentReview=require('./independent-source-review');
const independentHistory=require('./independent-source-history');
const identityReview=require('./identity-bridge-review');
const identityWorkbench=require('./identity-review-workbench');
const constructionPanel=require('./construction-validation-panel');
const constructionBlind=require('./construction-blind-diagnostic');
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
  const historyState=prepareIndependentHistory(
    readOptional(historyPath),readOptional(independentPath),independent
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
  const triage=prepareIdentityHistory(
    readOptional(identityHistoryPath),readOptional(identityPath),identity
  );
  if(!triage.ready)return triage;
  // The rich DOB diagnostic is compiled from the SAME independently verified
  // source batches. It never reads the scoring cohort, holdout or labels.
  const scopeDiagnostic=constructionPanel.build({
    graph:result.graph,batches:collected.batches,
    independent:annotated,identities:triage.annotated,
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
  result.summary.constructionReviewerCards=blind.manifest.reviewCases;
  result.summary.constructionReservedAuditCases=blind.manifest.reservedCases;
  result.summary.constructionReviewerPremiseGroups=blind.manifest.reviewPremiseGroups;
  result.summary.constructionReservedPremiseGroups=blind.manifest.reservedPremiseGroups;
  result.summary.constructionOriginalScoringHoldoutRead=0;
  result.summary.constructionDiagnosticFilings=scopeDiagnostic.filings;
  result.summary.constructionDiagnosticUniqueJobRoots=scopeDiagnostic.uniqueJobNumberRoots;
  result.summary.constructionDiagnosticFullDescriptionsBeyond180=scopeDiagnostic.officialRowsWithScopeBeyond180;
  result.summary.constructionDiagnosticSpecificComponentAndAction=scopeDiagnostic.equipmentSpecificComponentAndActionRules;
  result.summary.constructionDiagnosticHumanReviewers=0;
  result.summary.constructionDiagnosticHoldoutRead=0;
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
  atomicJson(graphPath,result.graph);
  atomicJson(ledgerPath,result.ledger);
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
  atomicJson(path.join(path.dirname(ledgerPath),'construction-blind-reviewer.json'),
    blind.reviewerPacket);
  atomicJson(path.join(path.dirname(ledgerPath),'construction-reserved-audit.json'),
    blind.reservedAudit);
  atomicJson(path.join(path.dirname(ledgerPath),'construction-blind-manifest.json'),
    blind.manifest);
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
