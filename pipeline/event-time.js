'use strict';

const {createHash}=require('node:crypto');
const VERSION='PermitPlate-event-time-v1.0.0';
const RECENCY_POLICY='SOURCE_EVENT_CALENDAR_DAYS_UNKNOWN_ZERO_V1';
const DAY_MS=86400000;
const text=v=>typeof v==='string'?v.trim():'';
function stable(v){
  if(Array.isArray(v)) return '['+v.map(stable).join(',')+']';
  if(v&&typeof v==='object') return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';
  return JSON.stringify(v);
}
const fingerprint=v=>createHash('sha256').update(stable(v)).digest('hex');
function calendarDate(value){
  const v=text(value);
  const m=/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?)?$/.exec(v);
  if(!m) return null;
  const [y,mo,d]=m.slice(1,4).map(Number);
  if(y<1900||mo<1||mo>12||d<1||d>new Date(Date.UTC(y,mo,0)).getUTCDate()) return null;
  if(m[4]!==undefined&&(Number(m[4])>23||Number(m[5])>59||Number(m[6])>59)) return null;
  if(m[7]&&m[7]!=='Z'){
    const [h,minute]=m[7].slice(1).split(':').map(Number);
    if(h>14||minute>59||(h===14&&minute!==0)) return null;
  }
  // These publisher fields are calendar dates. Do not fabricate a UTC instant.
  return v.slice(0,10);
}
function instant(value){
  const v=text(value);
  if(!calendarDate(v)||!/[T].*(?:Z|[+-]\d{2}:\d{2})$/.test(v)) return null;
  const n=Date.parse(v);
  return Number.isFinite(n)?new Date(n).toISOString():null;
}
function nycDate(value){
  const parsed=instant(value);
  if(!parsed) return null;
  return new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(parsed));
}
function recencyPoints(age){
  if(age===null) return 0; // Unknown is not today and is not a fabricated old date.
  if(!Number.isInteger(age)||age<0) return null;
  return age<=3?15:age<=7?10:age<=30?5:0;
}
function customerStage(stage){
  return text(stage).toUpperCase()==='JUST FILED'?'APPLICANT — NOT YET INSPECTED':text(stage);
}
function acceptedSources(candidate,recordsById){
  const c=candidate||{}, primary=c.primaryRecord;
  const failures=[],out=[];
  if(!primary||!text(primary.sourceRecordId)) failures.push('PRIMARY_SOURCE_RECORD_MISSING');
  else {
    if(primary.sourceEntityId&&c.entityId&&primary.sourceEntityId!==c.entityId) failures.push('PRIMARY_ENTITY_MISMATCH');
    out.push(primary);
  }
  for(const accepted of c.projectSignal?.corroboration?.accepted||[]){
    const id=text(accepted.sourceRecordId);
    const record=recordsById instanceof Map?recordsById.get(id):null;
    if(!record) failures.push('ACCEPTED_SOURCE_RECORD_MISSING');
    else if(record.sourceRecordId!==id||record.sourceSystem!==accepted.sourceSystem) failures.push('ACCEPTED_SOURCE_RECORD_MISMATCH');
    else out.push(record);
  }
  return {records:[...new Map(out.map(r=>[r.sourceRecordId,r])).values()],failures};
}
function describe(candidate,recordsById,observedAt,options={}){
  const c=candidate||{},now=instant(observedAt),asOfDate=nycDate(observedAt);
  const resolved=acceptedSources(c,recordsById);
  const failures=resolved.failures.slice(),warnings=[],events=[];
  if(!now) failures.push('OBSERVATION_INSTANT_INVALID');
  for(const record of resolved.records){
    const f=record.facts||{};
    let field,basis;
    if(record.sourceSystem==='DOHMH') {field='inspection_date';basis='DOHMH_INSPECTION_DATE';}
    else if(record.sourceSystem==='SLA_PENDING') {field='received_date';basis='SLA_APPLICATION_RECEIVED_DATE';}
    else if(record.sourceSystem==='DOB_NOW') {field='filing_date';basis='DOB_INITIAL_FILING_DATE';}
    else {failures.push('EVENT_SOURCE_UNSUPPORTED');continue;}
    const raw=f[field];
    if(raw===undefined||raw===null||raw===''){warnings.push('EVENT_DATE_NOT_PUBLISHED:'+record.sourceSystem);continue;}
    const date=calendarDate(raw);
    if(!date){failures.push('SOURCE_EVENT_DATE_INVALID:'+record.sourceSystem);continue;}
    if(date==='1900-01-01'){warnings.push('EVENT_DATE_PLACEHOLDER:'+record.sourceSystem);continue;}
    if(asOfDate&&date>asOfDate){failures.push('SOURCE_EVENT_DATE_IN_FUTURE:'+record.sourceSystem);continue;}
    events.push({date,basis,sourceSystem:record.sourceSystem,sourceRecordId:record.sourceRecordId,sourceUrl:record.sourceUrl||null});
  }
  events.sort((a,b)=>b.date.localeCompare(a.date)||a.basis.localeCompare(b.basis)||a.sourceRecordId.localeCompare(b.sourceRecordId));
  const latest=events[0]||null;
  const status=failures.length?'REVIEW':latest?'KNOWN':'UNKNOWN';
  const eventDate=status==='KNOWN'?latest.date:null;
  const age=eventDate&&asOfDate?Math.round((Date.parse(asOfDate)-Date.parse(eventDate))/DAY_MS):null;
  const rawPull=c.primaryRecord?.sourceSystem==='DOHMH'?c.primaryRecord?.facts?.record_date:null;
  let pull=calendarDate(rawPull);
  if(rawPull&&!pull) warnings.push('SOURCE_PULL_DATE_INVALID');
  if(pull&&asOfDate&&pull>asOfDate){warnings.push('SOURCE_PULL_DATE_IN_FUTURE');pull=null;}
  const first=options.firstObservedAt===undefined?null:instant(options.firstObservedAt);
  if(options.firstObservedAt&&!first) warnings.push('FIRST_OBSERVATION_INSTANT_INVALID');
  const detected=options.detectedAt===undefined?null:instant(options.detectedAt);
  if(options.detectedAt&&!detected) warnings.push('DETECTION_INSTANT_INVALID');
  const body={
    version:VERSION,status,recencyPolicy:RECENCY_POLICY,
    latestKnownEventDate:eventDate,eventDateBasis:status==='KNOWN'?latest.basis:'UNPROVEN',
    eventSourceRecordId:status==='KNOWN'?latest.sourceRecordId:null,
    eventSourceUrl:status==='KNOWN'?latest.sourceUrl:null,
    businessEventAgeCalendarDays:age,recencyPoints:status==='REVIEW'?null:recencyPoints(age),
    sourcePullDate:pull,observedAt:now,asOfDate,
    permitplateFirstObservedAt:first&&now&&first<=now?first:null,
    permitplateDetectedAt:detected&&now&&detected<=now?detected:null,
    sourceEvents:events,failures:[...new Set(failures)].sort(),warnings:[...new Set(warnings)].sort(),
    limitation:'Source event dates do not establish the date of a later status/scope change. Detection and data-pull times are not filing dates.'
  };
  return {...body,fingerprint:fingerprint(body)};
}
function valid(c){
  if(!c||c.version!==VERSION||!['KNOWN','UNKNOWN','REVIEW'].includes(c.status)||!text(c.fingerprint)) return false;
  const {fingerprint:hash,...body}=c;
  if(fingerprint(body)!==hash) return false;
  if(c.status==='KNOWN') return !!calendarDate(c.latestKnownEventDate)&&c.eventDateBasis!=='UNPROVEN'&&Number.isInteger(c.businessEventAgeCalendarDays)&&c.businessEventAgeCalendarDays>=0&&c.recencyPoints===recencyPoints(c.businessEventAgeCalendarDays);
  return c.latestKnownEventDate===null&&c.businessEventAgeCalendarDays===null&&c.recencyPoints===(c.status==='UNKNOWN'?0:null);
}
function displayFields(packageReceipt){
  const p=packageReceipt||{},c=valid(p.eventChronology)?p.eventChronology:null;
  return {
    'Stage':customerStage(p.lifecycleStage),
    'Business Event Date':c?.latestKnownEventDate||'',
    'Business Event Basis':c?.eventDateBasis||'UNPROVEN',
    'Event Time Status':c?.status||'UNKNOWN',
    'Dataset Pull Date':c?.sourcePullDate||'',
    'PermitPlate Observed At':c?.observedAt||'',
    'PermitPlate First Observed At':c?.permitplateFirstObservedAt||''
  };
}
module.exports={VERSION,RECENCY_POLICY,DAY_MS,stable,fingerprint,calendarDate,instant,nycDate,recencyPoints,customerStage,acceptedSources,describe,valid,displayFields};
