'use strict';
// Deterministic operator research/QC and provider-receipt tracking; NO SEND.
const core=require('./pa-permit-orders');
function text(v,min=10,max=4000){
  return typeof v==='string'&&v.trim().length>=min&&v.length<=max&&
    !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(v);
}
function validUrl(v){
  if(typeof v!=='string'||v.length>900)return false;
  try{
    const u=new URL(v);
    return u.protocol==='https:'&&!u.port&&!u.username&&!u.password&&!u.hash&&
      u.hostname.includes('.')&&!/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname)&&
      !/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname);
  }catch{return false}
}
function govUrl(u){
  if(!validUrl(u))return false;
  const h=new URL(u).hostname.toLowerCase();
  return h.endsWith('.gov')||h.endsWith('.pa.us');
}
function researchErrors(x,paidAt){
  x=x||{};
  const errors=[];
  if(!text(x.researcherId,3,64)||!/^[A-Za-z0-9_-]+$/.test(x.researcherId||'')){
    errors.push('PA_RESEARCHER_ID_INVALID');
  }
  if(!core.iso(x.preparedAt)||x.preparedAt<paidAt){
    errors.push('PA_RESEARCH_TIMESTAMP_INVALID');
  }
  for(const f of ['projectSummary','jurisdiction','authorityName','publicFeeNotes']){
    if(!text(x[f],12,4000))errors.push('PA_RESEARCH_FIELD_INCOMPLETE');
  }
  if(!Array.isArray(x.sources)||x.sources.length<2||x.sources.length>20){
    errors.push('PA_RESEARCH_SOURCES_INCOMPLETE');
  }else{
    const seen=new Set();
    for(const s of x.sources){
      if(!validUrl(s?.url)||seen.has(s?.url)||!text(s?.sourceId,3,180)||
         !text(s?.claim,20,900)||!core.iso(s?.observedAt)||
         s.verifiedByHuman!==true){
        errors.push('PA_RESEARCH_SOURCE_UNVERIFIED');
      }
      seen.add(s?.url);
    }
    if(!x.sources.some(s=>govUrl(s?.url)))errors.push('PA_RESEARCH_PRIMARY_GOVERNMENT_SOURCE_MISSING');
  }
  if(!Array.isArray(x.filingSteps)||x.filingSteps.length<2||
     x.filingSteps.length>15||x.filingSteps.some(s=>
       !text(s?.action,15,900)||!validUrl(s?.sourceUrl)||
       !x.sources?.some(y=>y.url===s.sourceUrl))){
    errors.push('PA_RESEARCH_STEPS_UNSUPPORTED');
  }
  if(!Array.isArray(x.unresolvedQuestions)||x.unresolvedQuestions.length<1||
     x.unresolvedQuestions.length>15||
     x.unresolvedQuestions.some(q=>!text(q,15,900))){
    errors.push('PA_UNRESOLVED_QUESTIONS_REQUIRED');
  }
  if(x.claimsGovernmentApproval===true||x.claimsLegalAdvice===true||
     x.claimsNoFurtherVerification===true)errors.push('PA_FORBIDDEN_SERVICE_CLAIM');
  return [...new Set(errors)];
}
function validState(ledger,anchor){
  const checked=core.validate(ledger);
  if(!checked.valid||!core.verifyAnchor(ledger,anchor)){
    throw Error('PA_PRIVATE_ORDER_INTEGRITY_INVALID');
  }
}
function mutate(data,sessionId,fn){
  const ledger=data?.ledger;
  validState(ledger,data?.anchor);
  const now=core.iso(data?.now);
  if(!now||now<ledger.checkedAt)throw Error('PA_OPERATIONS_TIMESTAMP_INVALID');
  if(!ledger.orders[sessionId])throw Error('PA_ORDER_NOT_REGISTERED_BY_LIVE_STRIPE');
  const orders=structuredClone(ledger.orders);
  const target=orders[sessionId];
  fn(target,now);
  if(target.history.length>50)throw Error('PA_ORDER_HISTORY_LIMIT');
  const next=core.seal({...ledger,orders});
  if(!core.validate(next).valid)throw Error('PA_ORDER_STATE_INTEGRITY_INVALID');
  return next;
}
function submitResearch(data){
  const order=data?.ledger?.orders?.[data.sessionId];
  if(!order||!['RESEARCH_QUEUE','QC_HOLD','RESEARCH_SUBMITTED'].includes(order.phase)||
     !order.projectValid)throw Error('PA_RESEARCH_CASE_NOT_ELIGIBLE');
  const errors=researchErrors(data.research,order.paidAt);
  if(!core.iso(data.now)||data.research?.preparedAt>data.now){
    errors.push('PA_RESEARCH_FUTURE_OR_MISSING_RUN_TIME');
  }
  if(errors.length)return {status:'REVIEW',failures:[...new Set(errors)]};
  const fingerprint=core.sha(data.research);
  if(order.phase==='RESEARCH_SUBMITTED'&&order.research?.fingerprint===fingerprint){
    return {status:'UNCHANGED',ledger:data.ledger};
  }
  const ledger=mutate(data,data.sessionId,(draft,at)=>{
    draft.phase='RESEARCH_SUBMITTED';
    draft.research={...data.research,fingerprint,registeredAt:at};
    draft.quality=null;draft.delivery=null;
    draft.history.push({at,action:'OWNER_RESEARCH_PACKET_SUBMITTED'});
  });
  return {status:'RESEARCH_RECORDED_NO_SEND',ledger};
}
function qc(data){
  const order=data?.ledger?.orders?.[data.sessionId];
  if(!order||order.phase!=='RESEARCH_SUBMITTED'||!order.research){
    throw Error('PA_QC_RESEARCH_NOT_READY');
  }
  const r=data.review||{};
  if(!text(r.reviewerId,3,64)||!/^[A-Za-z0-9_-]+$/.test(r.reviewerId||'')||
     r.reviewerId===order.research.researcherId||
     !core.iso(r.reviewedAt)||r.reviewedAt<order.research.preparedAt||
     !core.iso(data.now)||r.reviewedAt>data.now||
     r.expectedResearchFingerprint!==order.research.fingerprint||
     !text(r.limitations,25,1200)){
    return {status:'REVIEW',failures:['PA_QC_REVIEWER_AND_RESEARCH_BINDING_REQUIRED']};
  }
  const passed=r.sourceUrlsIndependentlyChecked===true&&
    r.projectAddressIndependentlyChecked===true&&
    r.authorityJurisdictionConfirmed===true&&
    r.restrictionsAcknowledged===true&&r.approve===true;
  const ledger=mutate(data,data.sessionId,(draft,at)=>{
    draft.phase=passed?'READY_FOR_MANUAL_DELIVERY':'QC_HOLD';
    draft.quality={
      reviewerId:r.reviewerId,reviewedAt:r.reviewedAt,
      researchFingerprint:order.research.fingerprint,
      limitations:r.limitations,approvalAttested:passed,
      independentlyAuthenticatedReviewer:false,recordedAt:at
    };
    draft.history.push({at,action:passed?'QC_ATTESTED_MANUAL_SEND_ONLY':'QC_REJECTED_HOLD'});
  });
  return {status:passed?'QC_ATTESTED_MANUAL_SEND_ONLY':'QC_HOLD',
    ledger,independentReviewerAuthenticationProven:false,externalSendCalls:0};
}
// A manually entered send receipt cannot prove actual delivery.
function recordSendReceipt(data){
  const order=data?.ledger?.orders?.[data.sessionId];
  if(!order||order.phase!=='READY_FOR_MANUAL_DELIVERY'||
     order.quality?.approvalAttested!==true)throw Error('PA_SEND_RECEIPT_CASE_NOT_READY');
  const r=data.receipt||{};
  if(r.provider!=='RESEND'||!core.iso(r.sentAt)||
     !core.iso(data.now)||r.sentAt>data.now||
     r.sentAt<order.quality.reviewedAt||
     !/^[0-9a-fA-F-]{30,40}$/.test(r.messageId||'')||
     String(r.recipient||'').toLowerCase()!==order.email||
     r.expectedResearchFingerprint!==order.research.fingerprint||
     r.expectedReportFingerprint!==core.sha(reportDraft(order))||
     r.sentSubject!=='PA Permit Pack | Public-Source Research'||
     !expectedSender(r.expectedSender)||
     r.ownerManuallyAuthorized!==true){
    return {status:'REVIEW',failures:['PA_EXTERNAL_SEND_RECEIPT_INCOMPLETE']};
  }
  const ledger=mutate(data,data.sessionId,(draft,at)=>{
    draft.phase='PROVIDER_DELIVERY_PENDING';
    draft.delivery={
      provider:'RESEND',messageId:r.messageId,recipient:order.email,
      sentAt:r.sentAt,researchFingerprint:order.research.fingerprint,
      reportFingerprint:r.expectedReportFingerprint,
      subject:r.sentSubject,sender:r.expectedSender,
      verification:'PENDING_PROVIDER_READBACK',registeredAt:at
    };
    draft.history.push({at,action:'DECLARED_SEND_PENDING_PROVIDER_VERIFICATION'});
  });
  return {status:'PROVIDER_READBACK_REQUIRED',ledger,externalSendCalls:0};
}
function providerCreatedAt(value){
  if(typeof value!=='string'||value.length>45||
     !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/.test(value)){
    return null;
  }
  const normalized=value.replace(' ','T').replace(/([+-]\d{2})$/,'$1:00')
    .replace(/([+-]\d{2})(\d{2})$/,'$1:$2');
  const ms=Date.parse(normalized);
  return Number.isFinite(ms)?new Date(ms).toISOString():null;
}
function expectedSender(value){
  if(typeof value!=='string'||value.length>160||/[\r\n]/.test(value))return false;
  if(core.email(value))return true;
  const match=/^[A-Za-z0-9 .,'-]{2,80} <([^<>]+)>$/.exec(value);
  return Boolean(match&&core.email(match[1]));
}
function verifiedDelivery(data){
  const order=data?.ledger?.orders?.[data.sessionId];
  if(!order||order.phase!=='PROVIDER_DELIVERY_PENDING'||!order.delivery){
    throw Error('PA_DELIVERY_AWAITING_PROVIDER_MESSAGE_ID');
  }
  const response=data.providerResponse||{},msg=order.delivery;
  const to=Array.isArray(response.to)?response.to:[response.to];
  const createdAt=providerCreatedAt(response.created_at);
  const providerMs=Date.parse(createdAt||'');
  const acceptedMs=Date.parse(msg.sentAt);
  const checkedMs=Date.parse(core.iso(data.now)||'');
  // Resend created_at may be an offset timestamp with microseconds.
  // The provider may create an email just before the owner records the
  // accepted send; tolerate ten minutes, never unbounded time drift.
  const withinSendWindow=Number.isFinite(providerMs)&&
    Number.isFinite(acceptedMs)&&Number.isFinite(checkedMs)&&
    providerMs>=Date.parse(order.paidAt)&&
    Math.abs(providerMs-acceptedMs)<=10*60*1000&&
    providerMs<=checkedMs;
  if(response.id!==msg.messageId||to.length!==1||
     String(to[0]).toLowerCase()!==order.email||
     response.from!==msg.sender||
     !['delivered','opened','clicked'].includes(response.last_event)||
     !withinSendWindow||
     response.subject!==msg.subject||
     (response.html!=null&&response.html!=='')||
     (Array.isArray(response.cc)&&response.cc.length>0)||
     (Array.isArray(response.bcc)&&response.bcc.length>0)||
     typeof response.text!=='string'||core.sha(response.text)!==msg.reportFingerprint){
    return {status:'REVIEW',failures:['PA_PROVIDER_DELIVERY_NOT_INDEPENDENTLY_VERIFIED']};
  }
  const ledger=mutate(data,data.sessionId,(draft,at)=>{
    draft.phase='DELIVERED_PROVIDER_VERIFIED';
    draft.delivery={...draft.delivery,verification:'PROVIDER_READBACK_VERIFIED',
      providerLastEvent:response.last_event,
      providerCreatedAt:createdAt,providerReadbackAt:at,
      providerReceiptFingerprint:core.sha({
        id:response.id,to,created_at:response.created_at,last_event:response.last_event
      })};
    draft.history.push({at,action:'PROVIDER_DELIVERY_CONFIRMED'});
  });
  return {status:'DELIVERED_PROVIDER_VERIFIED',ledger};
}
function reportDraft(order){
  if(!order?.projectValid||!order.research||!order.quality?.approvalAttested){
    throw Error('PA_REPORT_NOT_QC_READY');
  }
  const esc=x=>String(x).replace(/[\\*_{}\[\]()#+.!|><]/g,'\\$&')
    .replace(/[\r\n]+/g,' ');
  const r=order.research;
  return [
    '# PA Permit Pack — Owner-reviewed research',
    '',
    '**PRIVATE DELIVERY ARTIFACT — manual owner send only.**','',
    'Project: '+esc((order.projectOverride||order.project).projectAddress),
    'Municipality and county: '+esc((order.projectOverride||order.project).municipality),
    'Project scope: '+esc((order.projectOverride||order.project).projectScope),'',
    '## Likely authority and jurisdiction',
    esc(r.jurisdiction)+' — '+esc(r.authorityName),'',
    '## Project interpretation',esc(r.projectSummary),'',
    '## Filing and verification steps',
    ...r.filingSteps.map((s,i)=>
      (i+1)+'. '+esc(s.action)+' (source: '+s.sourceUrl+')'),'',
    '## Public fees and limits',esc(r.publicFeeNotes),'',
    '## Questions to verify with the applicable authority',
    ...r.unresolvedQuestions.map(q=>'- '+esc(q)),'',
    '## Reviewed primary-source references',
    ...r.sources.map(s=>'- '+esc(s.claim)+' — '+s.url+' (observed '+s.observedAt+')'),'',
    '**Not a government permit decision, engineering/legal advice, or guarantee.**',
    'Confirm requirements with the applicable authority before filing or work.'
  ].join('\n')+'\n';
}
module.exports={text,validUrl,govUrl,researchErrors,validState,mutate,
  providerCreatedAt,expectedSender,
  submitResearch,qc,recordSendReceipt,verifiedDelivery,reportDraft};
