/* PermitPlate 4.0: buyer-marked source triage only. No network calls or storage. */
(function(root){
 'use strict';
 const SOURCE_KINDS=Object.freeze({inspection:'Inspection or health record',permit:'Building or permit record',agency:'Public agency notice',other:'Other public record'});
 const EVENT_STATES=Object.freeze({unchecked:'Not independently checked',listing:'Current listing or refreshed data extract only',dated_change:'Buyer located a dated project-relevant event (unverified)',conflict:'Conflicting dates or events'});
 const CORROBORATION=Object.freeze({none:'Not found or not checked',independent:'Buyer located a second independent public source (unverified)',conflict:'Conflicting public sources'});
 const FIT=Object.freeze({unknown:'Category relevance not assessed',possible:'Buyer-described possible relevance (unverified)',not_shown:'Category-specific need not shown'});
 const CATEGORIES=Object.freeze({pos:'POS and payments',insurance:'Insurance',equipment:'Kitchen equipment',hoodfire:'Hood and fire',waste:'Waste',pest:'Pest control',linen:'Linen',distribution:'Food distribution'});
 const TERRITORIES=Object.freeze({AllNYC:'All NYC',Manhattan:'Manhattan',Brooklyn:'Brooklyn',Queens:'Queens',Bronx:'Bronx',StatenIsland:'Staten Island',
 ManhattanBrooklyn:'Manhattan and Brooklyn',ManhattanQueens:'Manhattan and Queens',BrooklynQueens:'Brooklyn and Queens',ManhattanBronx:'Manhattan and Bronx',
 ManhattanBrooklynQueens:'Manhattan, Brooklyn and Queens',BrooklynStatenIsland:'Brooklyn and Staten Island'});
 const exact=(table,key)=>Object.prototype.hasOwnProperty.call(table,key);
 function publicRecordUrl(raw){
   const input=String(raw||'').trim();
   if(!input)return '';
   if(input.length>2048||/[\u0000-\u001f\u007f]/.test(input))throw Error('Use a clean public NYC government URL, without private information.');
   let parsed;try{parsed=new URL(input);}catch{throw Error('Use a complete HTTPS NYC government URL.');}
   const host=parsed.hostname.toLowerCase().replace(/\.$/,'');
   if(parsed.protocol!=='https:'||parsed.username||parsed.password||
     (parsed.port&&parsed.port!=='443')||parsed.search||parsed.hash||
     !(host==='nyc.gov'||host.endsWith('.nyc.gov')||host==='data.cityofnewyork.us'))
      throw Error('Use an official NYC government or NYC Open Data HTTPS link without tracking parameters.');
   return parsed.href;
 }
 function triage(input){
   const kind=input?.kind??'inspection',event=input?.event??'unchecked';
   const corroboration=input?.corroboration??'none',fit=input?.fit??'unknown';
   const category=input?.category??'',territory=input?.territory??'';
   if(!exact(SOURCE_KINDS,kind)||!exact(EVENT_STATES,event)||!exact(CORROBORATION,corroboration)||!exact(FIT,fit))
     throw Error('Unsupported evidence state');
   const url=publicRecordUrl(input?.url||'');
   const scopeSelected=exact(CATEGORIES,category)&&exact(TERRITORIES,territory);
   let outcome,explanation;
   if(!scopeSelected){
     outcome='SCOPE NOT SELECTED';
     explanation='Select a supported vendor category and NYC territory in the trial form. Nothing is verified here.';
   }else if(event==='conflict'||corroboration==='conflict'){
     outcome='HOLD — CONFLICTING PUBLIC RECORDS';
     explanation='Conflicting dates or sources require manual reconciliation before relying on an event or starting outreach.';
   }else if(event==='unchecked'||event==='listing'){
     outcome='LISTING ALONE IS NOT A NEW PROJECT';
     explanation='A recent data extract or existing inspection listing does not establish a newly filed application, opening, or buying intent.';
   }else if(corroboration==='none'){
     outcome='AWAIT INDEPENDENT CORROBORATION';
     explanation='Even a buyer-marked dated event needs independent source corroboration and project context.';
   }else if(fit!=='possible'){
     outcome='VENDOR NEED NOT ESTABLISHED';
     explanation='Multiple buyer-marked source references do not show a need for this vendor category.';
   }else{
     outcome='RESEARCH CANDIDATE — NOT A VERIFIED LEAD';
     explanation='A buyer marked a dated event, independent public source and possible fit. None has been verified by PermitPlate.';
   }
   const report=[
     'PermitPlate 4.0 | BUYER-MARKED, UNVERIFIED SIGNAL CHECKLIST',
     'Vendor category: '+(scopeSelected?CATEGORIES[category]:'Not selected'),
     'NYC territory: '+(scopeSelected?TERRITORIES[territory]:'Not selected'),
     'Public record: '+(url||'Not provided'),
     'Source type: '+SOURCE_KINDS[kind],
     'Dated event: '+EVENT_STATES[event],
     'Independent corroboration: '+CORROBORATION[corroboration],
     'Category fit: '+FIT[fit],
     'Outcome: '+outcome,'',explanation,'',
     'NO SOURCE WAS FETCHED OR VERIFIED. Public records do not prove a new opening,',
     'confirmed lead, buyer demand, payment authority, enrollment or permission for outreach.',
     'Independent human review and original source context are mandatory.'
   ].join('\n');
   return Object.freeze({kind,event,corroboration,fit,category,territory,url,scopeSelected,outcome,explanation,report});
 }
 if(typeof module==='object'&&module.exports)module.exports={triage,publicRecordUrl,SOURCE_KINDS,EVENT_STATES,CORROBORATION,FIT,CATEGORIES,TERRITORIES};
 if(!root.document)return;
 const section=root.document.querySelector('[data-v4-signal]');
 if(!section)return;
 const get=id=>root.document.querySelector(id);
 const fields={kind:get('[data-v4-kind]'),event:get('[data-v4-event]'),corroboration:get('[data-v4-corroboration]'),fit:get('[data-v4-fit]'),
   url:get('[data-v4-url]'),category:get('#trial-category'),territory:get('#trial-territory')};
 const title=get('[data-v4-outcome]'),detail=get('[data-v4-explanation]'),copy=get('[data-v4-copy]'),
   reset=get('[data-v4-reset]'),status=get('[data-v4-copy-status]'),fallback=get('[data-v4-fallback]'),text=get('#v4-plain');
 if(Object.values(fields).some(x=>!x)||![title,detail,copy,reset,status,fallback,text].every(Boolean))return;
 let revision=0,result=null;
 function update(){
   revision++;status.textContent='';fallback.hidden=true;text.value='';
   try{
     result=triage(Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,v.value])));
     title.textContent=result.outcome;detail.textContent=result.explanation;
     copy.disabled=!result.scopeSelected;
   }catch(error){
     result=null;title.textContent='INVALID PUBLIC LINK';detail.textContent=error.message;copy.disabled=true;
   }
 }
 for(const field of Object.values(fields))field.addEventListener(field.tagName==='SELECT'?'change':'input',update);
 copy.addEventListener('click',async()=>{
   if(!result)return;
   const before=revision,report=result.report;
   try{
     if(!root.navigator?.clipboard?.writeText)throw Error('CLIPBOARD_UNAVAILABLE');
     await root.navigator.clipboard.writeText(report);
     status.textContent=revision===before?'Checklist copied. Nothing was sent or saved.':'Scope changed while copying. Review and copy again.';
   }catch{
     if(revision!==before){status.textContent='The selection changed while copying. Copy again.';return;}
     fallback.hidden=false;text.value=report;text.focus();text.select();
     status.textContent='Clipboard unavailable. Select and copy the complete checklist below. Nothing was sent.';
   }
 });
 reset.addEventListener('click',()=>{
   fields.url.value='';fields.kind.value='inspection';fields.event.value='unchecked';
   fields.corroboration.value='none';fields.fit.value='unknown';update();
 });
 section.hidden=false;update();
})(typeof window==='undefined'?globalThis:window);
