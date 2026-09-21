'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const adapters=require('./source-adapters');
const builder=require('./candidate-builder');
const scorer=require('./shadow-scoring-v4');

// New synthetic fixture, not a modified historical benchmark target.
function candidate(recordDate){
  const primary=adapters.normalizeDohmhRow({
    camis:'59970001',dba:'Synthetic Recency Cafe',boro:'Manhattan',building:'12',street:'EXAMPLE AVE',
    zipcode:'10001',phone:'555-0100',cuisine_description:'Coffee/Tea',
    inspection_date:'1900-01-01T00:00:00.000',record_date:recordDate
  },{observedAt:'2026-09-21T16:00:00Z'});
  const batch=records=>({observation:{supportsPositiveObservation:records.length>0,supportsAbsenceConclusion:true},records});
  const graph=builder.buildCurrentGraph({dohmhBatch:batch([primary]),slaBatch:batch([]),dobBatch:batch([])});
  return {candidate:graph.candidates[0],records:scorer.sourceMap([primary])};
}
test('unchanged uninspected applicant does not regain freshness points on a data pull',()=>{
  const old=candidate('2026-07-01T00:00:00.000'),fresh=candidate('2026-09-21T00:00:00.000');
  const a=scorer.computeShadowScores(old.candidate,old.records,'2026-09-21T16:00:00Z');
  const b=scorer.computeShadowScores(fresh.candidate,fresh.records,'2026-09-21T16:00:00Z');
  assert.equal(a.status,'SHADOW_SCORED');assert.equal(b.status,'SHADOW_SCORED');
  console.log(JSON.stringify({oldScores:a.scores,refreshedScores:b.scores}));
  assert.deepEqual(b.scores,a.scores,'a source pull date is not a new business event');
});
