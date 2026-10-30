'use strict';
// Independent second GET of selected public NYC DOB filings after the graph
// snapshot. No Stripe, customer data, private state, model promotion or send.
const fs=require('node:fs');
const path=require('node:path');
const VERSION='PermitPlate-NYC-DOB-second-readback-v1.0.0';
const MAX_CASES=300;
const {instant}=require('./provider-reconciliation');
function excerpt(value){
  return String(value??'').replace(/[\x00-\x1f\x7f]/g,' ')
    .replace(/\s+/g,' ').trim().slice(0,180).trimEnd();
}
function officialTarget(item){
  const filing=String(item?.sourceRecordId||'');
  const id=filing.startsWith('DOB_NOW:')?filing.slice(8):'';
  if(!/^[A-Z][A-Z0-9-]{6,40}$/.test(id))return null;
  try{
    const u=new URL(String(item?.officialUrl||''));
    if(u.protocol!=='https:'||u.hostname!=='data.cityofnewyork.us'||
       u.pathname!=='/resource/w9ak-ipjd.json'||u.username||u.password||
       u.hash||[...u.searchParams.keys()].length!==1||
       u.searchParams.get('job_filing_number')!==id)return null;
    return u.toString();
  }catch{return null}
}
async function verify(report,fetchImpl=fetch,now=new Date().toISOString()){
  const kit=report?.unlinkedEarlySignals?.blindDobConstructionReviewKit;
  const items=Array.isArray(kit?.cases)?kit.cases:[];
  const eligible=report?.passed===true &&
    report.inputSource==='LIVE_OFFICIAL_PUBLIC_SOCRATA_GET_ONLY' &&
    kit?.status==='COMPLETE_REVIEW_KIT'&&
    kit?.caseCount===items.length&&items.length<=MAX_CASES&&
    kit?.independentHumanAdjudications===0&&kit?.customerDeliveryAllowed===false&&
    items.every(x=>x.reviewOnly===true&&x.customerDeliveryAllowed===false&&
      x.independentVenueTypeLabel===null&&x.independentVendorNeedLabel===null);
  const output={
    version:VERSION,sourceObservedAt:report?.observedAt||null,verifiedAt:now,
    expectedCases:items.length,confirmedCases:0,matchedFilingStatus:0,
    matchedFilingDate:0,matchedDescriptionExcerpt:0,issues:[],
    secondApiGetCalls:0,customerProfilesRead:0,privateStateRead:false,
    buyerNeedVerified:false,independentHumanLabels:0,customerMessagesSent:0
  };
  const observed=instant(report?.observedAt),verified=instant(now);
  if(observed===null||verified===null||observed>verified){
    output.issues.push({reason:'READBACK_TIME_INVALID'});
    return {...output,passed:false};
  }
  if(items.length===0){
    output.issues.push({reason:'NO_CASES_TO_VERIFY'});
    return {...output,passed:false};
  }
  if(new Set(items.map(item=>item?.sourceRecordId)).size!==items.length){
    output.issues.push({reason:'DUPLICATE_CASE_IDENTITY'});
    return {...output,passed:false};
  }
  if(!eligible){
    output.issues.push({reason:'REVIEW_KIT_INCOMPLETE_OR_UNSAFE'});
    return {...output,passed:false};
  }
  const results=new Array(items.length);
  let next=0;
  async function worker(){
    while(true){
      const i=next++;
      if(i>=items.length)return;
      const item=items[i],target=officialTarget(item);
      const id=String(item?.sourceRecordId||'').slice(8);
      if(!target){results[i]={id,problems:['PUBLIC_DOB_TARGET_INVALID']};continue}
      let response,rows;
      output.secondApiGetCalls++;
      try{
        response=await fetchImpl(target,{
          method:'GET',redirect:'error',signal:AbortSignal.timeout(15000)
        });
        if(!response?.ok)throw Error('HTTP_UNAVAILABLE');
        rows=await response.json();
      }catch{
        results[i]={id,problems:['PUBLIC_SOURCE_READ_FAILED']};continue;
      }
      const exact=Array.isArray(rows)?rows.filter(r=>r?.job_filing_number===id):[];
      if(exact.length!==1){
        results[i]={id,problems:['OFFICIAL_FILING_IDENTITY_UNVERIFIED']};
        continue;
      }
      const row=exact[0],problems=[];
      const status=String(row.filing_status??'');
      const sourceDate=String(row.filing_date??'').slice(0,10);
      const expectedDate=String(item.filingDate??'').slice(0,10);
      const statusMatch=status===String(item.filingStatus??'');
      const dateMatch=expectedDate.length===10&&sourceDate===expectedDate;
      const descriptionMatch=excerpt(row.job_description)===excerpt(item.descriptionExcerpt);
      output.confirmedCases++;
      if(statusMatch)output.matchedFilingStatus++;else problems.push('FILING_STATUS_CHANGED');
      if(dateMatch)output.matchedFilingDate++;else problems.push('FILING_DATE_CHANGED');
      if(descriptionMatch)output.matchedDescriptionExcerpt++;else problems.push('DESCRIPTION_CONTEXT_CHANGED');
      results[i]={id,problems};
    }
  }
  await Promise.all(Array.from({length:4},worker));
  output.issues=results.filter(z=>z.problems.length).map(z=>({
    sourceRecordId:'DOB_NOW:'+z.id,reason:z.problems.join('|')
  }));
  output.passed=output.issues.length===0 &&
    output.confirmedCases===items.length &&
    output.matchedFilingStatus===items.length &&
    output.matchedFilingDate===items.length &&
    output.matchedDescriptionExcerpt===items.length;
  return output;
}
async function main(){
  const input=process.argv[2],dest=process.argv[3];
  if(!input||!dest)throw Error('READBACK_USAGE_INVALID');
  const report=JSON.parse(fs.readFileSync(input,'utf8'));
  const result=await verify(report);
  fs.mkdirSync(path.dirname(path.resolve(dest)),{recursive:true});
  fs.writeFileSync(dest,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(result,null,2));
  if(!result.passed)process.exitCode=1;
}
if(require.main===module){
  main().catch(()=>{
    console.error('NYC_DOB_SECOND_READBACK_REVIEW_REQUIRED');
    process.exitCode=1;
  });
}
module.exports={VERSION,MAX_CASES,excerpt,officialTarget,verify};
