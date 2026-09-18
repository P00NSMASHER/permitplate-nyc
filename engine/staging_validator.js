'use strict';

const VENUE_HEADERS=[
  'Venue Key','Best Name','Legal Name','Address','Borough','ZIP','Phone','Cuisine/Type',
  'Commercial Fit','Commercial Fit Reason','Stage','Stage Number','First Signal Date',
  'Latest Signal Date','Source Count','Sources','DOHMH CAMIS','SLA Application ID',
  'DOB Job Filing','Buildout Cost','Work Types','POS Score','Insurance Score','Equipment Score',
  'Hood/Fire Score','Waste Score','Pest Score','Linen Score','Distribution Score','Best Vendor Fit',
  'Best Score','Why Now','Purchase Window','Evidence Summary','Last Updated','Intelligence Status',
  'Watch Next','Confidence'
];

const LEAD_HEADERS=[
  'Observed At','Source Date','CAMIS','Business','Borough','Address','Public Business Phone',
  'Cuisine','Opening Stage','Priority Score','Likely Vendor Fits','Inspection Type','Public Action',
  'Source','Lead Key','Delivered At','Commercial Fit','Stage','Source Count','Sources',
  'Best Vendor Fit','Best Score','Why Now','Purchase Window','Evidence Summary','Venue Key',
  'Watch Next','Confidence'
];

const SOURCE_EVENT_HEADERS=[
  'Event ID','Venue Key','Source','Source Record ID','Event Date','Event Type','Stage Evidence',
  'DBA','Legal Name','Address','Borough','ZIP','Phone','Cuisine/License Description','Initial Cost',
  'Job Description','Work Types','Source URL','First Seen','Last Seen','Observed At'
];

const RUN_CONTROL_HEADERS=[
  'Generation ID','Status','Started At','Completed At','Expected Venue Rows','Staging Venue Rows',
  'Expected Lead Rows','Staging Lead Rows','Validation Status','Commit Status','Source Health','Notes'
];

const STAGES=new Map([
  [1,'JUST FILED'],
  [2,'BUILDOUT / LICENSING'],
  [3,'HEALTH PRE-PERMIT'],
  [4,'MULTI-SOURCE NEAR-OPENING'],
]);

const SCORE_FIELDS=[
  'POS Score','Insurance Score','Equipment Score','Hood/Fire Score',
  'Waste Score','Pest Score','Linen Score','Distribution Score'
];

const BEST_NAMES=['POS','POS/payments','Insurance','Equipment','Hood/Fire','Waste','Pest','Linen','Distribution'];
const FITS=new Set(['HIGH','MEDIUM','LOW','EXCLUDE']);
const WINDOWS=new Set(['EARLY','ACTIVE BUILDOUT','PRE-OPENING','NEAR OPENING','SUPPRESSED']);
const CONFIDENCE=new Set(['HIGH','MEDIUM','LOW']);
const SOURCES=['DOHMH','SLA','DOB'];
const ID_FIELD={DOHMH:'DOHMH CAMIS',SLA:'SLA Application ID',DOB:'DOB Job Filing'};

function blank(v){ return v===null||v===undefined||String(v).trim()===''; }
function normalized(v){ return String(v??'').trim().toUpperCase(); }

function splitSources(v){
  return [...new Set(String(v??'').split(/[;,/+]/).map(normalized).filter(Boolean))];
}

function validIsoDate(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y,m,d]=value.split('-').map(Number);
  const dt=new Date(Date.UTC(y,m-1,d));
  return dt.getUTCFullYear()===y&&dt.getUTCMonth()===m-1&&dt.getUTCDate()===d;
}

function exactHeaders(actual,expected,label){
  if(!Array.isArray(actual)||actual.length!==expected.length) return [`${label}:HEADER_WIDTH`];
  const errs=[];
  expected.forEach((h,i)=>{ if(actual[i]!==h) errs.push(`${label}:HEADER:${i+1}:${actual[i]}!=${h}`); });
  return errs;
}

function sourceEventIndex(events){
  const byVenue=new Map();
  const ids=new Set();
  for(const event of events){
    const eventId=String(event['Event ID']||'');
    if(!eventId||ids.has(eventId)) throw new Error(`duplicate/nonblank Event ID invariant: ${eventId}`);
    ids.add(eventId);
    const key=String(event['Venue Key']||'');
    if(!byVenue.has(key)) byVenue.set(key,[]);
    byVenue.get(key).push(event);
  }
  return byVenue;
}

function hasCurrentPrePermit(events,camis){
  return events.some(e=>
    normalized(e.Source)==='DOHMH' &&
    String(e['Source Record ID']||'')===String(camis||'') &&
    /^PRE-PERMIT/i.test(String(e['Event Type']||'').trim())
  );
}

