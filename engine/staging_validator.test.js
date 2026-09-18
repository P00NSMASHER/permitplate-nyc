'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {
  VENUE_HEADERS,LEAD_HEADERS,SOURCE_EVENT_HEADERS,RUN_CONTROL_HEADERS,validateGeneration
}=require('./staging_validator');

function venue(overrides={}){
  return {
    'Venue Key':'10 MAIN ST|10001','Best Name':'Example Pizza','Legal Name':'Example LLC',
    'Address':'10 Main St, New York, NY 10001','Borough':'Manhattan','ZIP':'10001','Phone':'2125550000',
    'Cuisine/Type':'Pizza restaurant','Commercial Fit':'HIGH','Commercial Fit Reason':'Explicit public restaurant',
    'Stage':'JUST FILED','Stage Number':1,'First Signal Date':'2026-09-18','Latest Signal Date':'2026-09-18',
    'Source Count':1,'Sources':'DOHMH','DOHMH CAMIS':'50000001','SLA Application ID':'','DOB Job Filing':'',
    'Buildout Cost':'','Work Types':'','POS Score':68,'Insurance Score':65,'Equipment Score':68,'Hood/Fire Score':68,
    'Waste Score':52,'Pest Score':50,'Linen Score':58,'Distribution Score':70,
    'Best Vendor Fit':'Distribution','Best Score':70,'Why Now':'Fresh official applicant',
    'Purchase Window':'EARLY','Evidence Summary':'Observed: DOHMH CAMIS 50000001.','Last Updated':'2026-09-18T12:00:00-04:00',
    'Intelligence Status':'DOHMH-only','Watch Next':'DOHMH pre-permit or corroboration.','Confidence':'MEDIUM',
    ...overrides,
  };
}
function event(overrides={}){
  return {'Event ID':'DOHMH:50000001:APPLICANT','Venue Key':'10 MAIN ST|10001','Source':'DOHMH',
    'Source Record ID':'50000001','Event Date':'','Event Type':'Never-inspected applicant',
    'Stage Evidence':'applicant','DBA':'Example Pizza','Legal Name':'','Address':'10 Main St','Borough':'Manhattan','ZIP':'10001',
    'Phone':'2125550000','Cuisine/License Description':'Pizza','Initial Cost':'','Job Description':'','Work Types':'',
    'Source URL':'https://example.invalid','First Seen':'2026-09-18T12:00:00Z','Last Seen':'2026-09-18T12:00:00Z','Observed At':'2026-09-18T12:00:00Z',
    ...overrides};
}
function lead(overrides={}){
  return {'Observed At':'2026-09-18T12:00:00Z','Source Date':'','CAMIS':'50000001','Business':'Example Pizza',
    'Borough':'Manhattan','Address':'10 Main St','Public Business Phone':'2125550000','Cuisine':'Pizza','Opening Stage':'New permit applicant',
    'Priority Score':70,'Likely Vendor Fits':'POS/payments','Inspection Type':'','Public Action':'','Source':'https://example.invalid',
    'Lead Key':'applicant:50000001','Delivered At':'','Commercial Fit':'HIGH','Stage':'JUST FILED','Source Count':1,'Sources':'DOHMH',
    'Best Vendor Fit':'Distribution','Best Score':70,'Why Now':'Fresh official applicant','Purchase Window':'EARLY',
    'Evidence Summary':'Observed: DOHMH CAMIS 50000001.','Venue Key':'10 MAIN ST|10001','Watch Next':'pre-permit','Confidence':'MEDIUM',
    ...overrides};
}
function validate(v=[venue()],l=[lead()],e=[event()],extra={}){
  return validateGeneration({venueHeaders:VENUE_HEADERS,leadHeaders:LEAD_HEADERS,sourceEventHeaders:SOURCE_EVENT_HEADERS,
    runControlHeaders:RUN_CONTROL_HEADERS,venues:v,leads:l,sourceEvents:e,...extra});
}

test('valid exact-header generation passes',()=>{
  const r=validate();
  assert.equal(r.pass,true,r.errors.join('\n'));
});

test('header drift blocks generation',()=>{
  const bad=[...VENUE_HEADERS]; bad[0]='Venue';
  const r=validateGeneration({venueHeaders:bad,leadHeaders:LEAD_HEADERS,sourceEventHeaders:SOURCE_EVENT_HEADERS,runControlHeaders:RUN_CONTROL_HEADERS,venues:[],leads:[],sourceEvents:[]});
  assert.equal(r.pass,false);
  assert.ok(r.errors.some(x=>x.startsWith('VENUE:HEADER:1')));
});

test('numeric or locale-style date fails ISO date-only guard',()=>{
  for(const bad of [46283,'9/18/2026','2026-09-18T00:00:00Z','=TODAY()']){
    const r=validate([venue({'First Signal Date':bad})]);
    assert.ok(r.errors.some(x=>x.includes('NON_ISO_DATE:First Signal Date')),String(bad));
  }
});

test('score formulas/strings and wrong Best Score fail',()=>{
  let r=validate([venue({'POS Score':'=1+1'})]);
  assert.ok(r.errors.some(x=>x.includes('INVALID_LITERAL_SCORE:POS Score')));
  r=validate([venue({'Best Score':99})]);
  assert.ok(r.errors.some(x=>x.includes('BEST_SCORE_MISMATCH')));
});

test('native source id requires listed source and matching Source Event',()=>{
  let r=validate([venue({'SLA Application ID':'SLA-1'})]);
  assert.ok(r.errors.some(x=>x.includes('UNLISTED_SOURCE_HAS_ID:SLA')));
  r=validate([venue({'Source Count':2,'Sources':'DOHMH; SLA','SLA Application ID':'SLA-1'})]);
  assert.ok(r.errors.some(x=>x.includes('NATIVE_ID_WITHOUT_SOURCE_EVENT:SLA:SLA-1')));
});

