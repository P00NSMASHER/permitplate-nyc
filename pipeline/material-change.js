'use strict';

const {createHash} = require('node:crypto');
const VERSION = 'PermitPlate-materiality-v1.0.0';
const PARTS = ['identity','premise','lifecycle','suppression','sources','evidence','tags'];
const STAGES = {'JUST FILED':1,'BUILDOUT / LICENSING':2,'HEALTH PRE-PERMIT':3,'MULTI-SOURCE NEAR-OPENING':4};
const text = value => value == null ? '' : String(value).trim();
const norm = value => text(value).normalize('NFKC').replace(/\s+/g,' ').toUpperCase();
function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
const hash = value => createHash('sha256').update(stable(value)).digest('hex');
const unique = values => [...new Set(values)].sort();
function ordered(values) {
  return [...new Map(values.map(value=>[stable(value),value])).entries()].sort(([a],[b])=>a.localeCompare(b)).map(([,value])=>value);
}
function amount(value) {
  if (value == null || text(value) === '') return null;
  const n = Number(text(value).replace(/[$,]/g,''));
  return Number.isFinite(n) ? n : null;
}
function sourceDate(value) {
  // Publisher date fields are calendar dates, not evidence of when our fetch ran.
  const v = text(value);
  return /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(v) ? v.slice(0,10) : (v || null);
}

function sourceEvidence(record) {
  const r=record||{}, f=r.facts||{}, k=r.entityKeys||{};
  const system=norm(r.sourceSystem);
  const out={system, key:null, eventType:norm(r.eventType), eventDate:null, details:{}};
  if (system==='DOHMH') {
    out.key='DOHMH:'+text(k.camis||r.sourceEntityId);
    // RECORD DATE is the extraction date. 1900-01-01 is an uninspected placeholder.
    // Neither may create an inspection/filing date or a material-change alert.
    const inspection=sourceDate(f.inspection_date);
    out.eventDate=inspection && inspection!=='1900-01-01' ? inspection : null;
    out.details={inspectionType:norm(f.inspection_type),action:norm(f.action)};
  } else if (system==='DOB_NOW') {
    out.key='DOB_NOW:'+text(k.jobFilingNumber||r.sourceRecordId);
    out.eventDate=sourceDate(f.filing_date||r.sourceEffectiveAt);
    out.details={status:norm(f.filing_status),scope:norm(f.job_description),workTypes:norm(f.work_types),floor:norm(f.work_on_floor),cost:amount(f.initial_cost_number??f.initial_cost)};
  } else if (system==='SLA_PENDING') {
    out.key='SLA_PENDING:'+text(k.applicationId||r.sourceEntityId||r.sourceRecordId);
    out.eventDate=sourceDate(f.received_date||r.sourceEffectiveAt);
    out.details={status:norm(f.status),licenseClass:norm(f.description)};
  } else {
    out.key=system+':'+text(r.sourceEntityId||r.sourceRecordId);
    out.details={unsupportedSource:true};
  }
  return out;
}

function describe(candidate) {
  const c=candidate||{}, p=c.primaryRecord||{}, property=p.property||{};
  const project=c.projectSignal||{};
  const evidence=Array.isArray(project.materialEvidence) ? ordered(project.materialEvidence) : (c.primaryRecord ? [sourceEvidence(p)] : []);
  const groups={
    identity:{entityId:text(c.entityId),name:norm(c.canonicalName)},
    premise:{address:norm(c.address||property.address),borough:norm(c.borough||property.borough),zip:text(c.zip||property.zip),bin:text(c.bin||property.bin),bbl:text(c.bbl||property.bbl)},
    lifecycle:norm(c.lifecycleStage),
    suppression:{suppressed:c.deliverySuppressed===true,reasons:unique((c.suppressionReasons||[]).map(norm)),conflicts:unique((c.crossCamisOperationalConflicts||[]).map(item=>text(item.entityId||item.camis)).filter(Boolean))},
    sources:unique((c.sourceSystems||[]).map(norm).filter(Boolean)),
    evidence,
    // Evidence text is retained separately. Here tags ignore generated row hashes.
    tags:ordered((c.commercialEvidence||[]).map(item=>({system:norm(item.sourceSystem),tag:norm(item.tag)})))
  };
  const descriptor={
    version:VERSION,
    parts:Object.fromEntries(PARTS.map(part=>[part,hash(groups[part])])),
    sourceKeys:unique(evidence.map(item=>text(item.key)).filter(Boolean)),
    stageRank:STAGES[groups.lifecycle]||0,
    suppressed:groups.suppression.suppressed
  };
  return {...descriptor,fingerprint:hash(descriptor)};
}

function valid(descriptor) {
  const d=descriptor;
  if (!d || d.version!==VERSION || !d.parts || !Array.isArray(d.sourceKeys) ||
      !Number.isInteger(d.stageRank) || typeof d.suppressed!=='boolean' ||
      PARTS.some(part=>!/^[a-f0-9]{64}$/.test(d.parts[part]||''))) return false;
  const {fingerprint,...body}=d;
  return /^[a-f0-9]{64}$/.test(fingerprint||'') && hash(body)===fingerprint;
}

function compare(previous,current) {
  if (!valid(previous) || !valid(current)) return {material:false,review:true,reasons:['MATERIALITY_BASELINE_REQUIRED']};
  if (previous.fingerprint===current.fingerprint) return {material:false,review:false,reasons:['NO_MATERIAL_CHANGE']};
  const changed=PARTS.filter(part=>previous.parts[part]!==current.parts[part]);
  const reasons=changed.map(part=>part.toUpperCase()+'_CHANGED');
  // Identity edits, regression, suppression and evidence leaving a rolling query
  // need review. None alone proves closure, reopening, or a new sales opportunity.
  if (changed.includes('identity') || changed.includes('premise') || changed.includes('suppression') || current.suppressed) {
    return {material:false,review:true,reasons};
  }
  if (previous.stageRank>0 && current.stageRank<previous.stageRank) return {material:false,review:true,reasons:['LIFECYCLE_REGRESSION',...reasons]};
  if (previous.sourceKeys.some(key=>!current.sourceKeys.includes(key))) return {material:false,review:true,reasons:['CORROBORATION_LEFT_WINDOW',...reasons]};
  return {material:true,review:false,reasons};
}

module.exports={VERSION,PARTS,stable,hash,sourceEvidence,describe,valid,compare};