function positiveSpecialistEvidence(row,events,kind){
  const concept=normalized(row['Cuisine/Type']);
  const hotFood=/(PIZZA|PIZZERIA|BAKERY|GRILL|BBQ|BARBECUE|CHICKEN|HOT[ -]?FOOD|COMMERCIAL KITCHEN)/.test(concept);
  if(hotFood) return true;

  for(const e of events){
    if(normalized(e.Source)!=='DOB') continue;
    if(/BUILDING-LEVEL UNMATCHED/i.test(String(e['Stage Evidence']||''))) continue;
    const text=normalized(`${e['Job Description']||''} ${e['Work Types']||''}`);
    if(kind==='Equipment' && /(INTERIOR|BUILDOUT|KITCHEN|EQUIPMENT|PLUMBING|MECHANICAL|COMMERCIAL KITCHEN|TAKE[ -]?OUT)/.test(text)) return true;
    if(kind==='HoodFire' && /(HOOD|FIRE SUPPRESSION|KITCHEN|MECHANICAL|PLUMBING|COMMERCIAL KITCHEN|PLACE OF ASSEMBLY)/.test(text)) return true;
  }
  return false;
}

function validateGeneration({
  venueHeaders=VENUE_HEADERS,
  leadHeaders=LEAD_HEADERS,
  sourceEventHeaders=SOURCE_EVENT_HEADERS,
  runControlHeaders=RUN_CONTROL_HEADERS,
  venues=[],
  leads=[],
  sourceEvents=[],
  laterStageMilestoneVenueKeys=[],
}){
  const errors=[
    ...exactHeaders(venueHeaders,VENUE_HEADERS,'VENUE'),
    ...exactHeaders(leadHeaders,LEAD_HEADERS,'LEADS'),
    ...exactHeaders(sourceEventHeaders,SOURCE_EVENT_HEADERS,'SOURCE_EVENTS'),
    ...exactHeaders(runControlHeaders,RUN_CONTROL_HEADERS,'RUN_CONTROL'),
  ];
  const warnings=[];

  let eventsByVenue;
  try{ eventsByVenue=sourceEventIndex(sourceEvents); }
  catch(err){ errors.push(`SOURCE_EVENTS:${err.message}`); eventsByVenue=new Map(); }

  const venueKeys=new Set();
  const leadKeys=new Set();
  const leadsByVenue=new Map();
  for(const lead of leads){
    const lk=String(lead['Lead Key']||'').trim();
    const vk=String(lead['Venue Key']||'').trim();
    if(!lk) errors.push('LEADS:BLANK_LEAD_KEY');
    else if(leadKeys.has(lk)) errors.push(`LEADS:DUPLICATE_LEAD_KEY:${lk}`);
    else leadKeys.add(lk);
    if(!vk) errors.push(`LEADS:BLANK_VENUE_KEY:${lk}`);
    if(!leadsByVenue.has(vk)) leadsByVenue.set(vk,[]);
    leadsByVenue.get(vk).push(lead);
    if(['LOW','EXCLUDE'].includes(normalized(lead['Commercial Fit'])) && !blank(lead['Delivered At'])){
      errors.push(`LEADS:SUPPRESSED_DELIVERED:${lk}`);
    }
  }

  const laterStage=new Set(laterStageMilestoneVenueKeys.map(String));
  const eligibleScores=[];

  for(const row of venues){
    const key=String(row['Venue Key']||'').trim();
    if(!key) { errors.push('VENUE:BLANK_KEY'); continue; }
    if(venueKeys.has(key)) errors.push(`VENUE:DUPLICATE_KEY:${key}`);
    venueKeys.add(key);

    const fit=normalized(row['Commercial Fit']);
    if(!FITS.has(fit)) errors.push(`VENUE:${key}:INVALID_FIT:${fit}`);

    const stageNo=Number(row['Stage Number']);
    if(!STAGES.has(stageNo) || normalized(row.Stage)!==STAGES.get(stageNo)){
      errors.push(`VENUE:${key}:STAGE_MISMATCH:${row.Stage}:${row['Stage Number']}`);
    }

    for(const dateField of ['First Signal Date','Latest Signal Date']){
      if(!validIsoDate(row[dateField])) errors.push(`VENUE:${key}:NON_ISO_DATE:${dateField}:${row[dateField]}`);
    }

    const sources=splitSources(row.Sources);
    const sourceCount=Number(row['Source Count']);
    if(!Number.isInteger(sourceCount)||sourceCount!==sources.length){
      errors.push(`VENUE:${key}:SOURCE_COUNT_MISMATCH:${sourceCount}!=${sources.length}`);
    }

    const events=eventsByVenue.get(key)||[];
    for(const source of SOURCES){
      const idField=ID_FIELD[source];
      const id=row[idField];
      const listed=sources.includes(source);
      if(!listed && !blank(id)) errors.push(`VENUE:${key}:UNLISTED_SOURCE_HAS_ID:${source}`);
      if(listed && blank(id)) errors.push(`VENUE:${key}:LISTED_SOURCE_MISSING_ID:${source}`);
      if(listed && !blank(id)){
        const match=events.some(e=>normalized(e.Source)===source && String(e['Source Record ID']||'')===String(id));
        if(!match) errors.push(`VENUE:${key}:NATIVE_ID_WITHOUT_SOURCE_EVENT:${source}:${id}`);
      }
    }

    const badAttached=events.some(e=>/BUILDING-LEVEL UNMATCHED/i.test(String(e['Stage Evidence']||'')));
    if(badAttached) errors.push(`VENUE:${key}:BUILDING_LEVEL_UNMATCHED_ATTACHED`);

    if(stageNo===3 && !hasCurrentPrePermit(events,row['DOHMH CAMIS'])){
      errors.push(`VENUE:${key}:STAGE3_WITHOUT_CAMIS_PREPERMIT`);
    }
    if(stageNo===4){
      if(sourceCount<2) errors.push(`VENUE:${key}:STAGE4_REQUIRES_TWO_SOURCES`);
      const validLate=hasCurrentPrePermit(events,row['DOHMH CAMIS'])||laterStage.has(key);
      if(!validLate) errors.push(`VENUE:${key}:STAGE4_WITHOUT_LATE_STAGE_EVIDENCE`);
    }

    const scores={};
    for(const field of SCORE_FIELDS){
      const v=row[field];
      if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>100){
        errors.push(`VENUE:${key}:INVALID_LITERAL_SCORE:${field}:${v}`);
      }else scores[field]=v;
    }
    if(Object.keys(scores).length===SCORE_FIELDS.length){
      const max=Math.max(...Object.values(scores));
      if(typeof row['Best Score']!=='number'||row['Best Score']!==max){
        errors.push(`VENUE:${key}:BEST_SCORE_MISMATCH:${row['Best Score']}!=${max}`);
      }
      const best=String(row['Best Vendor Fit']||'');
      if(fit==='EXCLUDE' && max===0){
        if(best!=='SUPPRESSED' && !BEST_NAMES.includes(best)) errors.push(`VENUE:${key}:INVALID_SUPPRESSED_BEST_VENDOR:${best}`);
      }else{
        const map={POS:'POS Score','POS/payments':'POS Score',Insurance:'Insurance Score',Equipment:'Equipment Score','Hood/Fire':'Hood/Fire Score',Waste:'Waste Score',Pest:'Pest Score',Linen:'Linen Score',Distribution:'Distribution Score'};
        if(!map[best]||scores[map[best]]!==max) errors.push(`VENUE:${key}:BEST_VENDOR_NOT_MAX:${best}`);
      }

      const generic=Math.max(scores['POS Score'],scores['Insurance Score']);
      if(scores['Equipment Score']>generic && !positiveSpecialistEvidence(row,events,'Equipment')){
        errors.push(`VENUE:${key}:EQUIPMENT_OVER_CEILING_WITHOUT_DIRECT_EVIDENCE`);
      }
      if(scores['Hood/Fire Score']>generic && !positiveSpecialistEvidence(row,events,'HoodFire')){
        errors.push(`VENUE:${key}:HOOD_OVER_CEILING_WITHOUT_DIRECT_EVIDENCE`);
      }

      if(['HIGH','MEDIUM'].includes(fit)) eligibleScores.push(max);
    }

    if(!WINDOWS.has(normalized(row['Purchase Window']))) errors.push(`VENUE:${key}:INVALID_PURCHASE_WINDOW`);
    if(!CONFIDENCE.has(normalized(row.Confidence))) errors.push(`VENUE:${key}:INVALID_CONFIDENCE`);
    if(blank(row['Watch Next'])) errors.push(`VENUE:${key}:MISSING_WATCH_NEXT`);
    if(blank(row['Why Now'])) errors.push(`VENUE:${key}:MISSING_WHY_NOW`);
    if(blank(row['Evidence Summary'])) errors.push(`VENUE:${key}:MISSING_EVIDENCE_SUMMARY`);
    if(blank(row['Intelligence Status'])) errors.push(`VENUE:${key}:MISSING_INTELLIGENCE_STATUS`);

    if(['HIGH','MEDIUM'].includes(fit) && !(leadsByVenue.get(key)||[]).length){
      errors.push(`VENUE:${key}:DELIVERABLE_WITHOUT_DURABLE_LEAD`);
    }
  }

  for(const lead of leads){
    const vk=String(lead['Venue Key']||'').trim();
    if(vk && !venueKeys.has(vk)) errors.push(`LEADS:ORPHAN_VENUE:${lead['Lead Key']}:${vk}`);
  }

  if(eligibleScores.length){
    const counts=new Map();
    eligibleScores.forEach(v=>counts.set(v,(counts.get(v)||0)+1));
    const [mode,count]=[...counts.entries()].sort((a,b)=>b[1]-a[1])[0];
    if(count/eligibleScores.length>0.80){
      warnings.push(`SCORE_CONCENTRATION:${mode}:${count}/${eligibleScores.length}`);
    }
  }

  return {pass:errors.length===0,errors,warnings,metrics:{
    venueRows:venues.length,leadRows:leads.length,sourceEventRows:sourceEvents.length,
    eligibleRows:eligibleScores.length,
  }};
}

module.exports={
  VENUE_HEADERS,LEAD_HEADERS,SOURCE_EVENT_HEADERS,RUN_CONTROL_HEADERS,
  validateGeneration,validIsoDate,splitSources
};
