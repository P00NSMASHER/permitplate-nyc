'use strict';

const curated=require('./founder-curated-offer');
const delivery=require('./delivery-plan');
const transport=require('./transport-authorization');

const CANARY_VERSION='PermitPlate-founder-curated-canary-v1.0.0';

function run(){
  const brief=curated.buildCuratedBrief({
    subscriptionId:'sub_canary_curated',
    recipientEmail:'canary@permitplate.invalid',
    preparedAt:'2026-09-23T12:00:00Z',
    reviewer:'FOUNDER_CANARY',
    ownerReviewed:true,
    preferences:{category:'equipment',territory:'Brooklyn',starter:'yes'},
    signals:[{
      signalKey:'curated:canary:1',
      businessName:'Canary Kitchen',
      address:'100 Example Avenue',
      borough:'Brooklyn',
      stage:'Buildout record changed',
      whyItMatters:'A current official record gives equipment vendors a timely account to research.',
      sourceUpdatedAt:'2026-09-22T15:00:00Z',
      reviewedAt:'2026-09-23T12:00:00Z',
      sourceUrls:['https://data.cityofnewyork.us/resource/example.json?id=canary']
    }]
  });
  if(brief.status!=='READY') throw new Error('CURATED_CANARY_ARTIFACT_NOT_READY');

  const attempt=delivery.createDeliveryAttempt({
    status:'READY',
    planFingerprint:brief.artifactFingerprint,
    signals:brief.signalKeys.map((signalKey)=>({signalKey}))
  },brief.recipientEmail);
  const transportPreflight=transport.validateTransportAuthorization({
    artifact:{
      status:'READY',artifactFingerprint:brief.artifactFingerprint,
      signalKeys:brief.signalKeys
    },
    message:{
      status:'READY',messageFingerprint:brief.messageFingerprint,
      signalKeys:brief.signalKeys
    },
    attempt,
    authorization:null,
    now:'2026-09-23T12:00:00Z'
  });
  const headers=curated.CSV_HEADERS.join('|');
  const scoreFree=!/(?:score|rank|probability|intent|confidence)/i.test(headers);
  const passed=
    brief.launchMode===curated.LAUNCH_MODE &&
    brief.signalCount<=curated.MAX_SIGNALS &&
    scoreFree &&
    transportPreflight.allowed===false &&
    transportPreflight.failures.includes('OWNER_AUTHORIZATION_MISSING');

  return {
    canaryVersion:CANARY_VERSION,
    launchMode:curated.LAUNCH_MODE,
    passed,
    scoreFree,
    signalCount:brief.signalCount,
    artifactFingerprint:brief.artifactFingerprint,
    messageFingerprint:brief.messageFingerprint,
    transportPreflight,
    externalSendCalls:0
  };
}

if(require.main===module){
  const result=run();
  console.log(JSON.stringify(result,null,2));
  if(!result.passed) process.exitCode=1;
}

module.exports={CANARY_VERSION,run};
