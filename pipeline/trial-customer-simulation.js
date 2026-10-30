'use strict';

// Offline exercise of the actual trial renderer and lifecycle. Public restaurant
// facts may be genuine; all customers, observation timing, reviews, provider
// events and decisions are explicitly fictional. This module cannot send/pay.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const research=require('./curated-research-ledger');
const customer=require('./curated-customer-brief');
const categoryEvidence=require('./category-evidence');
const trials=require('./free-trial');
const transport=require('./transport-authorization');
const {privateMaterialPath}=require('./run-subscriber-intake');

const VERSION='PermitPlate-TEST-customer-simulation-v1.0.0';
const DAY=24*60*60*1000;
const at=(base,ms)=>new Date(Date.parse(base)+ms).toISOString();
function simulatedGraph(source,observedAt,candidates){
  const graph={...structuredClone(source),simulationOnly:true,reviewEnvironment:'TEST',
    observedAt,candidates:structuredClone(candidates),
    sourceObservations:Object.fromEntries(Object.entries(source.sourceObservations).map(([key,original])=>[
      key,{...structuredClone(original),simulationOnly:true,observedAt,
        observationId:'OBS:TEST:'+research.hash({key,observedAt}).slice(0,24)}])),
    graphDigest:research.hash({simulationOnly:true,sourceFingerprint:source.artifactFingerprint,
      observedAt,candidateIds:candidates.map(c=>c.entityId)}),
    metrics:{...source.metrics,candidateCount:candidates.length}};
  graph.artifactFingerprint=research.graphFingerprint(graph);return graph;
}
function providerFixture(prepared,number){
  const time=minutes=>at(prepared.brief.preparedAt,minutes*60000);
  const authorization=transport.buildAuthorizationReceipt({approved:true,
    authorizationType:'OWNER_EXPLICIT_SEND',approvalSource:'TEST_ONLY_NO_SEND',
    approvalNonce:'SYNTHETIC_TEST_'+number,approvedAt:time(0),expiresAt:time(30),
    attemptId:prepared.attempt.attemptId,messageIdentity:prepared.attempt.messageIdentity,
    artifactFingerprint:prepared.brief.artifactFingerprint,messageFingerprint:prepared.brief.messageFingerprint,
    recipient:prepared.brief.recipientEmail,signalKeys:prepared.brief.signalKeys});
  return {transportAuthorization:authorization,transportStartedAt:time(1),reconciledAt:time(3),
    providerObservation:{status:'ACCEPTED',evidenceKind:'PROVIDER_READBACK',
      attemptId:prepared.attempt.attemptId,messageIdentity:prepared.attempt.messageIdentity,
      recipient:prepared.brief.recipientEmail,artifactFingerprint:prepared.brief.artifactFingerprint,
      providerMessageId:'SYNTHETIC_TEST_PROVIDER_'+number,acceptedAt:time(2),observedAt:time(3)}};
}
function reviews(candidates,category,time){
  return candidates.map(candidate=>({entityId:candidate.entityId,category,
    simulationOnly:true,reviewEnvironment:'TEST',ownerReviewed:true,reviewedAt:time,
    candidateFingerprint:customer.candidateIdentity(candidate),
    categoryReview:{simulationOnly:true,approved:true,
      evidenceFingerprint:categoryEvidence.classify(candidate,category).evidenceFingerprint,
      sourceUrl:categoryEvidence.primaryUrl(candidate),
      rationale:'TEST persona assessment: official restaurant context is useful for preliminary research; it does not establish a current '+(category==='pos'?'POS system':'equipment')+' purchase.'},
    whyItMatters:'TEST scenario: open the official record, confirm the current operator and ask whether a relevant project is still planned. No purchasing need is established.'}));
}
function personaFeedback(category,scope,brief,sourceCandidates){
  const sourceByName=new Map(sourceCandidates.map(c=>[c.canonicalName,c]));
  const fidelity=brief.signals.every(s=>{
    const c=sourceByName.get(s.businessName);
    return c&&s.address===c.address&&s.borough===c.borough&&
      s.sourceUpdatedAt===research.instant(c.sourceLatestEffectiveAt)&&
      s.sourceUrls.includes(categoryEvidence.primaryUrl(c));
  });
  const categoryDirect=brief.signals.filter(s=>s.categoryEvidenceBasis==='SOURCE_KEYWORD_CONTEXT').length;
  const related=brief.signals.filter(s=>s.categoryEvidenceBasis==='RELATED_OFFICIAL_ACTIVITY').length;
  return {simulationOnly:true,reviewEnvironment:'TEST',reviewerKind:'AI_SIMULATED_CUSTOMER_PERSONA',
    persona:category==='equipment'?'NYC kitchen-equipment supplier':'NYC POS reseller',
    reviewedArtifactFingerprint:brief.artifactFingerprint,
    criteria:{
      sourceAccuracy:{result:fidelity?'MATCHES_INPUT_SNAPSHOT':'FAIL',
        assessment:'Names, premises, original source dates and official links are compared with the supplied public graph. Monitoring dates are intentionally simulated; this is not independent human authentication.'},
      territory:{result:brief.signals.every(s=>s.borough===scope)?'MATCH':'FAIL',assessment:'Every displayed address is in the requested '+scope+' territory.'},
      categoryRelevance:{result:categoryDirect?'SOURCE_CONTEXT_PRESENT':category==='equipment'&&related?'LIMITED_RESEARCH_CONTEXT':'INSUFFICIENT_FOR_QUALIFIED_LEAD',
        assessment:categoryDirect?'Source terms support additional category research; they still do not document an unfilled order.':
          category==='equipment'?'Licensing/applicant activity suggests a research starting point, but the report does not establish equipment specifications, procurement timing or an open order.':
            'Restaurant and licensing activity alone does not establish POS installation, replacement or a decision maker. I would reject generic construction-only context as a qualified POS sales lead.'},
      uncertainty:{result:brief.html.includes('not purchase intent or guaranteed leads')?'CLEAR':'FAIL',
        assessment:'The brief separates official activity from buying intent and warns that publication dates are not opening dates.'},
      nextStep:{result:brief.signals.every(s=>s.whyItMatters.includes('open the official record'))?'ACTIONABLE_RESEARCH_STEP':'FAIL',
        assessment:'Open the source, verify the present operator and project stage, then qualify the relevant vendor need before treating this as a sales opportunity.'},
      upgradeTerms:{result:brief.html.includes('$79/month membership')&&brief.html.includes('No card, automatic charge or automatic paid upgrade')?'CLEAR':'FAIL',
        assessment:'Fourteen days, two reports, five signals/report, no card or automatic conversion, and separate optional $79/month checkout are visible in the rendered report.'}
    },
    simulatedUpgradeDecision:categoryDirect?'CONSIDER_ONLY_AFTER_REAL_VALUE_VALIDATION':category==='equipment'?'DEFER_PENDING_CATEGORY_SPECIFIC_VALUE':'DECLINE_GENERIC_CONTEXT',
    actualSatisfactionMeasured:false,actualConversion:false,paymentCreated:false};
}
function scenario(source,candidates,scope,category){
  const base=source.observedAt;
  const created=trials.enroll(trials.createRegistry('TEST'),{
    businessName:'TEST '+category+' vendor',businessDomain:category+'.example.com',
    recipientEmail:category+'-test@example.com',category,territory:scope.replace(/ /g,''),
    requestedAt:at(base,90*60000)},
  {ownerApproved:true,reference:'SYNTHETIC_SCOPE_APPROVAL_NO_REAL_OWNER',approvedAt:at(base,2*3600000)});
  const selectedIds=new Set(candidates.map(c=>c.entityId));
  const baselineCandidates=source.candidates.filter(c=>!selectedIds.has(c.entityId));
  assert(baselineCandidates.length>0,'simulation needs a separate baseline record');
  const initial=research.advance(null,simulatedGraph(source,base,baselineCandidates));
  assert.equal(initial.status,'BASELINED');
  const firstCandidates=candidates.slice(0,2),weeklyCandidates=candidates.slice(2,4);
  const firstGraph=simulatedGraph(source,at(base,3600000),[...baselineCandidates,...firstCandidates]);
  const firstLedger=research.advance(initial.ledger,firstGraph).ledger;
  const common={trialId:created.trialId,reviewer:'AI_SIMULATED_TEST_PERSONA',
    ownerReviewed:true,reviewEnvironment:'TEST',simulationOnly:true};
  const firstInput={...common,trialRegistry:created.registry,graph:firstGraph,ledger:firstLedger,
    reviews:reviews(firstCandidates,category,at(base,150*60000)),preparedAt:at(base,3*3600000)};
  const noMatches=customer.prepareTrial({...firstInput,reviews:[]});
  assert.equal(noMatches.status,'NO_MATCHES_REVIEW');
  assert.equal(created.registry.trials[0].firstAcceptedAt,null);
  const first=customer.prepareTrial(firstInput);assert.equal(first.status,'READY_FOR_OWNER_REVIEW');
  const attestation={operatorVerified:true,kind:'TEST_FIXTURE',reference:'SIMULATED_PROVIDER_NOT_REAL_DELIVERY'};
  const started=trials.recordDelivery(created.registry,created.trialId,first,providerFixture(first,1),attestation);
  assert.equal(started.inboxDeliveryConfirmed,false);
  assert.throws(()=>trials.access(started.registry,created.trialId,at(base,DAY)),/UPDATE_NOT_DUE/);
  const weeklyGraph=simulatedGraph(source,at(base,7*DAY+4*3600000),[...firstGraph.candidates,...weeklyCandidates]);
  const weeklyLedger=research.advance(firstLedger,weeklyGraph).ledger;
  const weekly=customer.prepareTrial({...common,trialRegistry:started.registry,graph:weeklyGraph,
    ledger:weeklyLedger,reviews:reviews(weeklyCandidates,category,at(base,7*DAY+4.5*3600000)),
    preparedAt:at(base,7*DAY+5*3600000)});
  assert.equal(weekly.status,'READY_FOR_OWNER_REVIEW');
  const complete=trials.recordDelivery(started.registry,created.trialId,weekly,providerFixture(weekly,2),attestation);
  assert.equal(complete.expiresAt,started.expiresAt);
  assert.equal(complete.registry.trials[0].deliveries.length,2);
  assert(first.brief.signalKeys.every(key=>!weekly.brief.signalKeys.includes(key)));
  assert.throws(()=>trials.access(complete.registry,created.trialId,complete.expiresAt),/TRIAL_EXPIRED/);
  const live=trials.enroll(trials.createRegistry('LIVE'),{
    businessName:'TEST transfer rejection',businessDomain:'transfer.example.com',recipientEmail:'transfer-test@example.com',
    category,territory:scope.replace(/ /g,''),requestedAt:at(base,90*60000)},
  {ownerApproved:true,reference:'TEST_INPUT_TO_LIVE_NEGATIVE_CASE',approvedAt:at(base,2*3600000)});
  const rejected=customer.prepareTrial({...firstInput,trialRegistry:live.registry,trialId:live.trialId});
  assert(rejected.failures.includes('TRIAL_SIMULATED_REVIEW_NOT_LIVE'));
  return {simulationOnly:true,category,territory:scope,recipient:first.brief.recipientEmail,
    timeline:{entireMonitoringTimelineIsFictional:true,firstAcceptedAt:started.firstAcceptedAt,
      weeklyAcceptedAt:complete.registry.trials[0].deliveries[1].acceptedAt,expiresAt:complete.expiresAt},
    lifecycle:{noMatchesStartsClock:false,earlyWeeklyUpdateBlocked:true,reportCount:2,
      repeatedSignalCount:0,secondReportExtendsTrial:false,expiredTrialBlocked:true,
      testReviewRejectedInLive:true,automaticBilling:false,realMessagesSent:0,realPaymentsCreated:0},
    sourceBindings:candidates.map(c=>({entityId:c.entityId,sourceCandidateFingerprint:research.hash(c)})),
    firstBrief:first.brief,weeklyBrief:weekly.brief,
    firstFeedback:personaFeedback(category,scope,first.brief,firstCandidates),
    weeklyFeedback:personaFeedback(category,scope,weekly.brief,weeklyCandidates)};
}
function simulate(source){
  assert(research.checkGraph(source).valid,'VALID_SOURCE_GRAPH_REQUIRED');
  const safe=source.candidates.filter(c=>!c.deliverySuppressed&&c.canonicalName&&c.address&&
    research.instant(c.sourceLatestEffectiveAt)&&Date.parse(c.sourceLatestEffectiveAt)<=Date.parse(source.observedAt));
  const scope=['Manhattan','Brooklyn','Queens','Bronx','Staten Island'].find(b=>safe.filter(c=>c.borough===b).length>=4);
  assert(scope,'FOUR_SAME_TERRITORY_SOURCE_CANDIDATES_REQUIRED');
  const order=c=>categoryEvidence.classify(c,'Equipment').status==='SOURCE_KEYWORD_CONTEXT'?0:
    categoryEvidence.classify(c,'Equipment').status==='RELATED_OFFICIAL_ACTIVITY'?1:2;
  const chosen=safe.filter(c=>c.borough===scope).sort((a,b)=>order(a)-order(b)||
    a.entityId.localeCompare(b.entityId)).slice(0,4);
  return {version:VERSION,simulationOnly:true,environment:'TEST',
    sourceInput:{kind:'CALLER_SUPPLIED_PUBLIC_SOURCE_GRAPH',observedAt:source.observedAt,
      graphFingerprint:source.artifactFingerprint,graphDigest:source.graphDigest,
      originalCandidateCount:source.candidates.length,graphIntegrityChecked:true,
      sourceFactsCopiedWithoutEditing:true,independentHumanSourceReview:false},
    controls:{realCustomers:0,realProviderCalls:0,realMessagesSent:0,realPaymentsCreated:0,
      genuineIndependentReviews:0,calibrationLabelsCreated:0,scoringPromotionAuthorized:false,
      commercialProofEstablished:false},
    scenarios:['equipment','pos'].map(category=>scenario(source,chosen,scope,category))};
}
function writeReport(report,output){
  const directory=privateMaterialPath(output);
  fs.mkdirSync(directory,{recursive:false,mode:0o700});
  const write=(name,body)=>fs.writeFileSync(path.join(directory,name),body,{flag:'wx',mode:0o600});
  for(const s of report.scenarios){
    for(const [label,brief] of [['first',s.firstBrief],['weekly',s.weeklyBrief]]){
      write(s.category+'-'+label+'.html','<!doctype html><html lang="en"><meta charset="utf-8"><title>TEST SIMULATION — '+s.category+' '+label+'</title><body>'+brief.html+'</body></html>');
      write(s.category+'-'+label+'.csv',brief.csv);
    }
  }
  write('simulation-receipt.json',JSON.stringify(report,null,2)+'\n');
  const lines=['# TEST customer simulation','',
    'No real customers, reviewer attestations, provider deliveries or payments. Original restaurant facts come from the supplied public graph; the complete observation/delivery timeline is fictional.',
    '',...report.scenarios.flatMap(s=>['## '+s.category+' vendor — '+s.territory,'',
      'Read `'+s.category+'-first.html` and `'+s.category+'-weekly.html`.',
      '','Simulated upgrade decision: **'+s.weeklyFeedback.simulatedUpgradeDecision+'**.','',
      ...Object.entries(s.weeklyFeedback.criteria).map(([key,v])=>'- **'+key+': '+v.result+'** — '+v.assessment),'']),
    'These results exercise software and expose weak category evidence. They do not establish customer satisfaction, sales, buyer precision or independent review.',''];
  write('README.md',lines.join('\n'));return directory;
}
if(require.main===module){
  try{
    if(process.argv.length!==4)throw Error('Usage: node pipeline/trial-customer-simulation.js PUBLIC_GRAPH_JSON NEW_PRIVATE_OUTPUT_DIRECTORY');
    const input=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
    const report=simulate(input.result||input);
    const output=writeReport(report,process.argv[3]);
    console.log(JSON.stringify({version:VERSION,simulationOnly:true,output,
      sourceObservedAt:report.sourceInput.observedAt,scenarios:report.scenarios.map(s=>({category:s.category,
        firstSignals:s.firstBrief.signalCount,weeklySignals:s.weeklyBrief.signalCount,
        decision:s.weeklyFeedback.simulatedUpgradeDecision})),controls:report.controls},null,2));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
module.exports={VERSION,simulatedGraph,providerFixture,reviews,personaFeedback,scenario,simulate,writeReport};
