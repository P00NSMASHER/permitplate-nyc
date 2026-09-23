'use strict';

const assert=require('assert');
const fs=require('fs');
const os=require('os');
const path=require('path');
const intake=require('./run-subscriber-intake');
const canary=require('./run-first-subscriber-canary');

function validInput(){
  return {
    session:canary.checkoutSession(),
    subscription:canary.subscription(),
    expectedPriceId:intake.EXPECTED_PRICE_ID,
    opportunityLedger:canary.buildCanaryOpportunityLedger(),
    deliveredSignalKeys:[],
    reportDate:'2026-09-21',
    now:'2026-09-21T17:10:00Z'
  };
}

{
  const result=intake.buildIntake(validInput());
  assert.equal(result.status,'READY_FOR_OWNER_REVIEW');
  assert.equal(result.artifact.signalCount,2);
  assert.equal(result.artifact.normalCount,1);
  assert.equal(result.artifact.starterCount,1);
  assert.equal(result.message.status,'READY');
  assert.equal(result.attempt.state,'PLANNED');
  assert.equal(result.transportPreflight.allowed,false);
  assert(result.transportPreflight.failures.includes('OWNER_AUTHORIZATION_MISSING'));
  assert.equal(result.deliveryStatePlan.deliveryStatus,'PLANNED');
  assert.equal(result.receipt.transportAllowed,false);
  assert(!Object.prototype.hasOwnProperty.call(result.receipt,'email'));
}

{
  const input=validInput();
  input.session=JSON.parse(JSON.stringify(input.session));
  input.session.custom_fields=input.session.custom_fields.filter((field)=>field.key!=='territory');
  const result=intake.buildIntake(input);
  assert.equal(result.status,'REVIEW');
  assert(result.failures.includes('TERRITORY_CUSTOM_FIELD_MISSING'));
  assert.equal(result.receipt.transportAllowed,false);
}

{
  const input=validInput();
  const first=intake.buildIntake(input);
  const replay=intake.buildIntake(Object.assign({},input,{
    deliveredSignalKeys:first.artifact.signalKeys
  }));
  assert.equal(replay.status,'NO_QUALIFYING_SIGNALS');
  assert.equal(replay.artifact.signalCount,0);
  assert.equal(replay.attempt,null);
  assert.equal(replay.receipt.transportAllowed,false);
}

{
  assert.throws(
    ()=>intake.privateMaterialPath(path.join(intake.ROOT,'checkout.json')),
    /PRIVATE_MATERIAL_PATH_REQUIRED/
  );
  assert.doesNotThrow(
    ()=>intake.privateMaterialPath(path.join(intake.ROOT,'.private-state','checkout.json'))
  );
}

{
  const result=intake.buildIntake(validInput());
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'permitplate-intake-'));
  const output=path.join(temp,'run');
  intake.writePrivateArtifacts(output,result);
  assert(fs.existsSync(path.join(output,'intake-receipt.json')));
  assert(fs.existsSync(path.join(output,'subscriber-profile.json')));
  assert(fs.existsSync(path.join(output,'message.txt')));
  assert(fs.existsSync(path.join(output,'message.html')));
  assert(fs.existsSync(path.join(output,result.message.attachment.filename)));
  assert(fs.existsSync(path.join(output,'delivery-review.json')));
  assert.throws(()=>intake.writePrivateArtifacts(output,result),/OUTPUT_DIRECTORY_NOT_EMPTY/);
  fs.rmSync(temp,{recursive:true,force:true});
}

console.log('PermitPlate private first-subscriber intake runner tests passed.');
