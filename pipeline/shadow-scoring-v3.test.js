'use strict';

const assert = require('assert');
const shadow = require('./shadow-scoring-v3');
const adapters = require('./source-adapters');
const project = require('./project-signal');

function dohmh(row) {
  return adapters.normalizeDohmhRow(row,{observedAt:'2026-09-21T14:00:00Z'});
}
function sla(row) {
  return adapters.normalizeSlaPendingRow(row,{observedAt:'2026-09-21T14:00:00Z'});
}
function map(records) {
  return shadow.sourceMap(records);
}
function candidateFrom(primary, overrides) {
  return Object.assign({
    entityId:primary.sourceEntityId,
    camis:primary.entityKeys.camis,
    canonicalName:primary.parties.operatorName,
    borough:primary.property.borough,
    lifecycleStage:'JUST FILED',
    sourceLatestEffectiveAt:primary.sourceEffectiveAt,
    sourceSystems:['DOHMH'],
    sourceCount:1,
    deliverySuppressed:false,
    crossCamisOperationalConflicts:[],
    primaryRecord:primary,
    commercialEvidence:[],
    projectSignal:project.buildProjectSignal(primary,[])
  },overrides||{});
}
const OBS='2026-09-21T14:00:00Z';

// MEDIUM unknown DOHMH applicant replays the validated 58/55/45/38/... pattern.
{
  const primary=dohmh({
    camis:'50100001',dba:'MONBACKS',boro:'Bronx',building:'582',street:'E FORDHAM RD',
    zipcode:'10458',phone:'(914) 403-0404',cuisine_description:'Not Listed/Not Applicable',
    inspection_date:'1900-01-01T00:00:00.000',record_date:'2026-09-21T12:00:00.000'
  });
  const out=shadow.computeShadowScores(candidateFrom(primary),map([primary]),OBS);
  assert.equal(out.status,'SHADOW_SCORED');
  assert.equal(out.fitReceipt.fit,'MEDIUM');
  assert.deepEqual(out.scores,{
    POS:58,Insurance:55,Equipment:45,'Hood/Fire':38,
    Waste:42,Pest:40,Linen:38,Distribution:40
  });
  assert.equal(out.bestVendorFit,'POS');
}

// Coffee/light-prep HIGH pattern replays 68/65/55/36/... and does not inflate specialist categories.
{
  const primary=dohmh({
    camis:'50100002',dba:'27 CLUB COFFEE',boro:'Brooklyn',building:'47',street:'ADELPHI ST',
    zipcode:'11205',phone:'(310) 344-3956',cuisine_description:'Coffee/Tea',
    inspection_date:'1900-01-01T00:00:00.000',record_date:'2026-09-21T12:00:00.000'
  });
  const out=shadow.computeShadowScores(candidateFrom(primary),map([primary]),OBS);
  assert.equal(out.fitReceipt.fit,'HIGH');
  assert.deepEqual(out.scores,{
    POS:68,Insurance:65,Equipment:55,'Hood/Fire':36,
    Waste:52,Pest:50,Linen:40,Distribution:58
  });
  assert.equal(out.bestVendorFit,'POS');
}

// Pizza/hot-food pattern replays validated specialist boosts.
{
  const primary=dohmh({
    camis:'50100003',dba:'JOE PIZZA',boro:'Queens',building:'1',street:'MAIN ST',
    zipcode:'11385',phone:'555-1000',cuisine_description:'Pizza',
    inspection_date:'1900-01-01T00:00:00.000',record_date:'2026-09-21T12:00:00.000'
  });
  const out=shadow.computeShadowScores(candidateFrom(primary),map([primary]),OBS);
  assert.deepEqual(out.scores,{
    POS:68,Insurance:65,Equipment:75,'Hood/Fire':66,
    Waste:52,Pest:50,Linen:58,Distribution:70
  });
  assert.equal(out.bestVendorFit,'Equipment');
}

// Poke/bowl pattern replays 63/54/66 specialty profile.
{
  const primary=dohmh({
    camis:'50100004',dba:'PURE POKE',boro:'Manhattan',building:'1',street:'BOWERY',
    zipcode:'10002',phone:'555-1001',cuisine_description:'Other',
    inspection_date:'1900-01-01T00:00:00.000',record_date:'2026-09-21T12:00:00.000'
  });
  const out=shadow.computeShadowScores(candidateFrom(primary),map([primary]),OBS);
  assert.equal(out.scores.Equipment,63);
  assert.equal(out.scores['Hood/Fire'],54);
  assert.equal(out.scores.Distribution,66);
}

// Accepted SLA same-identity corroboration produces early-stage POS/Insurance boosts and specialist ceiling.
{
  const primary=dohmh({
    camis:'50100005',dba:'WILKIE',boro:'Brooklyn',building:'820',street:'FRANKLIN AVE',
    zipcode:'11225',phone:'555-1002',cuisine_description:'American',
    inspection_date:'1900-01-01T00:00:00.000',record_date:'2026-09-21T12:00:00.000'
  });
  const evidence=sla({
    application_id:'NA-1',description:'Food & Beverage Business',legalname:'Beanstable LLC',dba:'WILKIE',
    actual_address_of_premises:'820 FRANKLIN AVE',city:'BROOKLYN',state_name:'NY',zip_code:'11225',
    received_date:'2026-09-21T10:00:00.000',status:'Pending'
  });
  const signal=project.buildProjectSignal(primary,[evidence]);
  const candidate=candidateFrom(primary,{
    lifecycleStage:'BUILDOUT / LICENSING',
    sourceSystems:signal.sourceSystems,
    sourceCount:signal.sourceCount,
    projectSignal:signal,
    commercialEvidence:signal.commercialEvidence
  });
  const out=shadow.computeShadowScores(candidate,map([primary,evidence]),OBS);
  assert.equal(out.fitReceipt.fit,'HIGH');
  assert.equal(out.scores.POS,83);
  assert.equal(out.scores.Insurance,84);
  assert.equal(out.scores.Equipment,84);
  assert.equal(out.scores['Hood/Fire'],84);
  assert.equal(out.scores.Waste,68);
  assert.equal(out.scores.Pest,65);
  assert.equal(out.scores.Linen,65);
  assert.equal(out.scores.Distribution,76);
  assert.equal(out.bestVendorFit,'Insurance');
}

// Suppressed predecessor conflict stays low and cannot become a deliverable specialist score.
{
  const primary=dohmh({
    camis:'50100006',dba:'KOKE',boro:'Manhattan',building:'173',street:'BLEECKER ST',
    zipcode:'10012',phone:'555-1003',cuisine_description:'Not Listed/Not Applicable',
    inspection_date:'1900-01-01T00:00:00.000',record_date:'2026-09-21T12:00:00.000'
  });
  const candidate=candidateFrom(primary,{
    deliverySuppressed:true,
    crossCamisOperationalConflicts:[{camis:'50199999',primarySourceRecordId:'DOHMH:old'}]
  });
  const out=shadow.computeShadowScores(candidate,map([primary]),OBS);
  assert.equal(out.fitReceipt.fit,'LOW');
  assert.equal(out.status,'SHADOW_SCORED');
  assert(out.bestScore < 60);
}

console.log('PermitPlate current-evidence shadow scoring regression tests passed.');
