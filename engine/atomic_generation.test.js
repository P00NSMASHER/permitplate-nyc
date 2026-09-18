'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {
  beginGeneration,failStaleGenerations,stageGeneration,applyValidation,promotionPlan,
  markCommitted,verifyReadback,deliveryAllowed
}=require('./atomic_generation');

const VHEAD=['Venue Key','Best Score'];
const LHEAD=['Lead Key','Venue Key'];
const venues=[{'Venue Key':'A','Best Score':70},{'Venue Key':'B','Best Score':80}];
const leads=[{'Lead Key':'L1','Venue Key':'A'},{'Lead Key':'L2','Venue Key':'B'}];

function started(){
  return beginGeneration({generationId:'gen-1',startedAt:'2026-09-18T12:00:00Z',expectedVenueRows:2,expectedLeadRows:2,sourceHealth:'DOHMH PASS; SLA PASS; DOB PASS'});
}

test('STARTED/STAGED generation older than two hours fails closed',()=>{
  const s=started();
  let rows=failStaleGenerations([s],'2026-09-18T14:00:01Z');
  assert.equal(rows[0].Status,'FAILED');
  assert.match(rows[0]['Commit Status'],/STALE/);

  const fresh=failStaleGenerations([s],'2026-09-18T13:59:59Z')[0];
  assert.equal(fresh.Status,'STARTED');
});

test('validation failure never produces promotion and blocks delivery',()=>{
  let r=stageGeneration(started(),{venueRows:venues,leadRows:leads});
  r=applyValidation(r,{pass:false,errors:['BAD_SCORE']},'2026-09-18T12:05:00Z');
  assert.equal(r.Status,'FAILED');
  assert.equal(r['Validation Status'],'FAIL');
  assert.equal(r['Commit Status'],'NOT_ATTEMPTED');
  assert.equal(deliveryAllowed(r),false);
  assert.throws(()=>promotionPlan(r,{venueRows:venues,leadRows:leads}));
});

test('promotion plan includes Graph Leads and Run Control in one atomic plan',()=>{
  let r=stageGeneration(started(),{venueRows:venues,leadRows:leads});
  r=applyValidation(r,{pass:true,errors:[]},'2026-09-18T12:05:00Z');
  const p=promotionPlan(r,{venueRows:venues,leadRows:leads});
  assert.equal(p.atomic,true);
  assert.deepEqual(p.operations.map(x=>x.target),['Venue Graph','Leads','Run Control']);
  assert.equal(p.operations[2].update.Status,'COMMITTED');
});

test('delivery remains blocked until exact readback verification passes',()=>{
  let r=stageGeneration(started(),{venueRows:venues,leadRows:leads});
  r=applyValidation(r,{pass:true,errors:[]},'2026-09-18T12:05:00Z');
  r=markCommitted(r,'2026-09-18T12:06:00Z');
  assert.equal(deliveryAllowed(r),false);
  r=verifyReadback(r,{stagedVenues:venues,liveVenues:[...venues].reverse(),stagedLeads:leads,liveLeads:[...leads].reverse(),venueHeaders:VHEAD,leadHeaders:LHEAD});
  assert.equal(r.Status,'COMMITTED');
  assert.equal(deliveryAllowed(r),true);
});

test('count, key-set, or value mismatch becomes COMMIT_VERIFY_FAIL',()=>{
  function committed(){
    let r=stageGeneration(started(),{venueRows:venues,leadRows:leads});
    r=applyValidation(r,{pass:true,errors:[]},'2026-09-18T12:05:00Z');
    return markCommitted(r,'2026-09-18T12:06:00Z');
  }
  let r=verifyReadback(committed(),{stagedVenues:venues,liveVenues:[venues[0]],stagedLeads:leads,liveLeads:leads,venueHeaders:VHEAD,leadHeaders:LHEAD});
  assert.equal(r.Status,'COMMIT_VERIFY_FAIL');
  assert.equal(deliveryAllowed(r),false);

  r=verifyReadback(committed(),{stagedVenues:venues,liveVenues:[venues[0],{'Venue Key':'C','Best Score':80}],stagedLeads:leads,liveLeads:leads,venueHeaders:VHEAD,leadHeaders:LHEAD});
  assert.equal(r.Status,'COMMIT_VERIFY_FAIL');

  r=verifyReadback(committed(),{stagedVenues:venues,liveVenues:[venues[0],{'Venue Key':'B','Best Score':79}],stagedLeads:leads,liveLeads:leads,venueHeaders:VHEAD,leadHeaders:LHEAD});
  assert.equal(r.Status,'COMMIT_VERIFY_FAIL');
  assert.match(r.Notes,/VENUE_VALUE_MISMATCH/);
});

test('promotion refuses row-count drift from expected generation',()=>{
  let r=stageGeneration(started(),{venueRows:venues,leadRows:leads});
  r=applyValidation(r,{pass:true,errors:[]},'2026-09-18T12:05:00Z');
  assert.throws(()=>promotionPlan(r,{venueRows:[venues[0]],leadRows:leads}));
});
