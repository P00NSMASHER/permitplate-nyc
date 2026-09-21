'use strict';

const {verify,VERSION}=require('./calibration-cohort');
const {VERDICTS,REVIEWER_ROLES}=require('./calibration-evaluation');
function renderWorkbench(packet){
  if(!verify(packet)||packet.version!==VERSION)throw new Error('VALID_BLIND_PACKET_REQUIRED');
  // Source text is data, never interpreted as HTML/script. No model predictions
  // or operator manifest are embedded anywhere in this standalone document.
  const json=JSON.stringify(packet).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'">
<title>PermitPlate • Blind evidence review</title><style>
:root{font:16px/1.5 system-ui,sans-serif;color:#183340;background:#edf4f4}*{box-sizing:border-box}body{margin:0}header{background:#103d4e;color:white;padding:28px max(20px,calc((100vw - 1120px)/2))}header h1{font-size:clamp(24px,5vw,38px);margin:5px 0}header p{max-width:850px;margin:4px 0}.eyebrow{color:#8fe5cb;font-weight:700;letter-spacing:.04em;font-size:13px}main{max-width:1120px;padding:20px;margin:auto}.panel,article{background:white;border:1px solid #c8dddd;border-radius:14px;padding:20px;margin-bottom:20px;box-shadow:0 2px 5px #1640520b}.tools{display:flex;gap:12px;flex-wrap:wrap;align-items:end}.tools label{flex:1;min-width:200px}.tools .wide{flex-basis:100%}input,select,textarea,button{font:inherit;border:1px solid #8badb6;border-radius:7px;padding:10px;width:100%}textarea{min-height:75px;resize:vertical}input[type=checkbox]{width:auto}label{display:block;margin:8px 0}.small{font-size:13px;color:#456574}button{background:#0c6470;color:white;border:0;font-weight:700;cursor:pointer;min-height:44px;width:auto}button.secondary{background:#e8f1f4;color:#174151}.actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.warning{background:#fff1ce;border-left:4px solid #ad7105;padding:12px;border-radius:5px}h2{margin:0;font-size:22px}h3{margin:0 0 8px;font-size:18px}.meta{margin:8px 0}details{padding:8px 0}summary{cursor:pointer;font-weight:650}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.5 ui-monospace,monospace;background:#f3f7f8;padding:12px;border-radius:6px}a{color:#086774;overflow-wrap:anywhere}.decisions{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:14px}.decision{background:#f6fafb;border:1px solid #d4e4e8;border-radius:9px;padding:14px}.top{display:flex;justify-content:space-between;gap:12px;align-items:start}.pill{font-size:12px;padding:4px 8px;border-radius:8px;background:#e6f5f0;color:#115c4b}.pager{display:flex;justify-content:space-between;align-items:center;gap:12px}#notice{font-weight:600;color:#794800}footer{padding:10px 0 24px;font-size:13px;color:#456574}button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:3px solid #00b6b1;outline-offset:2px}
</style></head><body><header><div class="eyebrow">PERMITPLATE / INTERNAL RESEARCH</div><h1>Would this deserve a vendor’s attention?</h1><p>Review official evidence without seeing the ranking. Your judgment is about whether research is worthwhile—not whether a business will buy.</p></header><main>
<section class="panel"><h2>Independent review</h2><p id="instructions"></p><p id="synthetic" class="warning" hidden>Synthetic test cohort. This cannot establish real buyer relevance.</p>
<div class="tools"><label>Reviewer code (not an email)<input id="reviewer" autocomplete="off" placeholder="e.g. reviewer-alpha" pattern="[a-zA-Z0-9_-]{3,64}" maxlength="64"></label><label>Your review role<select id="role"><option value="">Choose your role</option>${REVIEWER_ROLES.map(v=>'<option value="'+v+'">'+v.replaceAll('_',' ')+'</option>').join('')}</select></label><label class="wide"><input id="attest" type="checkbox"> I independently reviewed these sources, without consulting the model’s scores or another reviewer’s labels.</label></div>
<div class="actions"><button id="export">Export completed judgments</button><button id="importButton" class="secondary">Resume a saved review</button><input type="file" id="import" accept="application/json,.json" hidden><span id="progress" aria-live="polite"></span></div><p class="small">Nothing is sent, uploaded or saved automatically. Export your file before closing. Use an opaque reviewer code. Keep completed reviews private. External source links open only when you click.</p><p id="notice" role="status"></p></section>
<section class="panel"><div class="pager"><button id="previous" class="secondary">Previous</button><strong id="page"></strong><button id="next" class="secondary">Next</button></div></section><div id="cards"></div>
<footer id="provenance"></footer></main><script type="application/json" id="packet">${json}</script><script>
'use strict';
const packet=JSON.parse(document.getElementById('packet').textContent);
const verdicts=${JSON.stringify(VERDICTS)};
const labels={PURSUE_NOW:'Pursue now — worth researching',WATCH:'Watch — plausible fit, no urgency',NOT_RELEVANT:'Not relevant / identity unsuitable',INSUFFICIENT_EVIDENCE:'Insufficient evidence to act'};
const answers=new Map();let page=0;const pageSize=5;
const el=id=>document.getElementById(id);
const node=(tag,text,className)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;};
el('instructions').textContent=packet.instructions;
el('synthetic').hidden=!packet.isSynthetic;
el('provenance').textContent='Snapshot '+packet.observedAt+' · '+packet.cohortId+' · No outreach or delivery. Reviewer declarations still require operator verification.';
const key=(card,category)=>card.caseId+'|'+category;
function complete(a){return a&&verdicts.includes(a.verdict)&&a.reason.trim().length>=12&&a.evidenceRefs.length>0;}
function progress(){el('progress').textContent=[...answers.values()].filter(complete).length+' / '+(packet.cards.length*packet.categories.length)+' judgments complete';}
function render(){
 el('cards').replaceChildren();
 const start=page*pageSize;
 el('page').textContent=packet.cards.length?'Cases '+(start+1)+'–'+Math.min(start+pageSize,packet.cards.length)+' of '+packet.cards.length:'No cases';
 el('previous').disabled=page===0;el('next').disabled=start+pageSize>=packet.cards.length;
 for(const card of packet.cards.slice(start,start+pageSize)){
  const article=node('article'),top=node('div',undefined,'top');top.append(node('h2',card.businessName||'Business name unavailable'),node('span',card.caseId.slice(-8),'pill'));article.append(top);
  article.append(node('p',[card.address,card.borough].filter(Boolean).join(' · '),'meta'));
  article.append(node('p','Stage: '+card.stage+' | Source event: '+(card.businessEventDate||'Not proven')+' | Basis: '+card.eventDateBasis,'small'));
  if(card.identityCaveat)article.append(node('p',card.identityCaveat,'warning'));
  article.append(node('p',card.chronologyLimitation,'small'));
  for(const evidence of card.evidence){
   const details=node('details');details.append(node('summary',evidence.sourceSystem+' — '+evidence.recordId));
   details.append(node('pre',JSON.stringify(evidence.facts,null,2)));
   if(evidence.sourceUrl){const a=node('a','Open official source');a.href=evidence.sourceUrl;a.target='_blank';a.rel='noopener noreferrer';details.append(a);}
   article.append(details);
  }
  const decisions=node('div',undefined,'decisions');
  for(const category of packet.categories){
   const box=node('section',undefined,'decision');box.append(node('h3',category));
   const prior=answers.get(key(card,category))||{caseId:card.caseId,category,evidenceFingerprint:card.evidenceFingerprint,verdict:'',reason:'',evidenceRefs:[],reviewedAt:null};
   const decisionLabel=node('label','Judgment');const select=node('select');select.append(new Option('Select a judgment',''));for(const v of verdicts)select.append(new Option(labels[v],v));select.value=prior.verdict;decisionLabel.append(select);
   const reasonLabel=node('label','Why? Cite the business evidence, not assumptions.');const reason=node('textarea');reason.value=prior.reason;reason.maxLength=1600;reasonLabel.append(reason);
   const sourceLabel=node('label','Supporting source record');const source=node('select');source.append(new Option('Choose evidence',''));for(const e of card.evidence)source.append(new Option(e.sourceSystem+' · '+e.recordId,e.recordId));source.value=prior.evidenceRefs[0]||'';sourceLabel.append(source);
   const update=()=>{answers.set(key(card,category),{...prior,verdict:select.value,reason:reason.value,evidenceRefs:source.value?[source.value]:[],reviewedAt:new Date().toISOString()});progress();};
   select.addEventListener('change',update);source.addEventListener('change',update);reason.addEventListener('input',update);box.append(decisionLabel,reasonLabel,sourceLabel);decisions.append(box);
  }
  article.append(decisions);el('cards').append(article);
 }
 progress();
}
el('previous').onclick=()=>{page=Math.max(0,page-1);render();};el('next').onclick=()=>{page++;render();};
el('export').onclick=()=>{
 const reviewerId=el('reviewer').value.trim();
 if(!/^[a-zA-Z0-9_-]{3,64}$/.test(reviewerId)||!el('role').value||!el('attest').checked){el('notice').textContent='Enter a reviewer code and role, then confirm independent review.';return;}
 const judgments=[...answers.values()].filter(complete);
 if(!judgments.length){el('notice').textContent='No completed judgments yet. Each needs a decision, explanation and source reference.';return;}
 const envelope={version:packet.version,cohortFingerprint:packet.cohortFingerprint,packetFingerprint:packet.fingerprint,
  phase:packet.phase,lockFingerprint:packet.lockFingerprint,reviewerId,reviewerRole:el('role').value,
  attestation:'INDEPENDENT_HUMAN_SOURCE_REVIEW',blinded:true,isSynthetic:packet.isSynthetic,judgments};
 const blob=new Blob([JSON.stringify(envelope,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=node('a');
 a.href=url;a.download='permitplate-review-'+reviewerId+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
 el('notice').textContent='Exported '+judgments.length+' completed judgments. Nothing was uploaded.';
};
el('importButton').onclick=()=>el('import').click();
el('import').onchange=async()=>{
 try{
  const file=el('import').files[0];if(!file||file.size>5000000)throw new Error('Invalid or oversized review file.');
  const saved=JSON.parse(await file.text());
  if(saved.packetFingerprint!==packet.fingerprint||!Array.isArray(saved.judgments))throw new Error('This review belongs to a different packet.');
  const permitted=new Map(packet.cards.map(c=>[c.caseId,c]));
  for(const j of saved.judgments){const c=permitted.get(j.caseId);
   if(!c||!packet.categories.includes(j.category)||!verdicts.includes(j.verdict)||typeof j.reason!=='string'||!Array.isArray(j.evidenceRefs)||j.evidenceFingerprint!==c.evidenceFingerprint||j.evidenceRefs.some(r=>!c.evidence.some(e=>e.recordId===r)))throw new Error('Invalid judgment in review file.');
  }
  answers.clear();for(const j of saved.judgments)answers.set(j.caseId+'|'+j.category,j);
  el('reviewer').value=saved.reviewerId||'';el('role').value=saved.reviewerRole||'';el('attest').checked=false;
  el('notice').textContent='Review restored locally. Reconfirm independent review before exporting.';render();
 }catch(error){el('notice').textContent=error.message;}
};
render();
</script></body></html>`;
}
module.exports={renderWorkbench};
