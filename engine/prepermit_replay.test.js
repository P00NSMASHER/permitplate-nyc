'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {eventId,replayPrePermits,validateLifecycleStages}=require('./prepermit_replay');

const OBS='2026-09-18T12:00:00Z';
const venue={'Venue Key':'10 MAIN ST|10001','DOHMH CAMIS':'50000001','Best Name':'Example','Address':'10 Main','Borough':'Manhattan','ZIP':'10001'};

test('deterministic prepermit event id uses CAMIS date and inspection/action content',()=>{
  const row={camis:'50000001',inspection_date:'2026-09-17T00:00:00.000',inspection_type:'Pre-permit / Initial Inspection',action:'Open'};
  assert.equal(eventId(row),eventId({...row}));
  assert.match(eventId(row),/^DOHMH:50000001:2026-09-17:PREPERMIT:[0-9A-F]{10}$/);
  assert.notEqual(eventId(row),eventId({...row,action:'Closed'}));
});

test('replay recovers current-CAMIS prepermit rows and reports coverage',()=>{
  const row={camis:'50000001',inspection_date:'2026-09-17',inspection_type:'Pre-permit / Initial Inspection',action:'Open',dba:'Example'};
  const r=replayPrePermits({venues:[venue],historicalRowsByCamis:{'50000001':[row]},existingEventIds:[],observedAt:OBS});
  assert.equal(r.events.length,1);
  assert.equal(r.metrics.camisChecked,1);
  assert.equal(r.metrics.venuesWithHits,1);
  assert.equal(r.metrics.recoveredEvents,1);
  assert.equal(r.events[0]['Venue Key'],'10 MAIN ST|10001');
});

test('existing deterministic event is not counted recovered twice',()=>{
  const row={camis:'50000001',inspection_date:'2026-09-17',inspection_type:'Pre-permit / Initial Inspection',action:'Open'};
  const id=eventId(row);
  const r=replayPrePermits({venues:[venue],historicalRowsByCamis:{'50000001':[row,row]},existingEventIds:[id],observedAt:OBS});
  assert.equal(r.events.length,1);
  assert.equal(r.metrics.recoveredEvents,0);
  assert.equal(r.metrics.alreadyPresentEvents,1);
  assert.equal(r.metrics.duplicateRowsCollapsed,1);
});

test('global raw prepermit rows for other CAMIS never become venue evidence',()=>{
  const r=replayPrePermits({
    venues:[venue],
    historicalRowsByCamis:{
      '50000001':[],
      '99999999':[{camis:'99999999',inspection_date:'2026-09-17',inspection_type:'Pre-permit / Initial Inspection'}]
    },
    existingEventIds:[],observedAt:OBS
  });
  assert.equal(r.events.length,0);
  assert.equal(r.metrics.venuesWithHits,0);
});

test('malformed prepermit rows are counted not silently treated as evidence',()=>{
  const r=replayPrePermits({
    venues:[venue],
    historicalRowsByCamis:{'50000001':[{camis:'50000001',inspection_date:'bad',inspection_type:'Pre-permit / Initial Inspection'}]},
    existingEventIds:[],observedAt:OBS
  });
  assert.equal(r.events.length,0);
  assert.equal(r.metrics.malformedRecords,1);
});

test('Stage 3/4 validation requires event or explicit later-stage milestone',()=>{
  const stage3={...venue,'Stage Number':3};
  let v=validateLifecycleStages({venues:[stage3],sourceEvents:[]});
  assert.equal(v.pass,false);
  assert.match(v.errors[0],/STAGE3_WITHOUT_CAMIS_PREPERMIT/);

  const event={'Venue Key':venue['Venue Key'],Source:'DOHMH','Source Record ID':'50000001','Event Type':'Pre-permit / Initial Inspection'};
  v=validateLifecycleStages({venues:[stage3],sourceEvents:[event]});
  assert.equal(v.pass,true);

  const stage4={...venue,'Stage Number':4};
  assert.equal(validateLifecycleStages({venues:[stage4],sourceEvents:[]}).pass,false);
  assert.equal(validateLifecycleStages({venues:[stage4],sourceEvents:[],laterStageMilestoneVenueKeys:[venue['Venue Key']]}).pass,true);
});
