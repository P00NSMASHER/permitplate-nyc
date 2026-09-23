'use strict';

const crypto=require('crypto');

const OFFER_VERSION='PermitPlate-founder-curated-offer-v1.0.0';
const LAUNCH_MODE='FOUNDER_CURATED_NO_SCORE_V1';
const MAX_SIGNALS=10;
const CATEGORY_VALUES=Object.freeze([
  'pos','insurance','equipment','hoodfire','waste','pest','linen','distribution'
]);
const TERRITORY_VALUES=Object.freeze([
  'AllNYC','Manhattan','Brooklyn','Queens','Bronx','StatenIsland',
  'ManhattanBrooklyn','ManhattanQueens','BrooklynQueens','ManhattanBronx',
  'ManhattanBrooklynQueens','BrooklynStatenIsland'
]);
const CSV_HEADERS=Object.freeze([
  'Signal Key','Business','Address','Borough','Stage','Why It Matters',
  'Source Updated','PermitPlate Reviewed','Official Source URLs'
]);

function stableStringify(value){
  if(Array.isArray(value)) return '['+value.map(stableStringify).join(',')+']';
  if(value&&typeof value==='object'){
    return '{'+Object.keys(value).sort()
      .map((key)=>JSON.stringify(key)+':'+stableStringify(value[key])).join(',')+'}';
  }
  return JSON.stringify(value);
}
function sha256(value){
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}
function text(value){ return value==null?'':String(value).trim(); }
function validEmail(value){
  const email=text(value).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)?email:null;
}
function validInstant(value){
  const ms=Date.parse(text(value));
  return Number.isFinite(ms)?new Date(ms).toISOString():null;
}
function officialSourceUrl(value){
  let url;
  try{ url=new URL(text(value)); }
  catch(error){ return false; }
  if(url.protocol!=='https:') return false;
  const host=url.hostname.toLowerCase();
  return host==='data.cityofnewyork.us' ||
    host==='opendata.cityofnewyork.us' ||
    host==='data.ny.gov' ||
    host==='nyc.gov' || host==='www.nyc.gov' || host.endsWith('.nyc.gov');
}
function forbiddenKey(value){
  return /(?:score|rank|probability|purchaseintent|buyingintent|confidence|exclusive)/i
    .test(String(value||'').replace(/[^a-z]/gi,''));
}
function forbiddenClaim(value){
  return /\b(?:guaranteed lead|exclusive lead|purchase intent|buying intent|opening probability|will open|will buy|ready to buy)\b/i
    .test(text(value));
}
function inspectForbidden(value,pathValue='',failures=[]){
  if(Array.isArray(value)){
    value.forEach((item,index)=>inspectForbidden(item,`${pathValue}[${index}]`,failures));
    return failures;
  }
  if(value&&typeof value==='object'){
    for(const [key,item] of Object.entries(value)){
      if(forbiddenKey(key)) failures.push('FORBIDDEN_FIELD:'+`${pathValue}.${key}`.replace(/^\./,''));
      inspectForbidden(item,`${pathValue}.${key}`,failures);
    }
    return failures;
  }
  if(typeof value==='string'&&forbiddenClaim(value)){
    failures.push('FORBIDDEN_CLAIM:'+pathValue.replace(/^\./,''));
  }
  return failures;
}
function validatePreferences(input){
  const data=input||{};
  const failures=[];
  const category=text(data.category);
  const territory=text(data.territory);
  const starter=text(data.starter).toLowerCase();
  if(!CATEGORY_VALUES.includes(category)) failures.push('CATEGORY_INVALID');
  if(!TERRITORY_VALUES.includes(territory)) failures.push('TERRITORY_INVALID');
  if(!['yes','no'].includes(starter)) failures.push('STARTER_PREFERENCE_INVALID');
  return {valid:failures.length===0,failures,category,territory,starter};
}
function escapeCsv(value){
  let output=value==null?'':String(value);
  if(/^[=+\-@]/.test(output)) output="'"+output;
  return /[",\r\n]/.test(output)?'"'+output.replace(/"/g,'""')+'"':output;
}
function toCsv(rows){
  const lines=[CSV_HEADERS.map(escapeCsv).join(',')];
  for(const row of rows) lines.push(CSV_HEADERS.map((header)=>escapeCsv(row[header])).join(','));
  return '\uFEFF'+lines.join('\r\n')+'\r\n';
}
function htmlEscape(value){
  return String(value==null?'':value)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function normalizeSignal(input,index,failures){
  const signal=input||{};
  const prefix=`SIGNAL_${index+1}`;
  const signalKey=text(signal.signalKey);
  const businessName=text(signal.businessName);
  const address=text(signal.address);
  const borough=text(signal.borough);
  const stage=text(signal.stage);
  const whyItMatters=text(signal.whyItMatters);
  const sourceUpdatedAt=validInstant(signal.sourceUpdatedAt);
  const reviewedAt=validInstant(signal.reviewedAt);
  const urls=Array.isArray(signal.sourceUrls)?signal.sourceUrls.map(text).filter(Boolean):[];

  if(!signalKey) failures.push(prefix+'_KEY_MISSING');
  if(!businessName) failures.push(prefix+'_BUSINESS_MISSING');
  if(!address) failures.push(prefix+'_ADDRESS_MISSING');
  if(!borough) failures.push(prefix+'_BOROUGH_MISSING');
  if(!stage) failures.push(prefix+'_STAGE_MISSING');
  if(!whyItMatters) failures.push(prefix+'_WHY_MISSING');
  if(whyItMatters.length>220) failures.push(prefix+'_WHY_TOO_LONG');
  if(!sourceUpdatedAt) failures.push(prefix+'_SOURCE_UPDATED_INVALID');
  if(!reviewedAt) failures.push(prefix+'_REVIEWED_AT_INVALID');
  if(!urls.length) failures.push(prefix+'_SOURCE_URL_MISSING');
  if(urls.some((url)=>!officialSourceUrl(url))) failures.push(prefix+'_SOURCE_URL_NOT_OFFICIAL');

  return {
    signalKey,businessName,address,borough,stage,whyItMatters,
    sourceUpdatedAt,reviewedAt,sourceUrls:Array.from(new Set(urls)).sort()
  };
}
function buildCuratedBrief(input){
  const data=input||{};
  const failures=[];
  const preferences=validatePreferences(data.preferences);
  failures.push(...preferences.failures);
  failures.push(...inspectForbidden(data));

  const subscriptionId=text(data.subscriptionId);
  const recipientEmail=validEmail(data.recipientEmail);
  const preparedAt=validInstant(data.preparedAt);
  const reviewer=text(data.reviewer);
  if(!subscriptionId) failures.push('SUBSCRIPTION_ID_MISSING');
  if(!recipientEmail) failures.push('RECIPIENT_EMAIL_INVALID');
  if(!preparedAt) failures.push('PREPARED_AT_INVALID');
  if(!reviewer) failures.push('REVIEWER_MISSING');
  if(data.ownerReviewed!==true) failures.push('OWNER_REVIEW_REQUIRED');

  const rawSignals=Array.isArray(data.signals)?data.signals:[];
  if(rawSignals.length>MAX_SIGNALS) failures.push('SIGNAL_LIMIT_EXCEEDED');
  const signals=rawSignals.map((signal,index)=>normalizeSignal(signal,index,failures));
  const keys=signals.map((signal)=>signal.signalKey).filter(Boolean);
  if(new Set(keys).size!==keys.length) failures.push('DUPLICATE_SIGNAL_KEY');

  if(failures.length){
    return {
      offerVersion:OFFER_VERSION,launchMode:LAUNCH_MODE,status:'REVIEW',
      failures:Array.from(new Set(failures)).sort(),signalCount:0,
      recipientEmail:recipientEmail||null,preferences,signalKeys:[]
    };
  }

  const rows=signals.map((signal)=>({
    'Signal Key':signal.signalKey,
    'Business':signal.businessName,
    'Address':signal.address,
    'Borough':signal.borough,
    'Stage':signal.stage,
    'Why It Matters':signal.whyItMatters,
    'Source Updated':signal.sourceUpdatedAt,
    'PermitPlate Reviewed':signal.reviewedAt,
    'Official Source URLs':signal.sourceUrls.join(' | ')
  }));
  const csv=toCsv(rows);
  const date=preparedAt.slice(0,10);
  const signalHtml=signals.map((signal,index)=>[
    '<article style="padding:18px 0;border-bottom:1px solid #dedbd3">',
    `<h3 style="margin:0 0 6px">${index+1}. ${htmlEscape(signal.businessName)}</h3>`,
    `<p style="margin:0 0 6px">${htmlEscape(signal.address)} · ${htmlEscape(signal.borough)}</p>`,
    `<p style="margin:0 0 6px"><strong>${htmlEscape(signal.stage)}</strong> — ${htmlEscape(signal.whyItMatters)}</p>`,
    `<p style="margin:0;font-size:13px">${signal.sourceUrls.map((url,i)=>`<a href="${htmlEscape(url)}">official source ${i+1}</a>`).join(' · ')}</p>`,
    '</article>'
  ].join('')).join('');
  const empty=signals.length===0;
  const subject=empty?
    `PermitPlate NYC — no matching updates — ${date}`:
    `PermitPlate NYC — ${signals.length} reviewed ${signals.length===1?'signal':'signals'} — ${date}`;
  const html=[
    '<div style="font-family:Arial,sans-serif;max-width:720px;line-height:1.5;color:#211d1b">',
    '<h2 style="margin-bottom:6px">PermitPlate NYC</h2>',
    empty?'<p>No matching changes passed review this week.</p>':
      `<p>${signals.length} founder-reviewed ${signals.length===1?'signal':'signals'} for your selected category and territory.</p>`,
    signalHtml,
    '<p style="margin-top:18px;font-size:13px">Research starting points, not purchase intent or guaranteed leads. Verify the official record before outreach.</p>',
    '</div>'
  ].join('');
  const core={
    offerVersion:OFFER_VERSION,launchMode:LAUNCH_MODE,subscriptionId,
    recipientEmail,preparedAt,reviewer,preferences,
    signals,subject,csv,html
  };
  const artifactFingerprint=sha256(stableStringify(core));
  return {
    ...core,status:empty?'NO_MATCHES':'READY',failures:[],
    signalCount:signals.length,signalKeys:keys,
    filename:`permitplate-nyc-${date}.csv`,artifactFingerprint,
    messageFingerprint:sha256(stableStringify({subject,html,artifactFingerprint,signalKeys:keys}))
  };
}

module.exports={
  OFFER_VERSION,LAUNCH_MODE,MAX_SIGNALS,CATEGORY_VALUES,TERRITORY_VALUES,CSV_HEADERS,
  stableStringify,sha256,text,validEmail,validInstant,officialSourceUrl,
  forbiddenKey,forbiddenClaim,inspectForbidden,validatePreferences,
  escapeCsv,toCsv,htmlEscape,normalizeSignal,buildCuratedBrief
};
