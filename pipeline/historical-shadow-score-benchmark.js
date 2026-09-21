'use strict';

const fixture = require('../scoring/historical-shadow-score-benchmark-2026-09-18.json');
const shadow = require('./shadow-scoring-v3');
const fit = require('./commercial-fit');

const DOCUMENTED_CANONICAL_CORRECTIONS=Object.freeze({
  '50192386':Object.freeze({
    scores:Object.freeze({'Hood/Fire':93})
  }),
  '50192550':Object.freeze({
    scores:Object.freeze({Distribution:94}),
    bestVendorFit:'Distribution',
    bestScore:94
  })
});

function normalizeBest(value) {
  const v=String(value||'').toUpperCase().replace(/[^A-Z]/g,'');
  if(v==='POSPAYMENTS'||v==='POS') return 'POS';
  return v;
}

function recordFromFixture(item) {
  const primary={
    sourceSystem:'DOHMH',
    sourceRecordId:item.primary.sourceRecordId,
    sourceEntityId:'CAMIS:'+item.camis,
    eventType:item.primary.eventType,
    entityKeys:{camis:item.camis},
    property:{borough:item.borough},
    parties:{operatorName:item.primary.dba||item.canonicalName},
    facts:{
      phone:item.primary.phonePresent?'PRESENT':null,
      cuisine_description:item.primary.cuisineDescription||null
    }
  };
  const evidence=(item.acceptedEvidence||[]).map(e=>({
    sourceSystem:e.sourceSystem,
    sourceRecordId:e.sourceRecordId,
    sourceEntityId:null,
    eventType:e.eventType,
    entityKeys:{},
    property:{},
    parties:{dba:e.dba||null,legalName:e.legalName||null},
    facts:{
      description:e.description||null,
      initial_cost_number:e.initialCost===null||e.initialCost===undefined||e.initialCost===''?
        null:Number(String(e.initialCost).replace(/[$,]/g,'')),
      job_description:e.jobDescription||null,
      work_types:e.workTypes||null
    }
  }));
  return {primary,evidence};
}

function candidateFromFixture(item,records) {
  return {
    entityId:'CAMIS:'+item.camis,
    camis:item.camis,
    canonicalName:item.canonicalName,
    borough:item.borough,
    lifecycleStage:item.lifecycleStage,
    sourceLatestEffectiveAt:item.latestSignalDate,
    sourceSystems:item.sourceSystems.slice(),
    sourceCount:item.sourceCount,
    deliverySuppressed:item.deliverySuppressed===true && String(item.commercialFit).toUpperCase()==='LOW',
    crossCamisOperationalConflicts:
      item.deliverySuppressed===true && String(item.commercialFit).toUpperCase()==='LOW'?
        [{camis:'HISTORICAL_CONFLICT'}]:[],
    primaryRecord:records.primary,
    commercialEvidence:[],
    projectSignal:{
      corroboration:{
        accepted:records.evidence.map(e=>({
          sourceRecordId:e.sourceRecordId,
          sourceSystem:e.sourceSystem
        })),
        rejected:[]
      }
    }
  };
}

function canonicalExpected(item) {
  const correction=DOCUMENTED_CANONICAL_CORRECTIONS[String(item.camis)] || {};
  return {
    scores:Object.assign({},item.expected.scores,correction.scores||{}),
    bestVendorFit:correction.bestVendorFit || item.expected.bestVendorFit,
    bestScore:correction.bestScore == null ? item.expected.bestScore : correction.bestScore
  };
}

function evaluateHistoricalFixture() {
  const mismatches=[];
  const literalAnomalies=[];
  let exactRows=0;
  let bestAgree=0;
  let fitAgree=0;
  const categoryExact={};
  for(const category of shadow.CATEGORIES) categoryExact[category]=0;

  for(const item of fixture.records||[]) {
    const records=recordFromFixture(item);
    const candidate=candidateFromFixture(item,records);
    const recordsById=shadow.sourceMap([records.primary,...records.evidence]);
    const fitReceipt=fit.classifyCommercialFit({candidate,recordsById});
    const scored=shadow.computeShadowScores(candidate,recordsById,item.authorityCutoff);

    const expected=canonicalExpected(item);
    const errors=[];
    if(fitReceipt.status!=='CLASSIFIED'){
      errors.push({field:'Commercial Fit',actual:'REVIEW',expected:item.commercialFit});
    } else if(String(fitReceipt.fit)!==String(item.commercialFit)){
      errors.push({field:'Commercial Fit',actual:fitReceipt.fit,expected:item.commercialFit});
    } else fitAgree+=1;

    if(scored.status!=='SHADOW_SCORED'){
      errors.push({field:'Score Status',actual:scored.status,expected:'SHADOW_SCORED',detail:scored.errors});
    } else {
      for(const category of shadow.CATEGORIES){
        const actual=Number(scored.scores[category]);
        const expectedValue=Number(expected.scores[category]);
        if(actual===expectedValue) categoryExact[category]+=1;
        else errors.push({field:category,actual,expected:expectedValue});
      }
      if(normalizeBest(scored.bestVendorFit)===normalizeBest(expected.bestVendorFit)) bestAgree+=1;
      else errors.push({field:'Best Vendor Fit',actual:scored.bestVendorFit,expected:expected.bestVendorFit});
      if(Number(scored.bestScore)!==Number(expected.bestScore)){
        errors.push({field:'Best Score',actual:scored.bestScore,expected:expected.bestScore});
      }

      const literalDiffs=[];
      for(const category of shadow.CATEGORIES){
        if(Number(item.expected.scores[category])!==Number(expected.scores[category])){
          literalDiffs.push({
            field:category,
            literal:Number(item.expected.scores[category]),
            canonical:Number(expected.scores[category])
          });
        }
      }
      if(normalizeBest(item.expected.bestVendorFit)!==normalizeBest(expected.bestVendorFit)){
        literalDiffs.push({field:'Best Vendor Fit',literal:item.expected.bestVendorFit,canonical:expected.bestVendorFit});
      }
      if(Number(item.expected.bestScore)!==Number(expected.bestScore)){
        literalDiffs.push({field:'Best Score',literal:Number(item.expected.bestScore),canonical:Number(expected.bestScore)});
      }
      if(literalDiffs.length){
        literalAnomalies.push({camis:item.camis,venueKey:item.venueKey,diffs:literalDiffs});
      }
    }

    if(errors.length===0) exactRows+=1;
    else mismatches.push({
      camis:item.camis,
      venueKey:item.venueKey,
      canonicalName:item.canonicalName,
      expectedFit:item.commercialFit,
      scoringArchetype:fitReceipt.conceptEvidence&&fitReceipt.conceptEvidence.archetype||null,
      errors
    });
  }

  const n=(fixture.records||[]).length;
  return {
    fixtureVersion:fixture.fixtureVersion,
    authorityId:fixture.authorityId,
    recordCount:n,
    exactRows,
    exactRowRate:n?exactRows/n:0,
    fitAgreementRate:n?fitAgree/n:0,
    bestFitAgreementRate:n?bestAgree/n:0,
    categoryExactRate:Object.fromEntries(
      Object.entries(categoryExact).map(([k,v])=>[k,n?v/n:0])
    ),
    mismatchCount:mismatches.length,
    mismatches,
    documentedLegacyAnomalyCount:literalAnomalies.length,
    documentedLegacyAnomalies:literalAnomalies
  };
}

module.exports={
  DOCUMENTED_CANONICAL_CORRECTIONS,
  normalizeBest,
  canonicalExpected,
  recordFromFixture,
  candidateFromFixture,
  evaluateHistoricalFixture
};
