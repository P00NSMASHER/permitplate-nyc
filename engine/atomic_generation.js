'use strict';

const TWO_HOURS_MS=2*60*60*1000;

function iso(value,name='time'){
  const d=new Date(value);
  if(!Number.isFinite(d.getTime())) throw new Error(`Invalid ${name}`);
  return d.toISOString();
}
function t(value){ return new Date(iso(value)).getTime(); }

function beginGeneration({generationId,startedAt,expectedVenueRows,expectedLeadRows,sourceHealth}){
  if(!generationId) throw new Error('generationId required');
  for(const [name,v] of [['expectedVenueRows',expectedVenueRows],['expectedLeadRows',expectedLeadRows]]){
    if(!Number.isInteger(v)||v<0) throw new Error(`${name} must be nonnegative integer`);
  }
  return {
    'Generation ID':String(generationId),
    'Status':'STARTED',
    'Started At':iso(startedAt,'startedAt'),
    'Completed At':'',
    'Expected Venue Rows':expectedVenueRows,
    'Staging Venue Rows':'',
    'Expected Lead Rows':expectedLeadRows,
    'Staging Lead Rows':'',
    'Validation Status':'PENDING',
    'Commit Status':'NOT_ATTEMPTED',
    'Source Health':String(sourceHealth||''),
    'Notes':'',
    _readbackVerified:false,
  };
}

function failStaleGenerations(records,now){
  const nowMs=t(now);
  return (records||[]).map(r=>{
    if(!['STARTED','STAGED'].includes(String(r.Status))) return r;
    if(nowMs-t(r['Started At'])<=TWO_HOURS_MS) return r;
    return {
      ...r,Status:'FAILED','Completed At':iso(now),
      'Commit Status':r['Commit Status']==='PASS'?'COMMIT_VERIFY_FAIL':'NOT_ATTEMPTED - STALE',
      Notes:[r.Notes,'Prior STARTED/STAGED generation exceeded 2-hour limit; failed closed.'].filter(Boolean).join(' '),
      _readbackVerified:false,
    };
  });
}

function stageGeneration(record,{venueRows,leadRows}){
  if(record.Status!=='STARTED') throw new Error('only STARTED generation can stage');
  return {
    ...record,Status:'STAGED',
    'Staging Venue Rows':venueRows.length,
    'Staging Lead Rows':leadRows.length,
    'Validation Status':'PENDING',
    'Commit Status':'NOT_ATTEMPTED',
    _readbackVerified:false,
  };
}

function applyValidation(record,validation,completedAt){
  if(record.Status!=='STAGED') throw new Error('only STAGED generation can validate');
  if(validation.pass!==true){
    return {
      ...record,Status:'FAILED','Completed At':iso(completedAt),
      'Validation Status':'FAIL','Commit Status':'NOT_ATTEMPTED',
      Notes:[record.Notes,`Validation failed: ${(validation.errors||[]).join(' | ')}`].filter(Boolean).join(' '),
      _readbackVerified:false,
    };
  }
  return {...record,'Validation Status':'PASS',Notes:record.Notes||'',_readbackVerified:false};
}

function promotionPlan(record,{venueRows,leadRows}){
  if(record.Status!=='STAGED'||record['Validation Status']!=='PASS') throw new Error('promotion requires STAGED + validation PASS');
  if(venueRows.length!==record['Expected Venue Rows']||leadRows.length!==record['Expected Lead Rows']) throw new Error('promotion row count differs from expected generation counts');
  return {
    generationId:record['Generation ID'],
    atomic:true,
    operations:[
      {target:'Venue Graph',source:'Venue Graph Staging',rows:venueRows},
      {target:'Leads',source:'Leads Staging',rows:leadRows},
      {target:'Run Control',update:{
        Status:'COMMITTED',
        'Validation Status':'PASS',
        'Commit Status':'PASS',
        'Expected Venue Rows':venueRows.length,
        'Staging Venue Rows':venueRows.length,
        'Expected Lead Rows':leadRows.length,
        'Staging Lead Rows':leadRows.length,
      }},
    ],
  };
}

function markCommitted(record,completedAt){
  if(record.Status!=='STAGED'||record['Validation Status']!=='PASS') throw new Error('commit requires staged validation pass');
  return {
    ...record,Status:'COMMITTED','Completed At':iso(completedAt),
    'Commit Status':'PASS',_readbackVerified:false,
  };
}

function keys(rows,keyName){
  return (rows||[]).map(r=>String(r[keyName]??'')).sort();
}
function canonicalRow(row,headers){
  return headers.map(h=>row[h]===undefined?null:row[h]);
}
function exactRowsEqual(a,b,headers,keyName){
  if(a.length!==b.length) return false;
  const sort=(rows)=>[...rows].sort((x,y)=>String(x[keyName]).localeCompare(String(y[keyName])));
  const aa=sort(a),bb=sort(b);
  return aa.every((row,i)=>JSON.stringify(canonicalRow(row,headers))===JSON.stringify(canonicalRow(bb[i],headers)));
}

function verifyReadback(record,{
  stagedVenues,liveVenues,stagedLeads,liveLeads,
  venueHeaders,leadHeaders,
}){
  if(record.Status!=='COMMITTED'||record['Commit Status']!=='PASS') throw new Error('readback requires committed generation');
  const failures=[];
  if(stagedVenues.length!==liveVenues.length) failures.push(`VENUE_COUNT:${stagedVenues.length}!=${liveVenues.length}`);
  if(stagedLeads.length!==liveLeads.length) failures.push(`LEAD_COUNT:${stagedLeads.length}!=${liveLeads.length}`);
  if(JSON.stringify(keys(stagedVenues,'Venue Key'))!==JSON.stringify(keys(liveVenues,'Venue Key'))) failures.push('VENUE_KEY_SET');
  if(JSON.stringify(keys(stagedLeads,'Lead Key'))!==JSON.stringify(keys(liveLeads,'Lead Key'))) failures.push('LEAD_KEY_SET');
  if(venueHeaders&&!exactRowsEqual(stagedVenues,liveVenues,venueHeaders,'Venue Key')) failures.push('VENUE_VALUE_MISMATCH');
  if(leadHeaders&&!exactRowsEqual(stagedLeads,liveLeads,leadHeaders,'Lead Key')) failures.push('LEAD_VALUE_MISMATCH');

  if(failures.length){
    return {
      ...record,Status:'COMMIT_VERIFY_FAIL','Commit Status':'COMMIT_VERIFY_FAIL',
      Notes:[record.Notes,`Post-commit readback mismatch: ${failures.join(', ')}`].filter(Boolean).join(' '),
      _readbackVerified:false,
    };
  }
  return {...record,_readbackVerified:true};
}

function deliveryAllowed(record){
  return Boolean(
    record &&
    record.Status==='COMMITTED' &&
    record['Validation Status']==='PASS' &&
    record['Commit Status']==='PASS' &&
    record._readbackVerified===true
  );
}

module.exports={
  TWO_HOURS_MS,beginGeneration,failStaleGenerations,stageGeneration,applyValidation,
  promotionPlan,markCommitted,verifyReadback,deliveryAllowed
};
