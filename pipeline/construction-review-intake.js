'use strict';

// Offline intake of completed worksheets against a previously FROZEN private
// DOB reference. A reviewer's CSV or attestation is untrusted input.
// Parsing/consensus never authenticates a person, verifies a purchase order,
// accesses scoring cohorts or authorizes customer delivery.
const fs=require('node:fs');
const path=require('node:path');
const research=require('./curated-research-ledger');
const frozen=require('./construction-frozen-reference');
const worksheet=require('./construction-reviewer-worksheet');

const VERSION='PermitPlate-construction-review-return-v1.0.0';
const HEADERS=worksheet.HEADERS;
const EDITABLE=6;
const SOURCE_SEEN=Object.freeze(['YES','NO','UNCERTAIN']);
const SCOPE=Object.freeze(['RELEVANT','NOT_RELEVANT','INSUFFICIENT_EVIDENCE']);
const PURCHASE=Object.freeze(['DOCUMENTED','NOT_DOCUMENTED','UNKNOWN']);
const ATTESTATION='INDEPENDENT_HUMAN_SOURCE_REVIEW';
const MAX_CSV_BYTES=3*1024*1024;

function parseCsv(text){
  if(typeof text!=='string'||Buffer.byteLength(text,'utf8')>MAX_CSV_BYTES||
     text.length<HEADERS.length)throw Error('REVIEW_CSV_SIZE_INVALID');
  const data=text.charCodeAt(0)===0xFEFF?text.slice(1):text;
  if(data.includes('\0'))throw Error('REVIEW_CSV_NUL_INVALID');
  const rows=[];
  let row=[],value='',quoted=false,afterQuote=false;
  function endCell(){
    row.push(value);value='';afterQuote=false;
    if(row.length>HEADERS.length)throw Error('REVIEW_CSV_COLUMN_COUNT_INVALID');
  }
  function endRow(){
    endCell();
    if(row.length!==HEADERS.length)throw Error('REVIEW_CSV_COLUMN_COUNT_INVALID');
    rows.push(row);row=[];
    if(rows.length>1000)throw Error('REVIEW_CSV_ROW_LIMIT_EXCEEDED');
  }
  for(let i=0;i<data.length;i++){
    const ch=data[i];
    if(quoted){
      if(ch==='"'){
        if(data[i+1]==='"'){value+='"';i++;}
        else{quoted=false;afterQuote=true;}
      }else value+=ch;
    }else if(ch===',')endCell();
    else if(ch==='\r'||ch==='\n'){
      endRow();
      if(ch==='\r'&&data[i+1]==='\n')i++;
    }else if(ch==='"'){
      if(value!==''||afterQuote)throw Error('REVIEW_CSV_QUOTE_INVALID');
      quoted=true;
    }else{
      if(afterQuote)throw Error('REVIEW_CSV_TRAILING_QUOTE_INVALID');
      value+=ch;
    }
    if(value.length>50000)throw Error('REVIEW_CSV_CELL_TOO_LONG');
  }
  if(quoted)throw Error('REVIEW_CSV_UNTERMINATED_QUOTE');
  if(row.length||value.length||afterQuote)endRow();
  return rows;
}
function reject(reason){
  return {
    version:VERSION,status:'REVIEW',failures:[reason],
    reviewerDeclarationsReceived:0,caseCountReviewedByBoth:0,
    reviewerAgreementCount:0,disagreementCount:0,
    independentHumanIdentityVerified:false,
    reviewerExpertiseVerified:false,procurementIntentVerified:false,
    originalScoringHoldoutCasesRead:0,reservedAuditCasesReleased:0,
    scoringPromotionAllowed:false,customerDeliveryAllowed:false,
    externalSendCalls:0
  };
}
function assess(reference,submissions,asOf){
  if(!frozen.validate(reference).valid)return reject('FROZEN_REFERENCE_NOT_VERIFIED');
  const at=research.instant(asOf);
  if(!at||Date.parse(at)<Date.parse(reference.anchor.originalSourceObservedAt))
    return reject('REVIEW_EVALUATION_TIME_INVALID');
  if(!Array.isArray(submissions)||submissions.length<2||submissions.length>4)
    return reject('TWO_TO_FOUR_REVIEWER_DECLARATIONS_REQUIRED');
  const template=parseCsv(worksheet.render(reference).csv);
  const expected=new Map(template.slice(1).map(row=>[row[0],row]));
  const reservedIds=reference.reservedAudit.cases.map(c=>c.caseId);
  const immutable=HEADERS.length-EDITABLE;
  const seenReviewers=new Set(),results=[],errors=new Set();
  const feedback=reason=>errors.add(reason);

  for(const submission of submissions){
    const id=submission?.reviewerId;
    if(!/^[A-Za-z0-9_-]{3,64}$/.test(id||'')||seenReviewers.has(id)){
      feedback('REVIEWER_ALIAS_INVALID_OR_DUPLICATE');continue;
    }
    seenReviewers.add(id);
    if(submission.isSynthetic!==false||submission.declaresIndependent!==true||
       !['INDEPENDENT_DOMAIN_REVIEWER','VENDOR_DOMAIN_REVIEWER'].includes(submission.role)){
      feedback('UNVERIFIED_REVIEWER_DECLARATION');continue;
    }
    let rows;
    try{rows=parseCsv(submission.csv);}
    catch{feedback('REVIEW_CSV_MALFORMED');continue;}
    if(reservedIds.some(caseId=>submission.csv.includes(caseId))){
      feedback('RESERVED_AUDIT_CASE_PRESENT_IN_RETURN');continue;
    }
    if(JSON.stringify(rows[0])!==JSON.stringify(HEADERS)||
       rows.length!==template.length){
      feedback('REVIEW_CSV_HEADER_OR_COVERAGE_MISMATCH');continue;
    }
    const answers=new Map();
    for(const cells of rows.slice(1)){
      const expectedRow=expected.get(cells[0]);
      if(!expectedRow||answers.has(cells[0])){
        feedback('REVIEW_UNKNOWN_OR_DUPLICATE_CASE');continue;
      }
      if(cells.slice(0,immutable).some((value,index)=>
        value!==expectedRow[index])){
        feedback('REVIEW_SOURCE_EVIDENCE_MODIFIED');continue;
      }
      const [seen,scope,notes,purchase,reviewedAt,attestation]=cells.slice(immutable);
      if(!SOURCE_SEEN.includes(seen)||!SCOPE.includes(scope)||
         !PURCHASE.includes(purchase)||attestation!==ATTESTATION||
         typeof notes!=='string'||notes.trim().length<20||
         /^[\s]*[=+\-@]/.test(notes)||notes.length>4000){
        feedback('REVIEW_ANSWERS_INCOMPLETE_OR_UNSAFE');continue;
      }
      const time=research.instant(reviewedAt);
      if(!time||time!==reviewedAt||
         Date.parse(time)<Date.parse(reference.anchor.originalSourceObservedAt)||
         Date.parse(time)>Date.parse(at)){
        feedback('REVIEW_TIMESTAMP_INVALID');continue;
      }
      if(seen!=='YES'&&scope!=='INSUFFICIENT_EVIDENCE'){
        feedback('UNVERIFIED_SOURCE_CANNOT_SUPPORT_SCOPE_LABEL');continue;
      }
      // A self-reported purchase document is still NOT evidence of a
      // verified order; purchase intent requires separate human adjudication.
      answers.set(cells[0],{seen,scope,purchase});
    }
    if(answers.size!==expected.size)feedback('REVIEW_CASE_COVERAGE_INCOMPLETE');
    results.push({id,answers,sha256:research.hash(submission.csv)});
  }
  let both=0,agreement=0,disagreement=0,sourceConflict=0,purchaseClaims=0;
  if(results.length===submissions.length&&
     results.every(r=>r.answers.size===expected.size)){
    for(const caseId of expected.keys()){
      const answers=results.map(r=>r.answers.get(caseId));
      if(answers.some(a=>a.purchase==='DOCUMENTED'))purchaseClaims++;
      if(answers.some(a=>a.seen!=='YES'))sourceConflict++;
      const classifications=answers.map(a=>a.seen+'|'+a.scope);
      if(new Set(classifications).size===1)agreement++;
      else disagreement++;
      both++;
    }
  }
  if(disagreement)feedback('REVIEWER_DISAGREEMENTS_REQUIRE_ADJUDICATION');
  if(sourceConflict)feedback('SOURCE_RECHECKS_REQUIRE_ADJUDICATION');
  if(purchaseClaims)feedback('PURCHASE_CLAIMS_REQUIRE_INDEPENDENT_DOCUMENTARY_VERIFICATION');
  const core={
    version:VERSION,
    status:errors.size?'REVIEW':'DECLARATIONS_ONLY_AWAITING_EXTERNAL_AUTHENTICATION',
    failures:[...errors].sort(),
    frozenAnchorFingerprint:reference.anchor.anchorFingerprint,
    reviewerPacketFingerprint:reference.reviewerPacket.packetFingerprint,
    declaredSubmissionFingerprints:results.map(r=>r.sha256).sort(),
    reviewerDeclarationsReceived:results.length,
    expectedReviewerCases:expected.size,
    caseCountReviewedByBoth:both,
    reviewerAgreementCount:agreement,
    disagreementCount:disagreement,
    casesWithSourceRecheckRequested:sourceConflict,
    casesWithUnverifiedPurchaseClaims:purchaseClaims,
    reviewerIndependenceOnlySelfDeclared:true,
    independentHumanIdentityVerified:false,
    reviewerExpertiseVerified:false,
    procurementIntentVerified:false,
    originalScoringHoldoutCasesRead:0,reservedAuditCasesReleased:0,
    independentHumanLabelsAcceptedForScoring:0,
    scoringPromotionAllowed:false,customerDeliveryAllowed:false,
    externalSendCalls:0
  };
  return {...core,receiptFingerprint:research.hash(core)};
}
function fromPrivateDirectory(folder){
  const names={
    panel:'source-panel.json',
    reviewerPacket:'reviewer-packet.json',
    reservedAudit:'reserved-audit.json',
    manifest:'split-manifest.json',
    anchor:'anchor.json'
  };
  return Object.fromEntries(Object.entries(names).map(([key,name])=>[
    key,JSON.parse(fs.readFileSync(path.join(folder,name),'utf8'))
  ]));
}
function main(args){
  if(args.length<3||args.length>5)
    throw Error('USAGE: node pipeline/construction-review-intake.js PRIVATE_FROZEN_DIR reviewer-a=completed-a.csv reviewer-b=completed-b.csv [reviewer-c=completed-c.csv] [reviewer-d=completed-d.csv]');
  const reference=fromPrivateDirectory(args[0]);
  const submissions=args.slice(1).map(arg=>{
    const i=arg.indexOf('=');
    if(i<1)throw Error('REVIEWER_ALIAS_AND_CSV_PATH_REQUIRED');
    return {reviewerId:arg.slice(0,i),role:'INDEPENDENT_DOMAIN_REVIEWER',
      isSynthetic:false,declaresIndependent:true,
      csv:fs.readFileSync(arg.slice(i+1),'utf8')};
  });
  const result=assess(reference,submissions,new Date().toISOString());
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
  if(result.status==='REVIEW')process.exitCode=1;
}
if(require.main===module){
  try{main(process.argv.slice(2));}
  catch(error){
    console.error('Review-only intake failed closed: '+(error.code||'INVALID_INPUT'));
    process.exitCode=1;
  }
}
module.exports={VERSION,HEADERS,ATTESTATION,SOURCE_SEEN,SCOPE,PURCHASE,
  parseCsv,assess,fromPrivateDirectory};
