'use strict';

// Read-only NYC public-source verification. The expanded DOB lookback is
// research-only and NEVER changes the live candidate graph or scoring policy.
const fs=require('node:fs');
const path=require('node:path');
const reader=require('./socrata-reader');
const sourceHealth=require('./run-source-health');
const evidence=require('./dob-equipment-evidence');
const {sha256,stableStringify}=require('./socrata-reader');

const RUNNER_VERSION='PermitPlate-DOB-equipment-research-runner-v1.0.0';
const LOOKBACK_DAYS=90;
function scopeWhere(observedAt){
  const floor=sourceHealth.isoFloorDaysAgo(observedAt,LOOKBACK_DAYS);
  // These explicit terms form an audited description-filtered subset, NOT all
  // NYC construction filings. Evidence must still pass strict classification.
  const terms=['KITCHEN','RESTAURANT','FOOD SERVICE','HOOD','REFRIGERAT','COOKING','WALK-IN','WALK IN'];
  return `filing_date >= '${floor}' AND (${terms.map(term=>
    `upper(job_description) like '%${term}%'`).join(' OR ')})`;
}
async function run(nowIso,fetchImpl){
  const observedAt=nowIso||new Date().toISOString();
  const dohmhPlan=sourceHealth.sourcePlans(observedAt).find(p=>p.sourceKey==='DOHMH');
  const appToken=process.env.SOCRATA_APP_TOKEN||undefined;
  const opts={observedAt,appToken,pageSize:5000,maxRows:50000,
    ...(fetchImpl?{fetchFn:fetchImpl}:{})};
  const [dohmhBatch,dobBatch]=await Promise.all([
    reader.readSocrataSource('DOHMH',{...opts,maxAgeDays:dohmhPlan.maxAgeDays,where:dohmhPlan.where,order:dohmhPlan.order}),
    reader.readSocrataSource('DOB_NOW',{...opts,maxAgeDays:7,where:scopeWhere(observedAt),
      order:'job_filing_number ASC'})
  ]);
  const report=evidence.audit({dohmhBatch,dobBatch,observedAt});
  if(report.status!=='SOURCE_BOUNDED_RESEARCH_ONLY')return {
    runnerVersion:RUNNER_VERSION,status:'SOURCE_INCOMPLETE_REVIEW',
    observedAt,scopeWhere:scopeWhere(observedAt),counts:null,sourceProvenance:report.sourceProvenance||null,
    productionAuthorized:false,customerDeliveryAllowed:false,externalSendCalls:0
  };
  const body={runnerVersion:RUNNER_VERSION,
    status:'VERIFIED_OFFICIAL_DOB_CONSTRUCTION_SCOPE_RESEARCH_ONLY',
    sourceScope:'NYC_DOB_NOW_JOB_DESCRIPTIONS_MATCHING_EXPLICIT_RESEARCH_TERMS_IN_PRIOR_90_DAYS',
    sourceLimits:'DOB NOW Build job application filings are not all DOB jobs. Matching site is not matching tenant or purchasing decision.',
    selectedSourcePredicate:scopeWhere(observedAt),
    ...report};
  const hash=sha256(stableStringify(body));
  return {...body,reportFingerprint:hash};
}
async function main(){
  const outputPath=process.argv[2];
  if(!outputPath)throw Error('OUTPUT_FILE_REQUIRED');
  const result=await run();
  if(result.status!=='VERIFIED_OFFICIAL_DOB_CONSTRUCTION_SCOPE_RESEARCH_ONLY'){
    console.error('DOB_RESEARCH_SOURCE_UNAVAILABLE_FAIL_CLOSED');
    process.exitCode=1;return;
  }
  fs.mkdirSync(path.dirname(path.resolve(outputPath)),{recursive:true});
  fs.writeFileSync(outputPath,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  // No business, filing, owner or customer identities in public CI logs.
  console.log(JSON.stringify({
    status:result.status,observedAt:result.observedAt,
    reportFingerprint:result.reportFingerprint,sourceScope:result.sourceScope,
    sourceObservationIds:Object.fromEntries(Object.entries(result.sourceProvenance).map(([k,v])=>[k,v.observationId])),
    counts:result.counts,
    productionAuthorized:false,customerDeliveryAllowed:false,externalSendCalls:0
  }));
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={RUNNER_VERSION,LOOKBACK_DAYS,scopeWhere,run};
