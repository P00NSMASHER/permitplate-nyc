'use strict';

// Private payment-to-review handoff; never sends mail, invoices or changes Stripe.
const crypto=require('node:crypto');
const stripe=require('./stripe-subscriber');
const EXPECTED_PRICE_ID='price_1UFjcWDPW8riWrxQhnrPX6nc';
const VERSION='PermitPlate-private-checkout-intake-v1.0.0';
const ANCHOR_VERSION='PermitPlate-private-checkout-anchor-v1.0.0';
function stable(v){
  if(Array.isArray(v))return '['+v.map(stable).join(',')+']';
  if(v&&typeof v==='object')return '{'+Object.keys(v).sort()
    .map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';
  return JSON.stringify(v);
}
const hash=v=>crypto.createHash('sha256').update(stable(v)).digest('hex');
function iso(s){
  let ms=Date.parse(String(s||''));
  return Number.isFinite(ms)?new Date(ms).toISOString():null;
}
function seal(obj){
  const {ledgerFingerprint,...body}=obj;
  return {...body,ledgerFingerprint:hash(body)};
}
function validate(l){
  const errors=[];
  if(!l||l.version!==VERSION||!iso(l.initializedAt)||!iso(l.checkedAt)||
      Date.parse(l.checkedAt)<Date.parse(l.initializedAt)||
      !l.subscriptions||typeof l.subscriptions!=='object'||
      Array.isArray(l.subscriptions))errors.push('INTAKE_LEDGER_INVALID');
  const {ledgerFingerprint,...body}=l||{};
  if(ledgerFingerprint!==hash(body))errors.push('INTAKE_LEDGER_FINGERPRINT_INVALID');
  for(const [id,x] of Object.entries(l?.subscriptions||{})){
    if(!id.startsWith('sub_')||!x||x.subscriptionId!==id||
        !String(x.checkoutSessionId||'').startsWith('cs_')||
        !iso(x.baselineAt)||!String(x.recipientEmail||'').includes('@')||
        !/^\d{4}-\d{2}-\d{2}$/.test(x.firstBriefTargetDate||'')||
        !['PENDING_FOUNDER_REVIEW','HOLD_SUBSCRIPTION_CHANGED'].includes(x.state)||
        x.transportAllowed!==false||x.ownerAuthorizationGranted!==false){
      errors.push('INTAKE_LEDGER_SUBSCRIPTION_INVALID');
    }
  }
  return {valid:errors.length===0,failures:[...new Set(errors)]};
}
function nyLocalDay(isoDate){
  const parts=new Intl.DateTimeFormat('en-US',{
    timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(new Date(isoDate));
  const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));
  return [Number(p.year),Number(p.month),Number(p.day)];
}
// Five following Monday-Friday dates in America/New_York.
// Holidays require separate founder adjustment; this is a target, not a claim
// about business-holiday service promises.
function firstBriefBusinessDate(createdAt){
  const date=iso(createdAt);
  if(!date)return null;
  const [y,m,d]=nyLocalDay(date);
  const cursor=new Date(Date.UTC(y,m-1,d,12));
  let count=0;
  while(count<5){
    cursor.setUTCDate(cursor.getUTCDate()+1);
    const weekday=cursor.getUTCDay();
    if(weekday!==0&&weekday!==6)count++;
  }
  return cursor.toISOString().slice(0,10);
}
function emptyLedger(now){
  if(!iso(now))throw Error('INTAKE_TIMESTAMP_INVALID');
  return seal({version:VERSION,initializedAt:now,checkedAt:now,subscriptions:{}});
}
function anchor(ledger){
  const core={
    version:ANCHOR_VERSION,initializedAt:ledger.initializedAt,
    baselineLedgerFingerprint:ledger.ledgerFingerprint
  };
  return {...core,anchorFingerprint:hash(core)};
}
function verifyAnchor(l,a){
  if(!l||!a||a.version!==ANCHOR_VERSION||
      a.initializedAt!==l.initializedAt||
      a.anchorFingerprint!==hash({
        version:a.version,initializedAt:a.initializedAt,
        baselineLedgerFingerprint:a.baselineLedgerFingerprint
      }))return false;
  return true;
}
function processSnapshot(input){
  const data=input||{},now=iso(data.checkedAt),failures=[];
  if(!now||!Array.isArray(data.sessions)||!data.subscriptionById||
      typeof data.subscriptionById!=='object'||Array.isArray(data.subscriptionById)||
      data.complete!==true)failures.push('STRIPE_SNAPSHOT_INCOMPLETE');
  const previous=data.previousLedger||emptyLedger(now||'2026-10-19T00:00:00Z');
  const verified=validate(previous);
  if(!verified.valid)failures.push(...verified.failures);
  if(now&&Date.parse(now)<Date.parse(previous.checkedAt)){
    failures.push('STRIPE_INTAKE_NON_MONOTONIC');
  }
  if(failures.length)return {status:'REVIEW',failures:[...new Set(failures)]};
  const entries=structuredClone(previous.subscriptions),seenSessionIds=new Set();
  let accepted=0,skipped=0,held=0,created=0;
  for(const session of data.sessions){
    if(!session||!String(session.id||'').startsWith('cs_')||
        session.payment_link!==stripe.PERMITPLATE_PAYMENT_LINK||
        seenSessionIds.has(session.id)){
      failures.push('STRIPE_SESSION_IDENTITY_INVALID');continue;
    }
    seenSessionIds.add(session.id);
    if(session.status!=='complete'){skipped++;continue}
    if(session.payment_status!=='paid'){
      held++;continue;
    }
    const subId=typeof session.subscription==='string'?session.subscription:
      session.subscription?.id;
    const subscription=subId?data.subscriptionById[subId]:null;
    if(!subscription){
      failures.push('STRIPE_PAID_SESSION_SUBSCRIPTION_MISSING');continue;
    }
    if(subscription.status!=='active'){held++;continue}
    const checked=stripe.profileFromCheckout({
      session,subscription,expectedPriceId:EXPECTED_PRICE_ID
    });
    if(checked.status!=='ACTIVE'){
      failures.push('STRIPE_PAID_CUSTOMER_INTAKE_INVALID');continue;
    }
    const profile=checked.profile;
    if(entries[subId]){
      if(entries[subId].checkoutSessionId!==session.id||
         entries[subId].profileFingerprint!==checked.profileFingerprint||
         entries[subId].baselineAt!==profile.baselineAt){
        failures.push('STRIPE_SUBSCRIBER_IDENTITY_CHANGED');
        continue;
      }
    }else{
      entries[subId]={
        subscriptionId:subId,checkoutSessionId:session.id,
        recipientEmail:profile.recipientEmail,
        category:profile.categories[0],
        boroughs:profile.boroughs,
        starterSnapshotEnabled:profile.starterSnapshotEnabled,
        stripeCustomerId:profile.stripeCustomerId||null,
        profileFingerprint:checked.profileFingerprint,
        baselineAt:profile.baselineAt,
        firstBriefTargetDate:firstBriefBusinessDate(profile.baselineAt),
        targetDateCalendar:'America/New_York weekdays only; holiday adjustment requires review',
        state:'PENDING_FOUNDER_REVIEW',
        transportAllowed:false,ownerAuthorizationGranted:false,
        firstDiscoveredAt:now
      };
      created++;
    }
    accepted++;
  }
  if(failures.length)return {status:'REVIEW',failures:[...new Set(failures)]};
  const ledger=seal({
    version:VERSION,initializedAt:previous.initializedAt,checkedAt:now,
    subscriptions:entries
  });
  return {status:'READY',ledger,created,accepted,skipped,held,
    totalSubscribers:Object.keys(entries).length,externalSendCalls:0,
    paymentMutations:0};
}
module.exports={VERSION,ANCHOR_VERSION,EXPECTED_PRICE_ID,stable,hash,iso,seal,
  validate,nyLocalDay,firstBriefBusinessDate,emptyLedger,anchor,verifyAnchor,
  processSnapshot};
