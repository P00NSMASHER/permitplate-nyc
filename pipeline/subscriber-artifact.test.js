'use strict';

const assert=require('assert');
const opportunity=require('./opportunity-ledger');
const artifact=require('./subscriber-artifact');
const profiles=require('./subscriber-profile');

function packageReceipt(id,overrides){
  const base={
    packageVersion:'PermitPlate-candidate-package-v1.0.0',
    status:'READY_FOR_PROFILE_MATCHING',
    entityId:'CAMIS:'+id,
    graphDigest:'graph-1',
    changeFingerprint:'change-'+id,
    projectSignalId:'PS:'+id,
    businessName:'Venue '+id,
    address:id+' Main St',
    borough:'Manhattan',
    zip:'10001',
    lifecycleStage:'JUST FILED',
    sourceFirstEffectiveAt:'2026-09-21T12:00:00Z',
    sourceLatestEffectiveAt:'2026-09-21T12:00:00Z',
    sourceSystems:['DOHMH'],
    sourceRecordIds:['DOHMH:'+id],
    sourceUrls:['https://data.cityofnewyork.us/example/'+id],
    commercialEvidence:[],
    detectionReceiptId:'DET:'+id,
    detectionReceipt:{
      receiptId:'DET:'+id,
      detectionClass:'NEW_ENTITY',
      customerEligible:true,
      entityId:'CAMIS:'+id,
      changeFingerprint:'change-'+id,
      firstDetectedAt:'2026-09-21T17:00:00Z',
      materialChangeAt:null,
      reopenAt:null
    },
    detectionClass:'NEW_ENTITY',
    detectedAt:'2026-09-21T17:00:00Z',
    scoringMode:'CANONICAL_V3_PRODUCTION',
    scoreReceiptId:'SCORE:'+id,
    scoreReceipt:{
      scoreReceiptId:'SCORE:'+id,
      productionAuthorized:true,
      scorerVersion:'permitplate-shadow-score-v3-2026-09-21',
      entityId:'CAMIS:'+id,
      graphDigest:'graph-1',
      changeFingerprint:'change-'+id,
      scores:{
        POS:70,Insurance:65,Equipment:80,'Hood/Fire':75,
        Waste:50,Pest:45,Linen:55,Distribution:60
      }
    },
    scorerVersion:'permitplate-shadow-score-v3-2026-09-21',
    commercialFit:'HIGH',
    scores:{
      POS:70,Insurance:65,Equipment:80,'Hood/Fire':75,
      Waste:50,Pest:45,Linen:55,Distribution:60
    },
    bestVendorFit:'Equipment',
    bestScore:80,
    productionAuthorized:true,
    failures:[]
  };
  const p=Object.assign(base,overrides||{});
  p.packageFingerprint=opportunity.sha256(opportunity.stableStringify({
    entityId:p.entityId,
    changeFingerprint:p.changeFingerprint,
    detectedAt:p.detectedAt,
    scores:p.scores,
    status:p.status
  }));
  p.packageId='PKG:'+p.packageFingerprint.slice(0,24);
  return p;
}
function ledger(packages){
  const result=opportunity.appendOpportunityPackages(
    opportunity.emptyLedger('2026-09-15T00:00:00Z'),
    {passed:true,packages},
    '2026-09-21T18:00:00Z'
  );
  if(!result.committed) throw new Error('fixture ledger failed '+result.reason);
  return result.ledger;
}
function profile(overrides){
  const p=profiles.normalizeProfile(Object.assign({
    subscriberId:'sub_1',
    recipientEmail:'buyer@example.com',
    baselineAt:'2026-09-21T16:00:00Z',
    categories:['POS','Equipment'],
    boroughs:['Manhattan'],
    minimumScore:60,
    starterSnapshotEnabled:true,
    starterDays:7,
    starterLimit:10,
    maxSignals:25,
    subscriptionStatus:'active'
  },overrides||{}));
  if(p.status!=='ACTIVE') throw new Error('fixture profile failed '+p.failures.join(','));
  return p;
}

