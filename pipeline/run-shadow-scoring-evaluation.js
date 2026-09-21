'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {scanBatches} = require('./run-source-health');
const {buildCurrentGraph} = require('./candidate-builder');
const literal = require('./scoring');
const shadow = require('./shadow-scoring-v3');

const RUNNER_VERSION = 'PermitPlate-shadow-score-evaluation-v1.0.0';

function stableStringify(value) {
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort()
      .map((key) => JSON.stringify(key) + ':' + stableStringify(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}
function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}
function inc(obj,key) {
  const k=String(key||'UNKNOWN');
  obj[k]=(obj[k]||0)+1;
}
function normalizeBest(value) {
  const v=String(value||'').toUpperCase().replace(/[^A-Z]/g,'');
  if(v==='POSPAYMENTS'||v==='POS') return 'POS';
  if(v==='HOODFIRE') return 'HOODFIRE';
  return v;
}
function allRecords(batches) {
  return Object.values(batches||{}).flatMap((batch)=>batch.records||[]);
}
function rounded(value,places=4) {
  const f=10**places;
  return Math.round(value*f)/f;
}

function evaluate(graph,batches,observedAt) {
  const recordsById=shadow.sourceMap(allRecords(batches));
  const categoryError={};
  for(const category of shadow.CATEGORIES){
    categoryError[category]={n:0,absoluteErrorSum:0,exact:0,maxAbsoluteError:0};
  }

  const shadowStatusCounts={};
  const shadowBestCounts={};
  const fitCounts={};
  const overlap=[];
  let shadowScored=0;
  let literalOverlap=0;
  let bestFitAgree=0;
  let exactAllCategoryRows=0;
  let within5AllCategories=0;

  for(const candidate of graph.candidates||[]){
    const s=shadow.computeShadowScores(candidate,recordsById,observedAt);
    inc(shadowStatusCounts,s.status);
    if(s.fitReceipt&&s.fitReceipt.fit) inc(fitCounts,s.fitReceipt.fit);
    if(s.status==='SHADOW_SCORED'){
      shadowScored+=1;
      inc(shadowBestCounts,s.bestVendorFit);
    }

    const authority=literal.resolveScoreAuthority(candidate);
    if(authority.status!=='SCORED') continue;
    const replayAtAuthorityCutoff=shadow.computeShadowScores(
      candidate,
      recordsById,
      authority.authorityCutoff || observedAt
    );
    if(replayAtAuthorityCutoff.status!=='SHADOW_SCORED') continue;
    literalOverlap+=1;

    const errors={};
    let exactRow=true;
    let within5=true;
    for(const category of shadow.CATEGORIES){
      const expected=Number(authority.scores[category]);
      const actual=Number(replayAtAuthorityCutoff.scores[category]);
      const abs=Math.abs(actual-expected);
      errors[category]={shadow:actual,literal:expected,absoluteError:abs};
      const stat=categoryError[category];
      stat.n+=1;
      stat.absoluteErrorSum+=abs;
      if(abs===0) stat.exact+=1;
      stat.maxAbsoluteError=Math.max(stat.maxAbsoluteError,abs);
      if(abs!==0) exactRow=false;
      if(abs>5) within5=false;
    }
    if(exactRow) exactAllCategoryRows+=1;
    if(within5) within5AllCategories+=1;

    const bestAgree=normalizeBest(replayAtAuthorityCutoff.bestVendorFit)===normalizeBest(authority.bestVendorFit);
    if(bestAgree) bestFitAgree+=1;
    overlap.push({
      entityId:candidate.entityId,
      literalFit:authority.commercialFit,
      shadowFit:replayAtAuthorityCutoff.fitReceipt.fit,
      benchmarkAt:authority.authorityCutoff || observedAt,
      literalBest:authority.bestVendorFit,
      shadowBest:replayAtAuthorityCutoff.bestVendorFit,
      bestFitAgree:bestAgree,
      literalBestScore:authority.bestScore,
      shadowBestScore:replayAtAuthorityCutoff.bestScore,
      categoryErrors:errors
    });
  }

  const categoryMetrics={};
  for(const [category,stat] of Object.entries(categoryError)){
    categoryMetrics[category]={
      n:stat.n,
      meanAbsoluteError:stat.n?rounded(stat.absoluteErrorSum/stat.n):null,
      exactRate:stat.n?rounded(stat.exact/stat.n,6):null,
      maxAbsoluteError:stat.n?stat.maxAbsoluteError:null
    };
  }

  const result={
    runnerVersion:RUNNER_VERSION,
    observedAt,
    graphState:graph.graphState,
    graphDigest:graph.graphDigest,
    totalCandidates:(graph.candidates||[]).length,
    shadow:{
      scoringVersion:shadow.SHADOW_SCORING_VERSION,
      scored:shadowScored,
      coverageRate:(graph.candidates||[]).length?
        rounded(shadowScored/(graph.candidates||[]).length,6):0,
      statusCounts:shadowStatusCounts,
      fitCounts,
      bestVendorFitCounts:shadowBestCounts
    },
    benchmark:{
      literalScoringVersion:literal.SCORING_VERSION,
      overlap:literalOverlap,
      bestFitAgreementRate:literalOverlap?rounded(bestFitAgree/literalOverlap,6):null,
      exactAllCategoryRowRate:literalOverlap?rounded(exactAllCategoryRows/literalOverlap,6):null,
      within5AllCategoriesRate:literalOverlap?rounded(within5AllCategories/literalOverlap,6):null,
      categoryMetrics,
      overlapRows:overlap
    }
  };
  result.promotionState=
    graph.graphState!=='COMPLETE'?'BLOCKED_GRAPH_INCOMPLETE':
    literalOverlap<10?'INSUFFICIENT_CURRENT_BENCHMARK_OVERLAP':
    result.benchmark.bestFitAgreementRate===1 &&
    result.benchmark.within5AllCategoriesRate>=0.9?
      'CALIBRATION_PROMISING_NOT_PRODUCTION':'CALIBRATION_REQUIRED';
  result.artifactFingerprint=sha256(stableStringify(result));
  return result;
}

async function run(nowIso){
  const {observedAt,batches}=await scanBatches(nowIso);
  const graph=buildCurrentGraph({
    dohmhBatch:batches.DOHMH,
    slaBatch:batches.SLA_PENDING,
    dobBatch:batches.DOB_NOW,
    reviewedIdentityBridges:[]
  });
  return evaluate(graph,batches,observedAt);
}

async function main(){
  const result=await run();
  const outputPath=process.argv[2]||path.join(__dirname,'shadow-score-evaluation-result.json');
  fs.writeFileSync(outputPath,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
  if(result.graphState!=='COMPLETE') process.exitCode=1;
}
if(require.main===module){
  main().catch((error)=>{console.error(error);process.exit(1);});
}
module.exports={RUNNER_VERSION,stableStringify,sha256,normalizeBest,evaluate,run};
