'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {findPredecessorCandidates,suppressionPolicy}=require('./predecessor_guard');

const current={
  camis:'50192488',dba:'Koke',address:'173 Bleecker Street',zip:'10012',firstSignalDate:'2026-09-18'
};

test('KOKE regression identifies exact-identity operational predecessor as suppression evidence',()=>{
  const rows=[{
    camis:'50184059',dba:'KOKE',address:'173 Bleecker St',zip:'10012',
    inspection_date:'2026-09-14T00:00:00.000',inspection_type:'Pre-permit (Operational) / Initial Inspection',
    action:'Establishment Closed by DOHMH'
  }];
  const out=findPredecessorCandidates(current,rows);
  assert.equal(out.length,1);
  assert.equal(out[0].predecessorCamis,'50184059');
  assert.equal(out[0].eventId,'DOHMH:50184059:2026-09-14:PREDECESSOR');
  assert.match(out[0].venueKey,/^PREDECESSOR:/);
  assert.equal(out[0].evidenceRole,'SUPPRESSION_ONLY');
});

test('same address but different DBA is not generalized into predecessor relationship',()=>{
  const out=findPredecessorCandidates(current,[{
    camis:'50184059',dba:'OTHER RESTAURANT',address:'173 Bleecker St',zip:'10012',
    inspection_date:'2026-09-14',inspection_type:'Pre-permit (Operational) / Initial Inspection',action:'Closed'
  }]);
  assert.equal(out.length,0);
});

test('same DBA but different house number or ZIP fails closed as non-match',()=>{
  for(const row of [
    {camis:'1',dba:'KOKE',address:'175 Bleecker St',zip:'10012'},
    {camis:'2',dba:'KOKE',address:'173 Bleecker St',zip:'10013'},
  ]){
    const out=findPredecessorCandidates(current,[{
      ...row,inspection_date:'2026-09-14',inspection_type:'Pre-permit (Operational)',action:'Closed'
    }]);
    assert.equal(out.length,0);
  }
});

test('different CAMIS with ordinary non-operational prepermit is not enough for automatic suppression candidate',()=>{
  const out=findPredecessorCandidates(current,[{
    camis:'50184059',dba:'KOKE',address:'173 Bleecker St',zip:'10012',
    inspection_date:'2026-09-14',inspection_type:'Pre-permit / Initial Inspection',action:''
  }]);
  assert.equal(out.length,0);
});

test('event after current signal is not treated as predecessor',()=>{
  const out=findPredecessorCandidates(current,[{
    camis:'50184059',dba:'KOKE',address:'173 Bleecker St',zip:'10012',
    inspection_date:'2026-09-19',inspection_type:'Pre-permit (Operational)',action:'Closed'
  }]);
  assert.equal(out.length,0);
});

test('suppression policy is audit-only and never stage/corroboration evidence',()=>{
  const p=suppressionPolicy({predecessorCamis:'50184059'});
  assert.equal(p.commercialFit,'LOW');
  assert.equal(p.stage,'JUST FILED');
  assert.deepEqual(p.countedSources,['DOHMH']);
  assert.equal(p.purchaseWindow,'SUPPRESSED');
  assert.equal(p.deliverySuppressed,true);
  assert.equal(p.predecessorEvidenceRole,'SUPPRESSION_ONLY');
});
