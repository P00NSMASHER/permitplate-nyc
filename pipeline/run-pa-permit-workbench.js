'use strict';
// Operator-only private local case workbench. It writes no Git commits,
// performs no payment action or email send, and logs aggregate status only.
const fs=require('node:fs');
const path=require('node:path');
const core=require('./pa-permit-orders');
const fulfil=require('./pa-permit-fulfillment');
const delivery=require('./pa-permit-delivery-readback');
const recovery=require('./pa-permit-recovery');
const {privateMaterialPath}=require('./run-subscriber-intake');
const {writeAtomic,priorHealth}=require('./run-pa-permit-intake');
function read(file){
  return JSON.parse(fs.readFileSync(privateMaterialPath(file),'utf8'));
}
function writePrivate(file,content){
  const dst=privateMaterialPath(file);
  fs.mkdirSync(path.dirname(dst),{recursive:true});
  fs.writeFileSync(dst,content,{flag:'wx',mode:0o600});
}
function renderQueue(ledger){
  const counts={};
  for(const order of Object.values(ledger.orders)){
    counts[order.phase]=(counts[order.phase]||0)+1;
  }
  return {version:'PermitPlate-PA-private-workbench-v1.0.0',
    providerLastCheckedAt:ledger.checkedAt,
    totalPaidOrders:Object.keys(ledger.orders).length,
    phases:counts,externalSendCalls:0,automaticDeliveryAllowed:false};
}
function createDraft(order){
  if(!order||order.phase==='DELIVERED_PROVIDER_VERIFIED'){
    throw Error('PA_CASE_DRAFT_NOT_ELIGIBLE');
  }
  return {
    privateCase:true,checkoutSessionId:order.checkoutSessionId,
    paymentVerified:order.verifiedPayment,recipientEmail:order.email,
    source:'REGISTERED_PAID_PROVIDER_CHECKOUT',
    initialProject:order.project,
    verifiedOperatorOverride:order.projectOverride||null,
    draftOnly:true,
    researchTemplate:{
      researcherId:'REPLACE_WITH_REAL_RESEARCHER_ALIAS',
      preparedAt:'REPLACE_WITH_ACTUAL_UTC_TIME',
      projectSummary:'REPLACE_WITH_VERIFIED_PROJECT_DESCRIPTION',
      jurisdiction:'REPLACE_WITH_VERIFIED_JURISDICTION',
      authorityName:'REPLACE_WITH_VERIFIED_AUTHORITY',
      publicFeeNotes:'REPLACE_WITH_VERIFIED_PUBLIC_FEE_INFORMATION_OR_UNKNOWN',
      sources:[
        {sourceId:'PA_DLI_REFERENCE',url:'https://www.pa.gov/agencies/dli.html',
          claim:'VERIFY_SOURCE_WITH_FULL_OFFICIAL_CONTEXT_AND_UPDATE_THIS',
          observedAt:'ACTUAL_UTC_TIME',verifiedByHuman:false}
      ],
      filingSteps:[{action:'VERIFY_SPECIFIC_REQUIREMENT_FROM_OFFICIAL_SOURCE',
        sourceUrl:'https://www.pa.gov/agencies/dli.html'}],
      unresolvedQuestions:['VERIFY_EXACT_JURISDICTION_AND_LOCAL_OFFICE'],
      claimsGovernmentApproval:false,claimsLegalAdvice:false,
      claimsNoFurtherVerification:false
    },
    neverPublishToPublicRepo:true,neverAutoSend:true
  };
}
async function run(argv,now){
  const [mode,ledgerFile,anchorFile,sessionId,packetFile,outFile]=argv;
  if(!['status','recovery-plan','resolve-hold','draft','research','qc','record-accepted','verify-delivery','report'].includes(mode)||
     !ledgerFile||!anchorFile){
    throw Error('PA_WORKBENCH_USAGE_INVALID');
  }
  const ledger=read(ledgerFile),anchor=read(anchorFile);
  const health=priorHealth(ledger,anchor);
  if(!health.valid)throw Error('PA_PRIVATE_STATE_PAIR_INVALID');
  if(mode==='status')return renderQueue(ledger);
  if(mode==='recovery-plan')return recovery.plan(ledger,anchor,now||new Date().toISOString());
  if(!core.id(sessionId,'cs'))throw Error('PA_ORDER_ID_REQUIRED');
  const order=ledger.orders[sessionId];
  if(!order)throw Error('PA_ORDER_NOT_FOUND_IN_PRIVATE_LEDGER');
  if(mode==='draft'){
    if(!outFile)throw Error('PA_PRIVATE_DRAFT_OUTPUT_REQUIRED');
    writePrivate(outFile,JSON.stringify(createDraft(order),null,2)+'\n');
    return {status:'PRIVATE_RESEARCH_DRAFT_CREATED',externalSendCalls:0};
  }
  if(mode==='report'){
    if(!outFile)throw Error('PA_PRIVATE_REPORT_OUTPUT_REQUIRED');
    const md=fulfil.reportDraft(order);
    writePrivate(outFile,md);
    return {status:'PRIVATE_QC_REPORT_GENERATED',fingerprint:core.sha(md),
      transportAllowed:false,externalSendCalls:0};
  }
  const inputs={ledger,anchor,sessionId,now:now||new Date().toISOString()};
  let result;
  if(mode==='verify-delivery'){
    result=await delivery.verify({...inputs,key:process.env.PERMITPLATE_RESEND_READ_KEY});
  }else{
    if(!packetFile)throw Error('PA_PRIVATE_EVIDENCE_INPUT_REQUIRED');
    const evidence=read(packetFile);
    if(mode==='research')result=fulfil.submitResearch({...inputs,research:evidence});
    if(mode==='qc')result=fulfil.qc({...inputs,review:evidence});
    if(mode==='resolve-hold')result=recovery.resolveHold({...inputs,evidence});
    if(mode==='record-accepted'){
      result=fulfil.recordSendReceipt({...inputs,receipt:evidence});
    }
  }
  if(result.ledger&&result.ledger!==ledger&&result.status!=='UNCHANGED'){
    writeAtomic(ledgerFile,result.ledger);
  }
  return {status:result.status,failures:result.failures||[],
    stateCommittedToLocalPrivateFile:Boolean(result.ledger&&result.ledger!==ledger),
    independentProviderReceiptVerified:result.status==='DELIVERED_PROVIDER_VERIFIED',
    transportAllowed:false,externalSendCalls:0};
}
async function main(){
  const result=await run(process.argv.slice(2));
  console.log(JSON.stringify(result,null,2));
  if(result.status==='REVIEW')process.exitCode=1;
}
if(require.main===module){
  main().catch(e=>{
    const message=String(e.message||'');
    console.error(/^PA_[A-Z0-9_]+$/.test(message)?message:'PA_WORKBENCH_FAILED_CLOSED');
    process.exitCode=1;
  });
}
module.exports={read,writePrivate,renderQueue,createDraft,run};
