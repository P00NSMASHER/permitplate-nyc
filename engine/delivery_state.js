'use strict';

const crypto=require('node:crypto');

function isoTime(value,name='time'){
  const t=new Date(value);
  if(!Number.isFinite(t.getTime())) throw new Error(`Invalid ${name}`);
  return t.toISOString();
}

function makeMessageId(subscriberId,deliveryKey,domain='permitplate.invalid'){
  const seed=`${subscriberId}\n${deliveryKey}`;
  const digest=crypto.createHash('sha256').update(seed).digest('hex').slice(0,32);
  return `<pp-${digest}@${domain}>`;
}

function planDelivery({subscriberId,deliveryKey,now,domain}){
  if(!subscriberId||!deliveryKey) throw new Error('subscriberId and deliveryKey required');
  return {
    subscriberId:String(subscriberId),
    deliveryKey:String(deliveryKey),
    messageId:makeMessageId(subscriberId,deliveryKey,domain),
    state:'PLANNED',
    attemptCount:0,
    providerMessageId:null,
    plannedAt:isoTime(now,'now'),
    sendStartedAt:null,
    sentAt:null,
    nextRetryAt:null,
    lastErrorCode:null,
  };
}

function beginSend(record,now){
  if(record.state==='SENT') return {...record,shouldSend:false};
  if(record.state!=='PLANNED'&&record.state!=='RETRY_READY') throw new Error('delivery not sendable');
  return {
    ...record,
    state:'SENDING',
    attemptCount:record.attemptCount+1,
    sendStartedAt:isoTime(now,'now'),
    nextRetryAt:null,
    lastErrorCode:null,
    shouldSend:true,
  };
}

function markProviderAccepted(record,providerMessageId,now){
  if(record.state!=='SENDING') throw new Error('delivery is not sending');
  if(!providerMessageId) throw new Error('providerMessageId required');
  return {
    ...record,
    state:'SENT',
    providerMessageId:String(providerMessageId),
    sentAt:isoTime(now,'now'),
    nextRetryAt:null,
    lastErrorCode:null,
    shouldSend:false,
  };
}

/**
 * Recovery after an uncertain provider call.
 *
 * Caller must search the owner-controlled Sent mailbox for record.messageId
 * before asking this function to permit a retry. A found message means the
 * original send succeeded and the local ledger should finalize without another
 * provider call. A missing message remains non-sendable until grace expires.
 */
function reconcileUncertain(record,{now,foundProviderMessageId=null,graceSeconds=120}){
  if(record.state!=='SENDING') throw new Error('only SENDING delivery can be reconciled');
  const current=new Date(isoTime(now,'now')).getTime();
  const started=new Date(record.sendStartedAt).getTime();

  if(foundProviderMessageId){
    return {
      ...record,
      state:'SENT',
      providerMessageId:String(foundProviderMessageId),
      sentAt:isoTime(now,'now'),
      nextRetryAt:null,
      lastErrorCode:null,
      shouldSend:false,
      recoveredBy:'SENT_MAIL_RECONCILIATION',
    };
  }

  const retryAt=started+graceSeconds*1000;
  if(current<retryAt){
    return {
      ...record,
      state:'SENDING',
      nextRetryAt:new Date(retryAt).toISOString(),
      lastErrorCode:'provider_outcome_uncertain',
      shouldSend:false,
    };
  }

  return {
    ...record,
    state:'RETRY_READY',
    nextRetryAt:new Date(current).toISOString(),
    lastErrorCode:'provider_receipt_not_found',
    shouldSend:false,
  };
}

function markDefiniteFailure(record,errorCode,now,{retryable=true,maxAttempts=3}={}){
  if(record.state!=='SENDING') throw new Error('delivery is not sending');
  if(!/^[a-z][a-z0-9_]{0,63}$/.test(String(errorCode))) throw new Error('fixed error code required');
  const exhausted=record.attemptCount>=maxAttempts;
  return {
    ...record,
    state:retryable&&!exhausted?'RETRY_READY':'FAILED',
    nextRetryAt:retryable&&!exhausted?isoTime(now,'now'):null,
    lastErrorCode:exhausted&&retryable?'retry_exhausted':String(errorCode),
    shouldSend:false,
  };
}

module.exports={makeMessageId,planDelivery,beginSend,markProviderAccepted,reconcileUncertain,markDefiniteFailure};
