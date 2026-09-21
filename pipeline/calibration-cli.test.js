'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const c=require('./calibration-cohort'),runner=require('./calibration-runner');
const adapters=require('./source-adapters'),builder=require('./candidate-builder');

test('review provenance includes normalization, evidence selection, evaluator and workbench',()=>{
  const files=['pipeline/source-adapters.js','pipeline/calibration-cohort.js',
    'pipeline/calibration-evaluation.js','pipeline/calibration-workbench.js'];
  for(const file of files)assert.ok(runner.INPUT_FILES.includes(file));
  assert.ok(Object.values(runner.hashes(files)).every(value=>/^[0-9a-f]{64}$/.test(value)));
});
test('CLI records actual lock time and persists the zero-review block without overwrite',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'permitplate-calibration-cli-'));
  try{
    const observedAt=new Date(Date.now()-60000).toISOString();
    const record=adapters.normalizeDohmhRow({camis:'58817777',dba:'Synthetic CLI Cafe',
      building:'1',street:'TEST AVE',boro:'Manhattan',cuisine_description:'Coffee/Tea',
      inspection_date:'1900-01-01T00:00:00.000',record_date:observedAt},{observedAt});
    const batch=records=>({records,observation:{state:records.length?'COMPLETE_NONEMPTY':'VERIFIED_EMPTY',
      supportsPositiveObservation:!!records.length,supportsAbsenceConclusion:true}});
    const batches={DOHMH:batch([record]),SLA_PENDING:batch([]),DOB_NOW:batch([])};
    const graph=builder.buildCurrentGraph({dohmhBatch:batches.DOHMH,slaBatch:batches.SLA_PENDING,dobBatch:batches.DOB_NOW});
    const cohort=c.buildCohort({graph,batches,observedAt,sourceRevision:'a'.repeat(40),
      codeHashes:runner.hashes(runner.INPUT_FILES),isSynthetic:true,benchmarkSize:2,diagnosticSize:0});
    const input=path.join(dir,'cohort.json'),output=path.join(dir,'lock.json');
    fs.writeFileSync(input,JSON.stringify(cohort));
    const started=Date.now();
    const execute=()=>spawnSync(process.execPath,[path.join(__dirname,'calibration-runner.js'),'lock',input,output],{encoding:'utf8',timeout:10000});
    const first=execute();assert.equal(first.status,2,first.stderr);
    const contents=fs.readFileSync(output,'utf8'),lock=JSON.parse(contents);
    assert.equal(lock.status,'BLOCKED');assert.equal(lock.productionAuthorized,false);
    assert.ok(Date.parse(lock.createdAt)>=started&&Date.parse(lock.createdAt)<=Date.now());
    assert.ok(lock.failures.includes('TWO_INDEPENDENT_REVIEWERS_REQUIRED'));
    const second=execute();assert.equal(second.status,1);assert.match(second.stderr,/EEXIST/);
    assert.equal(fs.readFileSync(output,'utf8'),contents);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
