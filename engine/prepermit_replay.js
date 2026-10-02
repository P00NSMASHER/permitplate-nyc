'use strict';

const crypto=require('node:crypto');

function dateOnly(value){
  const s=String(value??'').slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d=new Date(s+'T00:00:00Z');
  return Number.isFinite(d.getTime())?s:null;
}

function prePermitRow(row){
  return /^Pre-permit/i.test(String(row.inspection_type||'').trim());
}

function stableSuffix(row){
  return crypto.createHash('sha256')
    .update(`${String(row.inspection_type||'')}\n${String(row.action||'')}`)
    .digest('hex').slice(0,10).toUpperCase();
}

function eventId(row){
  const camis=String(row.camis??'').trim();
  const date=dateOnly(row.inspection_date);
  if(!camis||!date||!prePermitRow(row)) return null;
  return `DOHMH:${camis}:${date}:PREPERMIT:${stableSuffix(row)}`;
}

function buildSourceEvent(row,venue,observedAt){
  const id=eventId(row);
  if(!id) return null;
  return {
    'Event ID':id,
    'Venue Key':String(venue['Venue Key']||venue.venueKey||''),
    'Source':'DOHMH',
    'Source Record ID':String(row.camis),
    'Event Date':dateOnly(row.inspection_date),
    'Event Type':String(row.inspection_type||''),
    'Stage Evidence':`Actual CAMIS-matched DOHMH ${String(row.inspection_type||'Pre-permit')}; action=${String(row.action||'')}`,
    'DBA':row.dba??venue['Best Name']??'',
    'Legal Name':'',
    'Address':row.address??venue.Address??'',
    'Borough':row.boro??venue.Borough??'',
    'ZIP':row.zipcode??venue.ZIP??'',
    'Phone':row.phone??venue.Phone??'',
    'Cuisine/License Description':row.cuisine_description??venue['Cuisine/Type']??'',
    'Initial Cost':'',
    'Job Description':'',
    'Work Types':'',
    'Source URL':'https://data.cityofnewyork.us/Health/DOHMH-New-York-City-Restaurant-Inspection-Results/43nn-pn8j/about_data',
    'First Seen':observedAt,
    'Last Seen':observedAt,
    'Observed At':observedAt,
  };
}

function replayPrePermits({venues,historicalRowsByCamis,existingEventIds=[],observedAt}){
  const existing=new Set(existingEventIds.map(String));
  const events=[];
  const venueHits=new Set();
  let malformedRecords=0;
  let totalPrePermitRows=0;

  for(const venue of venues||[]){
    const camis=String(venue['DOHMH CAMIS']??venue.camis??'').trim();
    if(!camis) continue;
    const rows=historicalRowsByCamis?.[camis]||[];
    let hit=false;
    for(const row of rows){
      if(!prePermitRow(row)) continue;
      totalPrePermitRows+=1;
      const id=eventId(row);
      if(!id){
        malformedRecords+=1;
        continue;
      }
      const e=buildSourceEvent(row,venue,observedAt);
      if(!e){
        malformedRecords+=1;
        continue;
      }
      hit=true;
      events.push({...e,_recovered:!existing.has(id)});
    }
    if(hit) venueHits.add(camis);
  }

  const byId=new Map();
  for(const e of events){
    if(!byId.has(e['Event ID'])) byId.set(e['Event ID'],e);
  }
  const deduped=[...byId.values()];

  return {
    events:deduped,
    metrics:{
      camisChecked:(venues||[]).filter(v=>String(v['DOHMH CAMIS']??v.camis??'').trim()).length,
      venuesWithHits:venueHits.size,
      prePermitRowsObserved:totalPrePermitRows,
      recoveredEvents:deduped.filter(e=>e._recovered).length,
      alreadyPresentEvents:deduped.filter(e=>!e._recovered).length,
      malformedRecords,
      duplicateRowsCollapsed:events.length-deduped.length,
    }
  };
}

function validateLifecycleStages({venues,sourceEvents,laterStageMilestoneVenueKeys=[]}){
  const later=new Set(laterStageMilestoneVenueKeys.map(String));
  const errors=[];
  for(const v of venues||[]){
    const stage=Number(v['Stage Number']??v.stageNumber);
    if(stage!==3&&stage!==4) continue;
    const key=String(v['Venue Key']??v.venueKey??'');
    const camis=String(v['DOHMH CAMIS']??v.camis??'');
    const hasPre=(sourceEvents||[]).some(e=>
      String(e['Venue Key']||'')===key &&
      String(e.Source||'').toUpperCase()==='DOHMH' &&
      String(e['Source Record ID']||'')===camis &&
      /^Pre-permit/i.test(String(e['Event Type']||'').trim())
    );
    if(stage===3&&!hasPre) errors.push(`${key}:STAGE3_WITHOUT_CAMIS_PREPERMIT`);
    if(stage===4&&!hasPre&&!later.has(key)) errors.push(`${key}:STAGE4_WITHOUT_PREPERMIT_OR_VALIDATED_MILESTONE`);
  }
  return {pass:errors.length===0,errors};
}

module.exports={eventId,buildSourceEvent,replayPrePermits,validateLifecycleStages};