test('Stage 3 requires exact current-CAMIS pre-permit event',()=>{
  const v=venue({'Stage':'HEALTH PRE-PERMIT','Stage Number':3});
  let r=validate([v]);
  assert.ok(r.errors.some(x=>x.includes('STAGE3_WITHOUT_CAMIS_PREPERMIT')));
  const pp=event({'Event ID':'DOHMH:50000001:2026-09-18:PREPERMIT','Event Type':'Pre-permit Initial Inspection'});
  r=validate([v],[lead()],[event(),pp]);
  assert.equal(r.errors.some(x=>x.includes('STAGE3_WITHOUT_CAMIS_PREPERMIT')),false);
});

test('Stage 4 requires two sources and actual prepermit or explicit validated later-stage milestone',()=>{
  let v=venue({'Stage':'MULTI-SOURCE NEAR-OPENING','Stage Number':4});
  let r=validate([v]);
  assert.ok(r.errors.some(x=>x.includes('STAGE4_REQUIRES_TWO_SOURCES')));
  assert.ok(r.errors.some(x=>x.includes('STAGE4_WITHOUT_LATE_STAGE_EVIDENCE')));

  const sla=event({'Event ID':'SLA:SLA-1','Source':'SLA','Source Record ID':'SLA-1','Event Type':'Pending license'});
  v=venue({'Stage':'MULTI-SOURCE NEAR-OPENING','Stage Number':4,'Source Count':2,'Sources':'DOHMH; SLA','SLA Application ID':'SLA-1'});
  r=validate([v],[lead()],[event(),sla],{laterStageMilestoneVenueKeys:['10 MAIN ST|10001']});
  assert.equal(r.errors.some(x=>x.includes('STAGE4_')),false,r.errors.join('\n'));
});

test('building-level unmatched evidence cannot be attached to venue row',()=>{
  const bad=event({'Stage Evidence':'BUILDING-LEVEL UNMATCHED','Event ID':'DOB:X','Source':'DOB','Source Record ID':'X'});
  const r=validate([venue()],[lead()],[event(),bad]);
  assert.ok(r.errors.some(x=>x.includes('BUILDING_LEVEL_UNMATCHED_ATTACHED')));
});

test('Equipment/Hood over generic ceiling requires direct venue-linked specialist evidence',()=>{
  const v=venue({'POS Score':80,'Insurance Score':79,'Equipment Score':95,'Hood/Fire Score':90,'Best Score':95,'Best Vendor Fit':'Equipment','Cuisine/Type':'Restaurant'});
  const r=validate([v]);
  assert.ok(r.errors.some(x=>x.includes('EQUIPMENT_OVER_CEILING')));
  assert.ok(r.errors.some(x=>x.includes('HOOD_OVER_CEILING')));
});

test('venue-linked kitchen DOB can support specialist over-ceiling scores',()=>{
  const dob=event({'Event ID':'DOB:M1','Source':'DOB','Source Record ID':'M1','Event Type':'DOB buildout',
    'Stage Evidence':'venue-linked buildout','Job Description':'commercial kitchen plumbing mechanical buildout','Work Types':'plumbing; mechanical'});
  const v=venue({'Source Count':2,'Sources':'DOHMH; DOB','DOB Job Filing':'M1','Stage':'BUILDOUT / LICENSING','Stage Number':2,
    'POS Score':80,'Insurance Score':79,'Equipment Score':95,'Hood/Fire Score':90,'Best Score':95,'Best Vendor Fit':'Equipment'});
  const r=validate([v],[lead()],[event(),dob]);
  assert.equal(r.errors.some(x=>x.includes('OVER_CEILING')),false,r.errors.join('\n'));
});

test('HIGH/MEDIUM venue requires durable Lead; LOW/EXCLUDE lead cannot already be delivered',()=>{
  let r=validate([venue()],[],[event()]);
  assert.ok(r.errors.some(x=>x.includes('DELIVERABLE_WITHOUT_DURABLE_LEAD')));
  r=validate([venue({'Commercial Fit':'LOW'})],[lead({'Commercial Fit':'LOW','Delivered At':'2026-09-18T13:00:00Z'})],[event()]);
  assert.ok(r.errors.some(x=>x.includes('SUPPRESSED_DELIVERED')));
});

test('duplicate venue/lead/event keys fail',()=>{
  let r=validate([venue(),venue()]);
  assert.ok(r.errors.some(x=>x.includes('DUPLICATE_KEY')));
  r=validate([venue()],[lead(),lead()],[event()]);
  assert.ok(r.errors.some(x=>x.includes('DUPLICATE_LEAD_KEY')));
  r=validate([venue()],[lead()],[event(),event()]);
  assert.ok(r.errors.some(x=>x.includes('duplicate/nonblank Event ID')));
});

test('>80 percent identical eligible Best Score emits warning, not hidden failure',()=>{
  const vs=[]; const ls=[]; const es=[];
  for(let i=0;i<10;i++){
    const key=`${i} MAIN ST|10001`,camis=`5000000${i}`;
    vs.push(venue({'Venue Key':key,'Address':`${i} Main St`,'DOHMH CAMIS':camis,'Best Score':70}));
    ls.push(lead({'Venue Key':key,'CAMIS':camis,'Lead Key':`applicant:${camis}`,'Best Score':70}));
    es.push(event({'Venue Key':key,'Source Record ID':camis,'Event ID':`DOHMH:${camis}:APPLICANT`}));
  }
  const r=validate(vs,ls,es);
  assert.ok(r.warnings.some(x=>x.startsWith('SCORE_CONCENTRATION:70:10/10')));
});
