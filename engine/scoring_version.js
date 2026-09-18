'use strict';

const crypto=require('node:crypto');
const {computeScores,STAGE_WEIGHTS}=require('./scoring');

const SCORING_VERSION='permitplate-score-v2-2026-09-18';

const RULE_MANIFEST=Object.freeze({
  version:SCORING_VERSION,
  fit:{HIGH:20,MEDIUM:10,LOW:-20,EXCLUDE:'all-zero'},
  recency:[['<=3d',15],['<=7d',10],['<=30d',5],['>30d',0]],
  corroboration:[['1',0],['2',10],['3+',18]],
  publicPhone:5,
  stageWeights:STAGE_WEIGHTS,
  evidence:{
    sla:{POS:8,Insurance:10},
    venueLinkedHospitalityDob:{Equipment:20},
    venueLinkedHoodKitchenMechanicalPlumbingDob:{HoodFire:18},
    dobCost:{gte50000:5,gte150000:8},
    hoodScopeExtra:8,
    hotFood:{Equipment:20,HoodFire:18,Linen:10,Distribution:12},
    restaurant:{Equipment:12,HoodFire:12,Linen:12,Distribution:10},
    pokeBowl:{Equipment:8,HoodFire:6,Distribution:8},
    lightPrep:{HoodFire:-12,Linen:-8},
    knownCuisine:{Distribution:8},
    currentCamisPrePermit:{Pest:5,Waste:5,Distribution:5},
  },
  cap:[0,100],
  specialistCeiling:'Equipment/HoodFire may exceed max(POS,Insurance) only with qualifying direct specialist evidence',
});

function stable(value){
  if(Array.isArray(value)) return value.map(stable);
  if(value&&typeof value==='object'){
    return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));
  }
  return value;
}

function scoringFingerprint(){
  return crypto.createHash('sha256').update(JSON.stringify(stable(RULE_MANIFEST))).digest('hex');
}

function scoreFields(score){
  return {
    'POS Score':score.POS,
    'Insurance Score':score.Insurance,
    'Equipment Score':score.Equipment,
    'Hood/Fire Score':score.HoodFire,
    'Waste Score':score.Waste,
    'Pest Score':score.Pest,
    'Linen Score':score.Linen,
    'Distribution Score':score.Distribution,
    'Best Vendor Fit':score.BestVendorFit,
    'Best Score':score.BestScore,
  };
}

function validateCanonicalScoreRows(cases){
  const errors=[];
  for(const item of cases||[]){
    const expected=scoreFields(computeScores(item.input));
    for(const [field,value] of Object.entries(expected)){
      if(item.stored[field]!==value){
        errors.push({
          venueKey:item.venueKey,
          field,
          stored:item.stored[field],
          canonical:value,
          scoringVersion:SCORING_VERSION,
        });
      }
    }
  }
  return {pass:errors.length===0,errors,scoringVersion:SCORING_VERSION,fingerprint:scoringFingerprint()};
}

function stampRunControlNotes(notes=''){
  const tag='ScoringVersion='+SCORING_VERSION+'; ScoringFingerprint='+scoringFingerprint();
  const cleaned=String(notes||'').trim();
  return cleaned?cleaned+' '+tag:tag;
}

function hasCurrentScoringStamp(notes){
  const s=String(notes||'');
  return s.includes('ScoringVersion='+SCORING_VERSION) && s.includes('ScoringFingerprint='+scoringFingerprint());
}

module.exports={
  SCORING_VERSION,RULE_MANIFEST,scoringFingerprint,validateCanonicalScoreRows,
  stampRunControlNotes,hasCurrentScoringStamp
};
