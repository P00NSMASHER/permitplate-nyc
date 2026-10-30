'use strict';

// Static internal workbench only. No JavaScript, remote assets, user input,
// delivery permissions, merge controls, or trusted review-signoff creation.
const identity=require('./identity-bridge-review');

const VERSION='PermitPlate-private-identity-workbench-v1.0.0';
const PRIORITY=Object.freeze({
  NAME_AND_PREMISE_TO_VERIFY:0,
  CAMIS_NAME_DRIFT_REVIEW:1,
  PROPERTY_OWNER_TEXT_ONLY:2,
  PREMISE_ONLY:3,
  DOB_SLA_SHARED_PREMISE:4,
  MULTIPLE_CAMIS_SAME_PREMISE:5,
  SUPPRESSED_IDENTITY:6
});
const MONITORING_PRIORITY=Object.freeze({
  NEW_IDENTITY_HYPOTHESIS:0,SOURCE_CONTEXT_RECHECK:1,
  BASELINE_EXISTING:2,ALREADY_TRACKED:3,UNTRACKED_REVIEW:4
});
const HEADERS=Object.freeze([
  'Proposal ID','Monitoring Status','First Observed by PermitPlate',
  'Last Source Context Recheck','Review Class','Identity Hypothesis','Linked CAMIS',
  'Source Record IDs','Operator Name','Applicant DBA','Property Owner',
  'Premise Key','Name Agreement',
  'Official Building-ID Assessment','BIN Comparison','BBL Comparison',
  'Official Source A','Official Source B',
  'Evidence Fingerprint','Human Verification Decision','Reviewer Notes',
  'Customer Delivery Allowed'
]);
function escapeHtml(v){
  return String(v==null?'':v).replace(/[&<>"']/g,ch=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[ch]);
}
function csvCell(value){
  let s=String(value==null?'':value).replace(/\u0000/g,'');
  // Spreadsheet formula injection: leading whitespace may precede a formula.
  if(/^[\s]*[=+\-@]/.test(s))s="'"+s;
  return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;
}
function trustedSource(value){
  let url;
  try{url=new URL(String(value||''))}
  catch{throw Error('REVIEW_SOURCE_URL_INVALID')}
  if(url.protocol!=='https:'||url.username||url.password||
    !['data.ny.gov','data.cityofnewyork.us'].includes(url.hostname)||
    !/^\/resource\/(?:43nn-pn8j|w9ak-ipjd|f8i8-k2gm)\.json$/.test(url.pathname)||
    !url.search){
    throw Error('REVIEW_SOURCE_URL_NOT_BOUND_TO_OFFICIAL_DATASET');
  }
  return url.href;
}
function validateForRendering(receipt){
  const status=identity.validate(receipt);
  if(!status.valid)throw Error('IDENTITY_WORKBENCH_RECEIPT_INVALID');
  for(const p of receipt.proposals){
    for(const url of p.officialSourceUrls)trustedSource(url);
  }
}
function render(receipt){
  validateForRendering(receipt);
  const props=receipt.proposals.slice().sort((a,b)=>
    (a.premiseEvidence?.manualConflictHold===true?-1:0)-
      (b.premiseEvidence?.manualConflictHold===true?-1:0)||
    (MONITORING_PRIORITY[a.monitoringStatus||'UNTRACKED_REVIEW']??99)-
      (MONITORING_PRIORITY[b.monitoringStatus||'UNTRACKED_REVIEW']??99)||
    (PRIORITY[a.reviewClass]??99)-(PRIORITY[b.reviewClass]??99)||
    a.proposalId.localeCompare(b.proposalId)
  );
  const counts=Object.fromEntries(Object.keys(PRIORITY).map(k=>
    [k,props.filter(p=>p.reviewClass===k).length]
  ));
  const rows=props.map(p=>{
    const urls=p.officialSourceUrls.map(trustedSource);
    return {
      'Proposal ID':p.proposalId,
      'Monitoring Status':p.monitoringStatus||'UNTRACKED_REVIEW',
      'First Observed by PermitPlate':p.firstObservedByPermitPlateAt||'',
      'Last Source Context Recheck':p.lastContextRecheckAt||'',
      'Review Class':p.reviewClass,
      'Identity Hypothesis':p.kind,
      'Linked CAMIS':p.candidateEntityId||'',
      'Source Record IDs':p.sourceRecordIds.join(' | '),
      'Operator Name':p.candidateName||'',
      'Applicant DBA':p.sourceTradeName||'',
      'Property Owner':p.sourceOwnerName||'',
      'Premise Key':p.premiseKey,
      'Name Agreement':p.nameAgreement,
      'Official Building-ID Assessment':p.premiseEvidence?.assessment||
        'OFFICIAL_PROPERTY_IDENTIFIERS_NOT_AVAILABLE',
      'BIN Comparison':p.premiseEvidence?.binComparison||'NOT_COMPARABLE',
      'BBL Comparison':p.premiseEvidence?.bblComparison||'NOT_COMPARABLE',
      'Official Source A':urls[0],
      'Official Source B':urls[1],
      'Evidence Fingerprint':p.evidenceFingerprint,
      'Human Verification Decision':'PENDING - NOT AN APPROVAL',
      'Reviewer Notes':'',
      'Customer Delivery Allowed':'NO'
    };
  });
  const csv='\uFEFF'+
    HEADERS.map(csvCell).join(',')+'\r\n'+
    rows.map(row=>HEADERS.map(h=>csvCell(row[h])).join(',')).join('\r\n')+
    (rows.length?'\r\n':'');
  const tableRows=rows.map((row,index)=>{
    const links=[
      '<a href="'+escapeHtml(row['Official Source A'])+
        '" target="_blank" rel="noopener noreferrer">Official source A</a>',
      '<a href="'+escapeHtml(row['Official Source B'])+
        '" target="_blank" rel="noopener noreferrer">Official source B</a>'
    ].join(' · ');
    return [
      '<tr>',
      '<td>'+escapeHtml(String(index+1))+'</td>',
      '<td><strong>'+escapeHtml(row['Monitoring Status'])+'</strong><small>'+
        escapeHtml(row['First Observed by PermitPlate'])+'</small><small>Last source recheck: '+
        escapeHtml(row['Last Source Context Recheck'])+'</small></td>',
      '<td><strong>'+escapeHtml(row['Review Class'])+'</strong><small>'+
        escapeHtml(row['Identity Hypothesis'])+'</small></td>',
      '<td>'+escapeHtml(row['Premise Key'])+'<small>'+
        escapeHtml(row['Linked CAMIS'])+'</small></td>',
      '<td><strong>'+escapeHtml(row['Official Building-ID Assessment'])+
        '</strong><small>BIN: '+escapeHtml(row['BIN Comparison'])+
        ' · BBL: '+escapeHtml(row['BBL Comparison'])+
        '</small><small>Operator identity: NOT VERIFIED</small></td>',
      '<td>'+escapeHtml(row['Operator Name'])+'<small>'+
        escapeHtml(row['Applicant DBA'])+'</small><small>Owner: '+
        escapeHtml(row['Property Owner'])+'</small></td>',
      '<td>'+escapeHtml(row['Name Agreement'])+'<small>'+
        escapeHtml(row['Source Record IDs'])+'</small></td>',
      '<td>'+links+'</td>',
      '<td><strong>NOT VERIFIED</strong><small>Manual evidence required</small></td>',
      '</tr>'
    ].join('');
  }).join('\n');
  const types=Object.entries(counts).filter(([,n])=>n>0)
    .map(([type,n])=>'<span class="tag">'+escapeHtml(type)+' · '+
      escapeHtml(n)+'</span>').join('');
  const html=[
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;; base-uri &#39;none&#39;; form-action &#39;none&#39;">',
    '<title>PermitPlate — Private Identity Research</title>',
    '<style>',
    'body{font-family:system-ui,-apple-system,sans-serif;margin:0;background:#f7f8fa;color:#182532;line-height:1.4}',
    'main{max-width:1380px;margin:auto;padding:28px 24px}',
    'h1{margin:0 0 12px;font-size:1.7rem}h2{font-size:1.1rem}',
    'p{max-width:950px}.muted{color:#4b5a68}.warning{background:#fff2df;border-left:4px solid #9a610c;padding:14px;margin:18px 0}',
    '.tag{display:inline-block;border:1px solid #bcc5cf;border-radius:6px;padding:5px 8px;margin:4px;font-size:.75rem}',
    '.table{overflow-x:auto;border:1px solid #ccd3db;background:#fff;border-radius:10px}',
    'table{border-collapse:collapse;min-width:1100px;width:100%}th,td{text-align:left;padding:12px;border-bottom:1px solid #e6eaf0;vertical-align:top;font-size:.85rem}',
    'th{background:#eef2f6;position:sticky;top:0}small{display:block;color:#566270;margin-top:6px}',
    'a{color:#12427d}a:focus-visible{outline:3px solid #12427d}footer{margin-top:20px;color:#536274;font-size:.8rem}',
    '</style></head><body><main>',
    '<h1>PermitPlate · Private identity workbench</h1>',
    '<p class="muted">Source observation: '+escapeHtml(receipt.observedAt)+
      ' · Review-only hypotheses: '+escapeHtml(receipt.storedCount)+
      ' · Omitted by limit: '+escapeHtml(receipt.omittedByLimit)+'</p>',
    '<div class="warning"><strong>INTERNAL RESEARCH — NOT CUSTOMER LEADS.</strong> '+
      'Shared premises, a property owner name, or an exact printed DBA do not prove one legal or operating business. '+
      'Every hypothesis requires independent documentary verification and a separate governed acceptance. '+
      'Nothing on this page approves an identity, changes a customer report, or authorizes a send.</div>',
    '<h2>Review categories</h2><p>'+types+'</p>',
    '<p class="muted">Monitoring novelty means new to PermitPlate, never proof of a new restaurant or opening. '+
      'A source-context recheck is not verified change in ownership or identity. '+
      'The companion CSV is for offline notes; it cannot be imported as approval.</p>',
    '<div class="table"><table><thead><tr>',
    '<th>#</th><th>Monitoring</th><th>Reason for review</th><th>Premise</th><th>Building-ID evidence</th><th>Printed names</th>'+
      '<th>Source identities</th><th>Official records</th><th>Decision</th>',
    '</tr></thead><tbody>',
    tableRows||'<tr><td colspan="9">No current source relationships proposed.</td></tr>',
    '</tbody></table></div>',
    '<footer>Document source: private verified PermitPlate research snapshot. '+
      'Automatic merges: 0. Customer delivery: prohibited. No external assets or scripts.</footer>',
    '</main></body></html>'
  ].join('\n');
  return {
    version:VERSION,status:'INTERNAL_REVIEW_ONLY',
    totalProposals:receipt.totalProposals,
    renderedCount:props.length,
    omittedByLimit:receipt.omittedByLimit,
    byClass:counts,
    html,csv,
    customerDeliveryAllowed:false,automaticIdentityLinkAllowed:false
  };
}
module.exports={VERSION,PRIORITY,MONITORING_PRIORITY,HEADERS,escapeHtml,csvCell,trustedSource,
  validateForRendering,render};
