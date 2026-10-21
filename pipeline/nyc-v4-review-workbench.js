'use strict';

// Private, read-only operator experience for V4 source-relevance scores.
// Never issues buyer verdicts, customer signals, score receipts, or messages.
const crypto=require('node:crypto');
const research=require('./curated-research-ledger');
const scorer=require('./nyc-v4-internal-production-scoring');
const profiles=require('./subscriber-profile');

const VERSION='PermitPlate-NYC-v4-private-review-workbench-v1.0.0';
const HTML_PREVIEW_PER_CATEGORY=16;
const SOURCE_BASIS_LABELS=Object.freeze({
  SOURCE_KEYWORD_CONTEXT:'Official filing keyword — category applicability unverified',
  RELATED_OFFICIAL_ACTIVITY:'Related official activity — no category-specific demand proven',
  APPLICANT_CONTEXT_ONLY:'Applicant context only — no category-specific demand proven'
});
const EVENT_LABELS=Object.freeze({
  DOHMH_INSPECTION_DATE:'Official DOHMH inspection',
  SLA_APPLICATION_RECEIVED_DATE:'Official SLA application received',
  DOB_INITIAL_FILING_DATE:'Verified DOB initial filing'
});
const CSV_HEADERS=Object.freeze([
  'CAMIS research ID','Public business name','Public address','NYC borough',
  'Vendor category','Internal V4 source relevance (heuristic, NOT buyer probability)',
  'Official evidence class','Original official event date','Official event type',
  'Official source record ID','Official event source URL','Official CAMIS inspection URL',
  'Original score fingerprint','Owner source verified (BLANK)',
  'Buyer need independently verified (BLANK)','Owner investigation notes (BLANK)',
  'Research disposition (BLANK)','Customer scored delivery allowed'
]);
function hash(v){return crypto.createHash('sha256').update(String(v)).digest('hex');}
function seal(v){const out={...v};delete out.fingerprint;return {...out,fingerprint:hash(JSON.stringify(out))};}
function escapeHtml(value){
  return String(value==null?'':value).replace(/[&<>"']/g,
    ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function csvCell(value){
  let s=String(value==null?'':value).replace(/\u0000/g,'');
  // Spreadsheet formula injection can be hidden behind whitespace.
  if(/^\s*[=+\-@]/u.test(s))s="'"+s;
  return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;
}
function trustedOfficialUrl(value){
  let url;
  try{url=new URL(String(value||''));}
  catch{throw Error('OFFICIAL_URL_UNVERIFIED');}
  const host=url.hostname.toLowerCase(),route=url.pathname;
  if(url.protocol!=='https:'||url.username||url.password||url.port||
     url.hash||url.host!==host)throw Error('OFFICIAL_URL_UNVERIFIED');
  const city=host==='data.cityofnewyork.us',state=host==='data.ny.gov';
  const citySet=new Set(['43nn-pn8j','w9ak-ipjd']);
  const landing=/^\/d\/([a-z0-9-]{9})$/.exec(route);
  const data=/^\/resource\/([a-z0-9-]{9})\.json$/.exec(route);
  let matched=false;
  if(landing){
    matched=((city&&citySet.has(landing[1]))||(state&&landing[1]==='f8i8-k2gm'))&&!url.search;
  }else if(data){
    matched=(city&&citySet.has(data[1]))||(state&&data[1]==='f8i8-k2gm');
    if(matched&&url.search){
      const key=data[1]==='43nn-pn8j'?'camis':
        data[1]==='w9ak-ipjd'?'job_filing_number':'application_id';
      matched=[...url.searchParams.keys()].length===1&&url.searchParams.has(key)&&
        !!url.searchParams.get(key)&&!/[<>"'\\]/.test(url.searchParams.get(key));
    }
  }
  if(!matched)throw Error('OFFICIAL_URL_UNVERIFIED');
  return url.href;
}
function camisUrl(camis){
  if(!/^\d{5,12}$/.test(String(camis||'')))throw Error('PUBLIC_CAMIS_ID_INVALID');
  return trustedOfficialUrl(
    'https://data.cityofnewyork.us/resource/43nn-pn8j.json?camis='+encodeURIComponent(camis));
}
function reject(failures){
  return {status:'REVIEW',failures:[...new Set(failures)].sort(),
    html:null,csv:null,receipt:null,customerDeliveryAllowed:false,externalSendCalls:0};
}
function verify(input){
  const graph=input?.graph,scores=input?.scores,failures=[];
  const graphCheck=research.checkGraph(graph);
  if(!graphCheck.valid)failures.push(...graphCheck.failures);
  if(!scorer.validateSnapshot(scores).valid)failures.push('INTERNAL_SCORE_RECEIPT_INVALID');
  if(graph?.graphDigest!==scores?.graphDigest||
     graph?.observedAt!==scores?.observedAt||
     graph?.candidates?.length!==scores?.candidateCount){
    failures.push('SCORE_GRAPH_MISMATCH');
  }
  for(const key of research.REQUIRED_SOURCES){
    if(!graph?.sourceObservations?.[key]||!scores?.sourceObservationIds||
      scores.sourceObservationIds[key]!==graph.sourceObservations[key].observationId){
      failures.push('SOURCE_OBSERVATION_BINDING_MISMATCH');break;
    }
  }
  const byId=new Map((graph?.candidates||[]).map(c=>[c.entityId,c]));
  if(byId.size!==(graph?.candidates||[]).length)failures.push('DUPLICATE_GRAPH_CAMIS');
  for(const row of scores?.researchRows||[]){
    const c=byId.get(row.entityId);
    if(!c||c.deliverySuppressed===true||
       (c.crossCamisOperationalConflicts||[]).length>0||
       c.entityId!==row.entityId||c.camis!==row.camis||c.borough!==row.borough||
       !profiles.BOROUGH_ORDER.includes(c.borough)){
      failures.push('WORKBENCH_SUPPRESSED_OR_MISMATCHED_SOURCE');continue;
    }
    try{trustedOfficialUrl(row.officialSourceUrl);camisUrl(row.camis);}
    catch{failures.push('WORKBENCH_UNTRUSTED_SOURCE_URL');}
    if(!EVENT_LABELS[row.eventBasis]||!/^\d{4}-\d\d-\d\d$/.test(row.eventDate||'')||
       !row.eventSourceRecordId)failures.push('WORKBENCH_SOURCE_EVENT_UNVERIFIED');
  }
  return {valid:failures.length===0,failures:[...new Set(failures)].sort()};
}
function stableRow(row,candidate,category){
  const source=trustedOfficialUrl(row.officialSourceUrl),record=camisUrl(row.camis);
  return {
    'CAMIS research ID':row.entityId,
    'Public business name':candidate.canonicalName||'',
    'Public address':candidate.address||'',
    'NYC borough':row.borough,
    'Vendor category':category,
    'Internal V4 source relevance (heuristic, NOT buyer probability)':row.scores[category],
    'Official evidence class':SOURCE_BASIS_LABELS[row.categoryBases[category]],
    'Original official event date':row.eventDate,
    'Official event type':EVENT_LABELS[row.eventBasis],
    'Official source record ID':row.eventSourceRecordId,
    'Official event source URL':source,
    'Official CAMIS inspection URL':record,
    'Original score fingerprint':row.internalScoreId,
    'Owner source verified (BLANK)':'',
    'Buyer need independently verified (BLANK)':'',
    'Owner investigation notes (BLANK)':'',
    'Research disposition (BLANK)':'',
    'Customer scored delivery allowed':'NO'
  };
}
function compare(category){
  return (a,b)=>b.scores[category]-a.scores[category]||
    b.eventDate.localeCompare(a.eventDate)||a.entityId.localeCompare(b.entityId);
}
function renderCard(row,candidate,category){
  const source=trustedOfficialUrl(row.officialSourceUrl),record=camisUrl(row.camis);
  const score=row.scores[category],basis=SOURCE_BASIS_LABELS[row.categoryBases[category]];
  return `<article class="case"><div class="case-heading"><h3>${escapeHtml(candidate.canonicalName||row.entityId)}</h3>
<span class="number" aria-label="Heuristic source relevance score">${score}<small>heuristic</small></span></div>
<p class="location">${escapeHtml(candidate.borough)} · ${escapeHtml(candidate.address)}</p>
<dl><div><dt>Official event</dt><dd>${escapeHtml(EVENT_LABELS[row.eventBasis])} · ${escapeHtml(row.eventDate)}</dd></div>
<div><dt>Evidence</dt><dd>${escapeHtml(basis)}</dd></div></dl>
<p class="source-links"><a href="${escapeHtml(source)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">Official evidence</a>
<a href="${escapeHtml(record)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">CAMIS inspections</a></p>
<p class="review-note">Verify relevance, timing, and unmet needs independently. No buyer or outreach approval.</p></article>`;
}
function renderHtml(scores,byId,counts){
  const sections=scorer.CATEGORIES.map((category,i)=>{
    const id='category-'+category.toLowerCase().replace(/[^a-z0-9]+/g,'-');
    const rows=scores.researchRows.slice().sort(compare(category));
    const top=rows.slice(0,HTML_PREVIEW_PER_CATEGORY);
    return `<section id="${id}" class="category" aria-labelledby="heading-${id}">
<div class="section-title"><div><p class="eyebrow">0${i+1} / ${scorer.CATEGORIES.length}</p>
<h2 id="heading-${id}">${escapeHtml(category)}</h2>
<p class="section-explainer">Top ${top.length} of ${rows.length} source-dated research records. Private CSV contains all.</p></div>
<a href="#top">Back to top ↑</a></div>
<div class="card-grid">${top.map(row=>renderCard(row,byId.get(row.entityId),category)).join('\n')}</div></section>`;
  }).join('\n');
  const nav=scorer.CATEGORIES.map(category=>{
    const id='category-'+category.toLowerCase().replace(/[^a-z0-9]+/g,'-');
    return `<a href="#${id}">${escapeHtml(category)} <span>${counts[category]}</span></a>`;
  }).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; object-src 'none'">
<meta name="referrer" content="no-referrer">
<title>PermitPlate NYC · Private source-evidence research</title>
<style>
:root{color-scheme:light;--paper:#f6f5f1;--ink:#172b31;--muted:#536269;--line:#d6dbd9;--white:#fff;--accent:#2e5d64}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:1180px;margin:auto;padding:35px 28px 100px}
.eyebrow{font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);margin:0 0 7px}
h1{font:700 clamp(31px,4vw,52px)/1.08 Georgia,serif;letter-spacing:-.02em;margin:0 0 15px;max-width:850px}
h2{font:700 32px/1.1 Georgia,serif;margin:0 0 7px}
h3{font-size:18px;line-height:1.25;margin:0}
p{margin:.5em 0 1em}.intro{font-size:17px;max-width:780px;color:var(--muted)}
.label{font-weight:700;color:var(--ink)}
.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--line);border:1px solid var(--line);margin:30px 0}
.metrics>div{padding:20px 22px;background:var(--white)}
.metrics strong{display:block;font:700 30px/1.1 Georgia,serif;margin-bottom:6px}
.metrics span{font-size:12px;color:var(--muted);display:block}
.notice{border-left:4px solid var(--accent);padding:18px 24px;background:#edf0ed;margin:18px 0 28px}
.notice strong{display:block;margin-bottom:4px}.notice p{margin:0;font-size:14px}
nav{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 46px}
nav a{display:inline-flex;gap:10px;align-items:center;padding:9px 12px;border:1px solid var(--line);background:white;border-radius:5px;text-decoration:none}
a{color:#235963}a:hover,a:focus{text-decoration:underline}nav span{font-size:11px;color:var(--muted)}
.category{margin-top:60px;scroll-margin-top:22px}
.section-title{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;border-bottom:2px solid var(--ink);padding-bottom:17px;margin-bottom:22px}
.section-explainer{color:var(--muted);font-size:13px;margin:0}
.card-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
.case{padding:20px 21px;background:white;border:1px solid var(--line);border-radius:6px;min-width:0;overflow-wrap:anywhere}
.case-heading{display:flex;gap:12px;align-items:start;justify-content:space-between}
.number{font:700 27px/1 Georgia,serif;white-space:nowrap;color:var(--accent)}
.number small{font:normal 11px/1 sans-serif;display:block;color:var(--muted);text-align:right;margin-top:5px}
.location{color:var(--muted);font-size:12px}
dl{margin:16px 0}dl div{display:flex;gap:12px;padding:7px 0;border-top:1px solid #eef0ed}
dt{width:110px;flex-shrink:0;color:var(--muted);font-size:12px}dd{margin:0;font-size:12px;font-weight:650}
.source-links{display:flex;flex-wrap:wrap;gap:15px;font-size:12px;font-weight:700}
.review-note{font-size:11px;color:var(--muted);margin-bottom:0}
.footer{margin-top:70px;border-top:1px solid var(--line);padding-top:22px;color:var(--muted);font-size:12px}
@media(max-width:750px){main{padding:22px 16px 70px}.metrics{grid-template-columns:repeat(2,1fr)}.card-grid{grid-template-columns:1fr}.section-title{align-items:flex-start;flex-direction:column}dt{width:90px}}
@media print{main{padding:10px}.card-grid{display:block}.case{break-inside:avoid;margin-bottom:8px}.footer,nav{display:none}}
</style></head><body><main id="top">
<header><p class="eyebrow">PermitPlate / Private operator research / No sending</p>
<h1>Source-linked restaurant research</h1>
<p class="intro"><strong>Source-relevance, not buyer intent.</strong> Prioritize human checks of public NYC restaurant events without treating model scores as purchase probabilities, business openings, or approval to contact anyone.</p>
<p class="label">Official-source snapshot: ${escapeHtml(scores.observedAt)}</p></header>
<div class="metrics" aria-label="Research scope">
<div><strong>${scores.knownEventScoredCount}</strong><span>Source-dated research candidates</span></div>
<div><strong>${scores.unknownEventHeldCount}</strong><span>Unverified business dates held</span></div>
<div><strong>${scores.suppressedCount}</strong><span>Identity/jurisdiction holds</span></div>
<div><strong>${scores.excludedFitCount+scores.reviewHeldCount}</strong><span>Other research exclusions</span></div></div>
<aside class="notice"><strong>Human assessment required. No external delivery.</strong>
<p>All numeric values are <em>bounded research heuristics</em>, not buying intent, sales likelihood, or independently measured precision. Official events may describe existing activity. Category need, availability, business identity and timing require separate verification. Never copy an internal score into a customer report or use it to authorize messaging.</p></aside>
<nav aria-label="Review category navigation">${nav}</nav>
${sections}
<footer class="footer"><p>Generated deterministically from a verified private source graph and V4 score receipt. No scripts, external assets, customer data, automatic actions, or contact links. Full category worksheet with blank reviewer decisions is in the private CSV. Do not publish this HTML.</p></footer>
</main></body></html>\n`;
}
function build(input){
  const graph=input?.graph||{},scores=input?.scores||{};
  const checked=verify({graph,scores});
  if(!checked.valid)return reject(checked.failures);
  const byId=new Map(graph.candidates.map(c=>[c.entityId,c]));
  const csvRows=[],counts={};
  for(const category of scorer.CATEGORIES){
    counts[category]=0;
    const records=scores.researchRows.slice().sort(compare(category));
    for(const row of records){
      csvRows.push(stableRow(row,byId.get(row.entityId),category));
      counts[category]++;
    }
  }
  const csv=CSV_HEADERS.map(csvCell).join(',')+'\n'+
    csvRows.map(row=>CSV_HEADERS.map(k=>csvCell(row[k])).join(',')).join('\n')+'\n';
  const html=renderHtml(scores,byId,counts);
  const receipt=seal({
    manifestVersion:VERSION,status:'REVIEW_READY',observedAt:scores.observedAt,
    graphDigest:graph.graphDigest,scoreFingerprint:scores.fingerprint,
    sourceScoreCount:scores.knownEventScoredCount,
    distinctBusinessesDisplayed:scores.researchRows.length,
    displayedRowCount:csvRows.length,categoryCounts:counts,
    htmlPreviewPerCategory:HTML_PREVIEW_PER_CATEGORY,
    htmlSha256:hash(html),csvSha256:hash(csv),
    buyerOutcomesIndependentlyVerified:0,verifiedBuyerPrecision:null,
    ownerApproved:false,customerDeliveryAllowed:false,
    productionAuthorized:false,externalSendCalls:0,
    limitation:'Private human research worksheet; V4 heuristics are not verified buyers or customer score authority.'
  });
  return {status:'READY_FOR_PRIVATE_HUMAN_REVIEW',
    html,csv,receipt,customerDeliveryAllowed:false,externalSendCalls:0};
}
module.exports={VERSION,HTML_PREVIEW_PER_CATEGORY,SOURCE_BASIS_LABELS,EVENT_LABELS,
  CSV_HEADERS,hash,seal,escapeHtml,csvCell,trustedOfficialUrl,camisUrl,reject,verify,build};
