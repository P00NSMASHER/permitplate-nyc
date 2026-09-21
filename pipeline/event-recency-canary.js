'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {scanBatches}=require('./run-source-health');
const {buildCurrentGraph}=require('./candidate-builder');
const v3=require('./shadow-scoring-v3');
const v4=require('./shadow-scoring-v4');
const eventTime=require('./event-time');
const policy=require('./scoring-policy');
const historical=require('./historical-shadow-score-benchmark');
const VERSION='PermitPlate-event-recency-readonly-v1.0.0';
const add=(counts,key)=>{counts[key]=(counts[key]||0)+1;};
function evaluate(graph,batches,observedAt){
  const records=v3.sourceMap(Object.values(batches).flatMap(b=>b.records||[]));
  const status={},bases={},changes={};
  const thresholds=Object.fromEntries(v4.CATEGORIES.map(k=>[k,{v3AtLeast60:0,v4AtLeast60:0,droppedBelow60:0,roseTo60:0}]));
  let scored=0,unapproved=0,unknownWithBonus=0,refreshMismatches=0,simulated=0,changedCandidates=0;
  for(const candidate of graph.candidates||[]){
    const old=v3.computeShadowScores(candidate,records,observedAt);
    const next=v4.computeShadowScores(candidate,records,observedAt);
    add(status,next.status);add(bases,next.eventChronology?.eventDateBasis||'UNAVAILABLE');
    if(next.productionAuthorized!==false) unapproved++;
    if(next.eventChronology?.status==='UNKNOWN'&&next.eventChronology.recencyPoints!==0) unknownWithBonus++;
    if(next.status!=='SHADOW_SCORED') continue;
    scored++;
    if(old.status==='SHADOW_SCORED'){
      let changed=false;
      for(const category of v4.CATEGORIES){
        const before=old.scores[category],after=next.scores[category];
        if(before!==after){changed=true;add(changes,category);}
        const t=thresholds[category];
        if(before>=60)t.v3AtLeast60++;if(after>=60)t.v4AtLeast60++;
        if(before>=60&&after<60)t.droppedBelow60++;if(before<60&&after>=60)t.roseTo60++;
      }
      if(changed) changedCandidates++;
    }
    if(candidate.primaryRecord?.eventType==='DOHMH_APPLICANT_RECORD'){
      // Explicitly synthetic transformation of this one live snapshot. Not a
      // second source observation and not empirical cross-day refresh evidence.
      const copy=JSON.parse(JSON.stringify(candidate));
      copy.sourceLatestEffectiveAt=observedAt;
      copy.primaryRecord.facts.record_date=eventTime.nycDate(observedAt);
      copy.primaryRecord.observedAt=observedAt;
      const transformed=v4.computeShadowScores(copy,records,observedAt);simulated++;
      if(transformed.status!=='SHADOW_SCORED'||eventTime.stable(transformed.scores)!==eventTime.stable(next.scores)) refreshMismatches++;
    }
  }
  const replay=historical.evaluateHistoricalFixture();
  return {
    runnerVersion:VERSION,observedAt,transportMode:'NO_SEND',externalSendCalls:0,productionStateWrites:0,
    graphState:graph.graphState,graphDigest:graph.graphDigest||null,candidateCount:(graph.candidates||[]).length,
    candidateScorer:v4.SHADOW_SCORING_VERSION,currentProductionMode:policy.PRODUCTION_SCORING_MODE,
    candidateProductionAuthorized:false,scoredCount:scored,allCandidatesScored:scored===(graph.candidates||[]).length,
    scoringStatusCounts:status,eventBasisCounts:bases,changedCandidates,categoryChangeCounts:changes,
    illustrativeThreshold60Comparison:thresholds,
    frozenV3Replay:{recordCount:replay.recordCount,exactRowRate:replay.exactRowRate,fitAgreementRate:replay.fitAgreementRate,bestFitAgreementRate:replay.bestFitAgreementRate},
    syntheticMetadataTransformation:{isSynthetic:true,candidates:simulated,scoreMismatches:refreshMismatches},
    longitudinalPublisherRefreshProven:false,
    safetyInvariantsPassed:graph.graphState==='COMPLETE'&&scored>0&&unapproved===0&&unknownWithBonus===0&&refreshMismatches===0&&replay.exactRowRate===1,
    promotionStatus:'SHADOW_ONLY_NOT_PROMOTED'
  };
}
async function run(){
  const statePath=path.join(__dirname,'..','state','detection-ledger.json');
  const before=fs.readFileSync(statePath);
  const {observedAt,batches}=await scanBatches();
  const graph=buildCurrentGraph({dohmhBatch:batches.DOHMH,slaBatch:batches.SLA_PENDING,dobBatch:batches.DOB_NOW,reviewedIdentityBridges:[]});
  const result=evaluate(graph,batches,observedAt);
  result.originalStateUnchanged=before.equals(fs.readFileSync(statePath));
  result.passed=result.safetyInvariantsPassed&&result.originalStateUnchanged;
  result.artifactFingerprint=eventTime.fingerprint(result);
  return result;
}
if(require.main===module){
  run().then(result=>{
    if(process.argv[2]){const out=path.resolve(process.argv[2]);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');}
    console.log(JSON.stringify(result,null,2));if(!result.passed) process.exitCode=1;
  }).catch(error=>{console.error(error);process.exitCode=1;});
}
module.exports={VERSION,evaluate,run};