{
  const normal=packageReceipt('1');
  const starter=packageReceipt('2',{
    detectedAt:'2026-09-19T16:00:00Z',
    detectionReceipt:Object.assign({},packageReceipt('2').detectionReceipt,{
      firstDetectedAt:'2026-09-19T16:00:00Z'
    }),
    scores:{
      POS:72,Insurance:60,Equipment:68,'Hood/Fire':55,
      Waste:50,Pest:40,Linen:45,Distribution:52
    },
    bestVendorFit:'POS',bestScore:72
  });
  const old=packageReceipt('3',{
    detectedAt:'2026-09-10T16:00:00Z',
    detectionReceipt:Object.assign({},packageReceipt('3').detectionReceipt,{
      firstDetectedAt:'2026-09-10T16:00:00Z'
    })
  });
  const queens=packageReceipt('4',{borough:'Queens'});
  const low=packageReceipt('5',{
    scores:{
      POS:40,Insurance:40,Equipment:50,'Hood/Fire':45,
      Waste:40,Pest:40,Linen:40,Distribution:40
    },
    bestVendorFit:'Equipment',bestScore:50
  });
  const excluded=packageReceipt('6',{
    commercialFit:'EXCLUDE',
    scores:{POS:0,Insurance:0,Equipment:0,'Hood/Fire':0,Waste:0,Pest:0,Linen:0,Distribution:0},
    bestVendorFit:'SUPPRESSED',bestScore:0
  });
  const l=ledger([normal,starter,old,queens,low,excluded]);
  const out=artifact.buildSubscriberArtifact({
    opportunityLedger:l,
    profile:profile(),
    deliveredSignalKeys:[],
    reportDate:'2026-09-21'
  });
  assert.equal(out.status,'READY');
  assert.equal(out.normalCount,1);
  assert.equal(out.starterCount,1);
  assert.equal(out.signalCount,2);
  assert.deepEqual(out.rows.map(r=>r.Business),['Venue 1','Venue 2']);
  assert.equal(out.rows[0]['Selected Category'],'Equipment');
  assert.equal(out.rows[0]['Selected Score'],80);
  assert.equal(out.rows[1]['Selected Category'],'POS');
  assert.equal(out.rows[1]['Selected Score'],72);
  assert(out.rows[0]['Signal Key'].startsWith('normal:'));
  assert(out.rows[1]['Signal Key'].startsWith('starter:'));
  assert(out.excluded.some(x=>x.eventKey&&x.eventKey.startsWith('CAMIS:3|')&&x.reasons.includes('PRE_BASELINE_NOT_IN_STARTER_WINDOW')));
  assert(out.excluded.some(x=>x.eventKey&&x.eventKey.startsWith('CAMIS:4|')&&x.reasons.includes('BOROUGH_FILTERED')));
  assert(out.excluded.some(x=>x.eventKey&&x.eventKey.startsWith('CAMIS:5|')&&x.reasons.includes('BELOW_SCORE_THRESHOLD')));
  assert(out.excluded.some(x=>x.eventKey&&x.eventKey.startsWith('CAMIS:6|')&&x.reasons.includes('COMMERCIAL_FIT_EXCLUDED')));
  assert.equal(out.filename,'permitplate-nyc-2026-09-21.csv');
  assert.equal(out.emailRows.map(r=>r.signalKey).join('|'),out.csvRows.map(r=>r['Signal Key']).join('|'));
  assert(out.csv.includes('https://data.cityofnewyork.us/example/1'));
}

{
  const p=packageReceipt('7',{businessName:'=HYPERLINK("https://evil.example","click")'});
  const out=artifact.buildSubscriberArtifact({
    opportunityLedger:ledger([p]),
    profile:profile({categories:['POS'],minimumScore:0}),
    reportDate:'2026-09-21'
  });
  assert.equal(out.status,'READY');
  assert.equal(out.signalCount,1);
  assert(out.csv.includes("'=HYPERLINK"));
  assert.equal(out.rows[0].Business,'=HYPERLINK("https://evil.example","click")');
}

{
  const p=packageReceipt('8');
  const first=artifact.buildSubscriberArtifact({
    opportunityLedger:ledger([p]),
    profile:profile(),
    deliveredSignalKeys:[],
    reportDate:'2026-09-21'
  });
  assert.equal(first.signalCount,1);
  const replay=artifact.buildSubscriberArtifact({
    opportunityLedger:ledger([p]),
    profile:profile(),
    deliveredSignalKeys:first.signalKeys,
    reportDate:'2026-09-21'
  });
  assert.equal(replay.signalCount,0);
  assert(replay.excluded.some(x=>x.reasons.includes('ALREADY_DELIVERED')));
}

{
  const p=packageReceipt('9',{
    detectedAt:'2026-09-19T16:00:00Z',
    detectionReceipt:Object.assign({},packageReceipt('9').detectionReceipt,{
      firstDetectedAt:'2026-09-19T16:00:00Z'
    })
  });
  const out=artifact.buildSubscriberArtifact({
    opportunityLedger:ledger([p]),
    profile:profile({starterSnapshotEnabled:false}),
    reportDate:'2026-09-21'
  });
  assert.equal(out.signalCount,0);
  assert(out.excluded.some(x=>x.reasons.includes('PRE_BASELINE_NOT_IN_STARTER_WINDOW')));
}

{
  const p1=packageReceipt('10',{scores:{
    POS:90,Insurance:65,Equipment:90,'Hood/Fire':75,Waste:50,Pest:45,Linen:55,Distribution:60
  }});
  const out=artifact.buildSubscriberArtifact({
    opportunityLedger:ledger([p1]),
    profile:profile({categories:['Equipment','POS'],minimumScore:0}),
    reportDate:'2026-09-21'
  });
  assert.equal(out.rows[0]['Selected Category'],'POS');
  assert.equal(out.rows[0]['Selected Score'],90);
}

{
  const p1=packageReceipt('11');
  const l=ledger([p1]);
  const a=artifact.buildSubscriberArtifact({
    opportunityLedger:l,profile:profile(),reportDate:'2026-09-21'
  });
  const b=artifact.buildSubscriberArtifact({
    opportunityLedger:JSON.parse(JSON.stringify(l)),
    profile:profile(),reportDate:'2026-09-21'
  });
  assert.equal(a.artifactFingerprint,b.artifactFingerprint);
  assert.equal(a.csv,b.csv);
}

{
  const bad=ledger([packageReceipt('12')]);
  bad.entries[Object.keys(bad.entries)[0]].bestScore=999;
  const out=artifact.buildSubscriberArtifact({
    opportunityLedger:bad,profile:profile(),reportDate:'2026-09-21'
  });
  assert.equal(out.status,'REVIEW');
  assert(out.failures.includes('OPPORTUNITY_LEDGER_INVALID'));
}

{
  const out=artifact.buildSubscriberArtifact({
    opportunityLedger:opportunity.emptyLedger('2026-09-21T00:00:00Z'),
    profile:{subscriberId:'x'},
    reportDate:'2026-09-21'
  });
  assert.equal(out.status,'REVIEW');
  assert(out.failures.includes('PROFILE_NOT_ACTIVE'));
}

console.log('PermitPlate subscriber artifact regression tests passed.');
