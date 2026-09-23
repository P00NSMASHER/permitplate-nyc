'use strict';

const fs=require('fs');
const path=require('path');
const stripeSubscriber=require('./stripe-subscriber');
const subscriberArtifact=require('./subscriber-artifact');
const customerMessage=require('./customer-message');
const delivery=require('./delivery-plan');
const transport=require('./transport-authorization');
const privateSheet=require('./private-sheet-mapping');

const RUNNER_VERSION='PermitPlate-subscriber-intake-v1.0.0';
const EXPECTED_PRICE_ID='price_1UFjcWDPW8riWrxQhnrPX6nc';
const ROOT=path.resolve(__dirname,'..');

function readJson(filePath){
  return JSON.parse(fs.readFileSync(path.resolve(filePath),'utf8'));
}

function privateMaterialPath(filePath){
  const resolved=path.resolve(filePath);
  const relative=path.relative(ROOT,resolved).replace(/\\/g,'/');
  if(relative.startsWith('../')||path.isAbsolute(relative)) return resolved;
  if(relative==='.private-state'||relative.startsWith('.private-state/')) return resolved;
  if(relative==='state'||relative.startsWith('state/')) return resolved;
  throw new Error('PRIVATE_MATERIAL_PATH_REQUIRED');
}

function deliveredKeys(value){
  if(Array.isArray(value)) return value.map(String);
  if(value&&Array.isArray(value.deliveredSignalKeys)){
    return value.deliveredSignalKeys.map(String);
  }
  throw new Error('DELIVERED_SIGNAL_KEYS_ARRAY_REQUIRED');
}

function intakeReceipt(input){
  const data=input||{};
  const stripe=data.stripe||{};
  const artifact=data.artifact||{};
  const message=data.message||{};
  const attempt=data.attempt||{};
  const preflight=data.transportPreflight||{};
  return {
    runnerVersion:RUNNER_VERSION,
    status:data.status,
    checkoutSessionId:stripe.checkoutSessionId||null,
    subscriptionId:stripe.subscriptionId||null,
    preferenceSource:stripe.preferenceSource||null,
    preferenceReceiptId:stripe.preferenceReceiptId||null,
    profileFingerprint:stripe.profileFingerprint||null,
    artifactFingerprint:artifact.artifactFingerprint||null,
    messageFingerprint:message.messageFingerprint||null,
    attemptId:attempt.attemptId||null,
    messageIdentity:attempt.messageIdentity||null,
    signalCount:Number(artifact.signalCount||0),
    normalCount:Number(artifact.normalCount||0),
    starterCount:Number(artifact.starterCount||0),
    transportAllowed:preflight.allowed===true,
    transportFailures:Array.isArray(preflight.failures)?preflight.failures.slice():[],
    failures:Array.isArray(data.failures)?data.failures.slice():[]
  };
}

function buildIntake(input){
  const data=input||{};
  const stripe=stripeSubscriber.profileFromCheckout({
    session:data.session||{},
    subscription:data.subscription||null,
    expectedPriceId:data.expectedPriceId||EXPECTED_PRICE_ID
  });

  if(stripe.status!=='ACTIVE'){
    const result={
      status:'REVIEW',
      failures:['SUBSCRIBER_ACTIVATION_FAILED',...(stripe.failures||[])],
      stripe,
      artifact:null,
      message:null,
      attempt:null,
      transportPreflight:{allowed:false,failures:['ARTIFACT_NOT_READY']},
      subscriberProfileRow:null,
      deliveryStatePlan:null
    };
    result.receipt=intakeReceipt(result);
    return result;
  }

  const artifact=subscriberArtifact.buildSubscriberArtifact({
    opportunityLedger:data.opportunityLedger,
    profile:{
      status:'ACTIVE',
      profile:stripe.profile,
      profileFingerprint:stripe.profileFingerprint
    },
    deliveredSignalKeys:deliveredKeys(data.deliveredSignalKeys||[]),
    reportDate:data.reportDate
  });

  if(artifact.status!=='READY'){
    const result={
      status:'REVIEW',
      failures:['SUBSCRIBER_ARTIFACT_FAILED',...(artifact.failures||[])],
      stripe,
      artifact,
      message:null,
      attempt:null,
      transportPreflight:{allowed:false,failures:['ARTIFACT_NOT_READY']},
      subscriberProfileRow:privateSheet.subscriberProfileRow(stripe),
      deliveryStatePlan:null
    };
    result.receipt=intakeReceipt(result);
    return result;
  }

  const message=customerMessage.renderCustomerMessage({
    artifact,
    reportDate:data.reportDate
  });
  const subscriberProfileRow=privateSheet.subscriberProfileRow(stripe);

  if(message.status==='NO_SEND'){
    const result={
      status:'NO_QUALIFYING_SIGNALS',
      failures:[],
      stripe,
      artifact,
      message,
      attempt:null,
      transportPreflight:{allowed:false,failures:['NO_QUALIFYING_SIGNALS']},
      subscriberProfileRow,
      deliveryStatePlan:null
    };
    result.receipt=intakeReceipt(result);
    return result;
  }

  const attempt=delivery.createDeliveryAttempt({
    status:'READY',
    planFingerprint:artifact.artifactFingerprint,
    signals:artifact.signalKeys.map((signalKey)=>({signalKey}))
  },stripe.profile.recipientEmail);
  const transportPreflight=transport.validateTransportAuthorization({
    artifact,
    message,
    attempt,
    authorization:null,
    now:data.now||new Date().toISOString()
  });
  if(transportPreflight.allowed===true){
    throw new Error('NO_SEND_PREFLIGHT_UNEXPECTEDLY_ALLOWED');
  }

  const deliveryStatePlan=privateSheet.deliveryStateRows({
    artifact,
    attempt,
    profile:{profile:stripe.profile,profileFingerprint:stripe.profileFingerprint}
  });
  const result={
    status:'READY_FOR_OWNER_REVIEW',
    failures:[],
    stripe,
    artifact,
    message,
    attempt,
    transportPreflight,
    subscriberProfileRow,
    deliveryStatePlan
  };
  result.receipt=intakeReceipt(result);
  return result;
}

