'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const simulation=require('./trial-customer-simulation');
const research=require('./curated-research-ledger');

function fixture(){
  const observedAt='2026-10-27T10:00:00.000Z';
  const candidates=Array.from({length:6},(_,i)=>({entityId:'CAMIS:'+(50000000+i),
    camis:String(50000000+i),canonicalName:'SYNTHETIC Restaurant '+i,address:(10+i)+' TEST STREET',
    borough:'Manhattan',lifecycleStage:'JUST FILED',sourceSystems:['DOHMH'],
    acceptedCorroboration:[],rejectedCorroboration:[],commercialEvidence:[],
    sourceFirstEffectiveAt:'2026-10-26T08:00:00.000Z',sourceLatestEffectiveAt:'2026-10-26T08:00:00.000Z',
    deliverySuppressed:false,crossCamisOperationalConflicts:[]}));
  const sourceObservations=Object.fromEntries(research.REQUIRED_SOURCES.map(key=>[key,{
    observationId:'OBS:SYNTHETIC:'+key,observedAt,state:'COMPLETE_NONEMPTY',
    supportsAbsenceConclusion:true,sourceFresh:true,transportOk:true,publisherCount:6,fetchedCount:6}]));
  const graph={runnerVersion:'PermitPlate-current-graph-v1.0.0',observedAt,graphState:'COMPLETE',
    graphDigest:research.hash(candidates),sourceObservations,metrics:{candidateCount:6},
    knownRegressionChecks:{passed:true},candidates,passed:true};
  graph.artifactFingerprint=research.graphFingerprint(graph);return graph;
}
test('two clearly labeled personas inspect actual rendered first/weekly briefs without transport or commercial proof',()=>{
  const graph=fixture(),before=structuredClone(graph),result=simulation.simulate(graph);
  assert.deepEqual(graph,before,'source facts and real observation receipt must remain intact');
  assert.equal(result.scenarios.length,2);
  assert.equal(result.controls.realProviderCalls,0);assert.equal(result.controls.realMessagesSent,0);
  assert.equal(result.controls.realPaymentsCreated,0);assert.equal(result.controls.commercialProofEstablished,false);
  for(const s of result.scenarios){
    assert.equal(s.lifecycle.reportCount,2);assert.equal(s.lifecycle.repeatedSignalCount,0);
    assert.equal(s.lifecycle.testReviewRejectedInLive,true);assert.equal(s.lifecycle.automaticBilling,false);
    for(const brief of [s.firstBrief,s.weeklyBrief]){
      assert.match(brief.subject,/TEST SIMULATION/);assert.match(brief.html,/not a real customer report/);
      assert.match(brief.csv,/TEST scenario/);assert.match(brief.html,/\$79\/month membership/);
      assert(brief.signals.every(x=>x.borough==='Manhattan'));
      assert(!brief.html.includes('<strong>JUST FILED</strong>'),'unknown application dates must not look newly filed');
    }
    for(const feedback of [s.firstFeedback,s.weeklyFeedback]){
      assert.equal(feedback.criteria.sourceAccuracy.result,'MATCHES_INPUT_SNAPSHOT');
      assert.equal(feedback.criteria.upgradeTerms.result,'CLEAR');
      assert.equal(feedback.actualSatisfactionMeasured,false);assert.equal(feedback.actualConversion,false);
    }
  }
  assert.equal(result.scenarios.find(s=>s.category==='pos').weeklyFeedback.simulatedUpgradeDecision,'DECLINE_GENERIC_CONTEXT');
});
test('invalid source receipt is rejected and exports stay private, labeled and non-overwriting',()=>{
  const invalid=fixture();invalid.candidates[0].canonicalName='ALTERED';
  assert.throws(()=>simulation.simulate(invalid),/VALID_SOURCE_GRAPH_REQUIRED/);
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'permitplate-simulation-test-'));
  try{
    const report=simulation.simulate(fixture()),output=path.join(root,'artifacts');
    simulation.writeReport(report,output);
    assert.match(fs.readFileSync(path.join(output,'equipment-first.html'),'utf8'),/TEST SIMULATION/);
    assert.match(fs.readFileSync(path.join(output,'README.md'),'utf8'),/do not establish customer satisfaction/);
    assert.equal(fs.statSync(path.join(output,'simulation-receipt.json')).mode&0o777,0o600);
    assert.throws(()=>simulation.writeReport(report,output),/EEXIST/);
    assert.throws(()=>simulation.writeReport(report,path.join(__dirname,'public-simulation')),/PRIVATE_MATERIAL_PATH_REQUIRED/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
