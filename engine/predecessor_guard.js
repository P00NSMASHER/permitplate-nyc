'use strict';

function text(value){
  return String(value??'').trim().toUpperCase().replace(/[^A-Z0-9]+/g,' ').replace(/\s+/g,' ').trim();
}

function exactAddress(value){
  return text(value)
    .replace(/\bSTREET\b/g,'ST')
    .replace(/\bAVENUE\b/g,'AVE')
    .replace(/\bROAD\b/g,'RD')
    .replace(/\bBOULEVARD\b/g,'BLVD')
    .replace(/\bPLACE\b/g,'PL')
    .replace(/\s+/g,' ').trim();
}

function dateOnly(value){
  const s=String(value??'').slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d=new Date(s+'T00:00:00Z');
  return Number.isFinite(d.getTime())?s:null;
}

function isOperationalPrePermit(row){
  const inspection=text(row.inspection_type);
  if(!inspection.startsWith('PRE PERMIT')) return false;
  const action=text(row.action);
  return inspection.includes('OPERATIONAL') || action.includes('CLOSED') || action.includes('CLOSURE');
}

function sameIdentity(current,row){
  return Boolean(
    text(current.dba) &&
    text(current.dba)===text(row.dba) &&
    exactAddress(current.address) &&
    exactAddress(current.address)===exactAddress(row.address) &&
    String(current.zip??'').trim()===String(row.zip??'').trim()
  );
}

/**
 * Return suppression candidates only. This does not assert legal/operator
 * continuity. The caller must preserve the predecessor evidence separately and
 * keep the current opportunity fail-closed/audit-only until reviewed.
 */
function findPredecessorCandidates(current,historicalRows){
  const currentCamis=String(current.camis??'').trim();
  if(!currentCamis||!text(current.dba)||!exactAddress(current.address)||!String(current.zip??'').trim()){
    return [];
  }

  const currentFirst=dateOnly(current.firstSignalDate);
  const out=[];
  const seen=new Set();

  for(const row of historicalRows||[]){
    const predecessor=String(row.camis??'').trim();
    if(!predecessor||predecessor===currentCamis) continue;
    if(!sameIdentity(current,row)) continue;
    if(!isOperationalPrePermit(row)) continue;

    const eventDate=dateOnly(row.inspection_date);
    if(!eventDate) continue;
    // A predecessor event after the current signal cannot establish a prior episode.
    if(currentFirst && eventDate>currentFirst) continue;

    const key=`${predecessor}|${eventDate}`;
    if(seen.has(key)) continue;
    seen.add(key);

    out.push({
      currentCamis,
      predecessorCamis:predecessor,
      eventDate,
      eventId:`DOHMH:${predecessor}:${eventDate}:PREDECESSOR`,
      venueKey:`PREDECESSOR:${exactAddress(current.address)}|${String(current.zip).trim()}|CAMIS:${predecessor}`,
      eventType:'Cross-CAMIS predecessor / suppression evidence',
      stageEvidence:`Same normalized DBA + exact address/ZIP predecessor CAMIS had ${String(row.inspection_type||'Pre-permit')} and action ${String(row.action||'')}. Suppression evidence only; NOT Stage 3/4 evidence for current CAMIS ${currentCamis}.`,
      evidenceRole:'SUPPRESSION_ONLY',
      confidence:'REVIEW',
    });
  }
  return out.sort((a,b)=>b.eventDate.localeCompare(a.eventDate)||a.predecessorCamis.localeCompare(b.predecessorCamis));
}

function suppressionPolicy(candidate){
  if(!candidate) return null;
  return {
    commercialFit:'LOW',
    stage:'JUST FILED',
    stageNumber:1,
    countedSources:['DOHMH'],
    confidence:'LOW',
    purchaseWindow:'SUPPRESSED',
    deliverySuppressed:true,
    predecessorEvidenceRole:'SUPPRESSION_ONLY',
    detachPriorAuxiliaryEpisode:true,
  };
}

module.exports={findPredecessorCandidates,suppressionPolicy,isOperationalPrePermit,exactAddress};