function writePrivateArtifacts(outputDirectory,intake){
  const output=privateMaterialPath(outputDirectory);
  if(fs.existsSync(output)&&fs.readdirSync(output).length){
    throw new Error('OUTPUT_DIRECTORY_NOT_EMPTY');
  }
  fs.mkdirSync(output,{recursive:true});

  const writeJson=(name,value)=>fs.writeFileSync(
    path.join(output,name),JSON.stringify(value,null,2)+'\n'
  );
  writeJson('intake-receipt.json',intake.receipt);
  writeJson('subscriber-profile.json',intake.stripe);
  if(intake.subscriberProfileRow){
    writeJson('subscriber-profile-sheet-row.json',intake.subscriberProfileRow);
  }
  if(intake.artifact){
    writeJson('artifact-review.json',{
      artifactVersion:intake.artifact.artifactVersion,
      status:intake.artifact.status,
      artifactFingerprint:intake.artifact.artifactFingerprint,
      profileFingerprint:intake.artifact.profileFingerprint,
      opportunityLedgerFingerprint:intake.artifact.opportunityLedgerFingerprint,
      signalKeys:intake.artifact.signalKeys,
      excluded:intake.artifact.excluded,
      review:intake.artifact.review
    });
  }
  if(intake.message&&intake.message.status==='READY'){
    fs.writeFileSync(path.join(output,intake.message.attachment.filename),intake.message.attachment.content);
    fs.writeFileSync(path.join(output,'message.txt'),intake.message.text+'\n');
    fs.writeFileSync(path.join(output,'message.html'),intake.message.html);
  }
  if(intake.attempt){
    writeJson('delivery-review.json',{
      attempt:intake.attempt,
      transportPreflight:intake.transportPreflight,
      deliveryStatePlan:intake.deliveryStatePlan
    });
  }
  return output;
}

function args(argv){
  const out={};
  for(let i=0;i<argv.length;i+=1){
    const token=argv[i];
    if(!token.startsWith('--')) throw new Error('ARGUMENT_NAME_REQUIRED:'+token);
    const key=token.slice(2);
    const value=argv[i+1];
    if(!value||value.startsWith('--')) throw new Error('ARGUMENT_VALUE_REQUIRED:'+key);
    out[key]=value;
    i+=1;
  }
  return out;
}

function main(){
  const options=args(process.argv.slice(2));
  for(const required of ['checkout','opportunities','output']){
    if(!options[required]) throw new Error('REQUIRED_ARGUMENT_MISSING:'+required);
  }
  const checkoutPath=privateMaterialPath(options.checkout);
  const opportunityPath=privateMaterialPath(options.opportunities);
  const deliveredPath=options.delivered?privateMaterialPath(options.delivered):null;
  const checkout=readJson(checkoutPath);
  const result=buildIntake({
    session:checkout.session,
    subscription:checkout.subscription,
    expectedPriceId:checkout.expectedPriceId||EXPECTED_PRICE_ID,
    opportunityLedger:readJson(opportunityPath),
    deliveredSignalKeys:deliveredPath?deliveredKeys(readJson(deliveredPath)):[],
    reportDate:options['report-date']||new Date().toISOString().slice(0,10)
  });
  const output=writePrivateArtifacts(options.output,result);
  console.log(JSON.stringify({
    runnerVersion:RUNNER_VERSION,
    status:result.status,
    signalCount:result.receipt.signalCount,
    transportAllowed:result.receipt.transportAllowed,
    transportFailures:result.receipt.transportFailures,
    output
  },null,2));
  if(result.status==='REVIEW') process.exitCode=1;
}

if(require.main===module){
  try{ main(); }
  catch(error){ console.error(error.message); process.exit(1); }
}

module.exports={
  RUNNER_VERSION,
  EXPECTED_PRICE_ID,
  ROOT,
  readJson,
  privateMaterialPath,
  deliveredKeys,
  intakeReceipt,
  buildIntake,
  writePrivateArtifacts,
  args
};
