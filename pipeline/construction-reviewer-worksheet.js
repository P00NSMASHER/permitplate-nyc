'use strict';

// Review-only material compiled solely from the immutable construction
// REVIEWER packet. Its reserved audit is used only in-memory to authenticate
// the frozen split and is NEVER rendered, counted by case ID or exported.
const frozen=require('./construction-frozen-reference');
const research=require('./curated-research-ledger');
const {csvCell,escapeHtml}=require('./identity-review-workbench');

const VERSION='PermitPlate-frozen-construction-worksheet-v1.0.0';
const HEADERS=Object.freeze([
  'Review Case ID','DOB Official Filing','Official NYC DOB Record URL',
  'Original Filing Date','Publisher Filing Status','Borough','Premise',
  'Job Family for Grouped Assessment','Unabridged Official Job Description',
  'Source Scope Fingerprint','Source Seen In Official Record? (BLANK)',
  'Equipment Construction Relevance (BLANK)','Documentary Source Notes (BLANK)',
  'Purchase Intent Documented? (BLANK)','Reviewed At (BLANK)',
  'Reviewer Attestation (BLANK)'
]);
function officialLink(card){
  const id=String(card?.officialSourceRecordId||'');
  if(!/^DOB_NOW:[A-Za-z0-9-]+$/.test(id))throw Error('REVIEW_CASE_SOURCE_ID_INVALID');
  const expected='https://data.cityofnewyork.us/resource/w9ak-ipjd.json?job_filing_number='+
    encodeURIComponent(id.slice('DOB_NOW:'.length));
  if(card.officialSourceUrl!==expected)throw Error('REVIEW_CASE_NONOFFICIAL_SOURCE_URL');
  return expected;
}
function render(reference){
  if(!frozen.validate(reference).valid)throw Error('UNVERIFIED_FROZEN_CONSTRUCTION_SOURCE');
  const cards=reference.reviewerPacket.cards;
  const auditIds=new Set(reference.reservedAudit.cases.map(x=>x.caseId));
  if(cards.some(card=>auditIds.has(card.caseId))||
     reference.anchor.reviewCases!==cards.length||
     reference.anchor.reservedCases!==auditIds.size){
    throw Error('RESERVED_CONSTRUCTION_AUDIT_LEAKAGE');
  }
  const rows=cards.map(c=>{
    const url=officialLink(c);
    if(c.customerDeliveryAllowed!==false||
       !/^[a-f0-9]{64}$/.test(c.scopeFingerprint||'')||
       typeof c.originalScopeText!=='string'||
       !String(c.caseId||'').startsWith('DOBCASE:')){
      throw Error('REVIEW_CASE_UNVERIFIED');
    }
    return {
      'Review Case ID':c.caseId,
      'DOB Official Filing':c.officialSourceRecordId,
      'Official NYC DOB Record URL':url,
      'Original Filing Date':c.dateInOfficialRecord,
      'Publisher Filing Status':c.governmentFilingStatus,
      'Borough':c.borough,
      'Premise':c.address,
      'Job Family for Grouped Assessment':c.projectFamilyKey,
      'Unabridged Official Job Description':c.originalScopeText,
      'Source Scope Fingerprint':c.scopeFingerprint,
      'Source Seen In Official Record? (BLANK)':'',
      'Equipment Construction Relevance (BLANK)':'',
      'Documentary Source Notes (BLANK)':'',
      'Purchase Intent Documented? (BLANK)':'',
      'Reviewed At (BLANK)':'',
      'Reviewer Attestation (BLANK)':''
    };
  });
  const csv='\uFEFF'+HEADERS.map(csvCell).join(',')+'\r\n'+
    rows.map(row=>HEADERS.map(key=>csvCell(row[key])).join(',')).join('\r\n')+'\r\n';
  const htmlRows=rows.map((row,i)=>[
    '<tr>',
    '<td>'+escapeHtml(i+1)+'</td>',
    '<td>'+escapeHtml(row['Review Case ID'])+
      '<small>'+escapeHtml(row['Job Family for Grouped Assessment'])+'</small></td>',
    '<td><a href="'+escapeHtml(row['Official NYC DOB Record URL'])+
      '" target="_blank" rel="noopener noreferrer">Open official DOB filing</a><small>'+
      escapeHtml(row['Original Filing Date'])+' · '+
      escapeHtml(row['Publisher Filing Status'])+'</small></td>',
    '<td>'+escapeHtml(row['Borough'])+' · '+
      escapeHtml(row['Premise'])+'</td>',
    '<td><pre>'+escapeHtml(row['Unabridged Official Job Description'])+'</pre></td>',
    '<td><strong>NOT REVIEWED</strong><small>Check official record, record evidence and return your own judgment independently.</small></td>',
    '</tr>'
  ].join('')).join('\n');
  const html=[
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;; base-uri &#39;none&#39;; form-action &#39;none&#39;">',
    '<title>PermitPlate | Blinded official construction evidence review</title>',
    '<style>',
    'body{font:15px/1.5 system-ui,-apple-system,sans-serif;background:#f7f8fa;color:#182d42;margin:0}',
    'main{max-width:1440px;margin:0 auto;padding:24px}h1{font-size:1.6em}',
    'table{border-collapse:collapse;width:100%;min-width:1150px;background:white}',
    'td,th{padding:12px;border-bottom:1px solid #d7dee6;text-align:left;vertical-align:top}',
    'thead{background:#e9eff5}small{display:block;color:#4b5c6b;margin-top:5px}',
    'pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere;margin:0}',
    '.pane{overflow-x:auto}.notice{background:#fff1db;border-left:4px solid #935a0b;padding:12px}',
    'a{color:#12447c}a:focus-visible{outline:3px solid #12447c}',
    '</style></head><body><main>',
    '<h1>PermitPlate · Official construction-source review</h1>',
    '<p class="notice"><strong>Private review only.</strong> These '+
      escapeHtml(rows.length)+' filings are source-research questions, NOT verified buying opportunities. '+
      'Do not assume a DOB property owner is the restaurant operator. '+
      'Never use a name, permit status, or building address as evidence of equipment procurement.</p>',
    '<p>Packet first frozen from official source observation: '+
      escapeHtml(reference.anchor.originalSourceObservedAt)+
      '. Separate reserved audit files, model scores, synthetic opinions and the original scoring holdout are intentionally excluded.</p>',
    '<p>For each row, open the official filing and independently document (1) exact source scope, '+
      '(2) equipment/construction relevance, (3) unsupported identity or buyer inferences, and (4) '+
      'source citations. Use the companion CSV with empty judgment fields for your own notes. '+
      'The CSV is not a signed review or an automatic calibration import.</p>',
    '<div class="pane"><table><thead><tr>',
    '<th>#</th><th>Case / job group</th><th>Original source</th><th>Location</th>',
    '<th>Unabridged official job description</th><th>Reviewer decision</th>',
    '</tr></thead><tbody>',
    htmlRows,
    '</tbody></table></div>',
    '<p><strong>Zero human judgments recorded.</strong> No production scoring or customer delivery is authorized.</p>',
    '</main></body></html>'
  ].join('\n');
  const core={
    version:VERSION,
    status:'UNLABELED_FROZEN_REVIEWER_WORKSHEET',
    frozenAnchorFingerprint:reference.anchor.anchorFingerprint,
    reviewerPacketFingerprint:reference.reviewerPacket.packetFingerprint,
    caseCount:rows.length,
    reservedAuditCaseIdsEmitted:0,
    hiddenOriginalScoringHoldoutAccessed:0,
    syntheticJudgmentsIncluded:false,
    humanJudgmentsPreFilled:0,
    customerDeliveryAllowed:false,
    productionAuthorized:false,
    htmlSha256:research.hash(html),
    csvSha256:research.hash(csv)
  };
  return {
    html,csv,
    receipt:{...core,receiptFingerprint:research.hash(core)}
  };
}
function verifyFiles(reference,worksheet){
  try{
    const expected=render(reference);
    return {
      valid:research.hash(expected)===research.hash(worksheet),
      failures:research.hash(expected)===research.hash(worksheet)?[]:
        ['FROZEN_REVIEWER_WORKSHEET_CHANGED']
    };
  }catch{
    return {valid:false,failures:['FROZEN_REVIEWER_WORKSHEET_INVALID']};
  }
}
module.exports={VERSION,HEADERS,officialLink,render,verifyFiles};
