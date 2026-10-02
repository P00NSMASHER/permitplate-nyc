'use strict';

const DAY_MS=24*60*60*1000;

function time(value,name){
  const t=new Date(value).getTime();
  if(!Number.isFinite(t)) throw new Error(`Invalid ${name}`);
  return t;
}

function ageDays(observedAt,eventAt){
  return (time(observedAt,'observedAt')-time(eventAt,'eventAt'))/DAY_MS;
}

function evaluateSourceHealth(input){
  const observedAt=input.observedAt;
  time(observedAt,'observedAt');

  const blockers=[];
  const degradations=[];
  const metrics={};

  // DOHMH is mandatory for customer delivery.
  try{
    const freshness=ageDays(observedAt,input.dohmh?.rowsUpdatedAt);
    metrics.dohmhFreshnessDays=freshness;
    if(freshness< -1/24) blockers.push('DOHMH_METADATA_FUTURE');
    else if(freshness>3) blockers.push('DOHMH_STALE');
  }catch{ blockers.push('DOHMH_METADATA_MISSING'); }

  const applicants=Number(input.dohmh?.applicantCount);
  metrics.dohmhApplicantCount=Number.isFinite(applicants)?applicants:null;
  if(!Number.isInteger(applicants)||applicants<100) blockers.push('DOHMH_APPLICANT_COUNT_LOW');

  const prepermit=Number(input.dohmh?.recentPrePermitCount);
  metrics.dohmhRecentPrePermitCount=Number.isFinite(prepermit)?prepermit:null;
  if(!Number.isInteger(prepermit)||prepermit<1) blockers.push('DOHMH_PREPERMIT_COUNT_LOW');

  // SLA/DOB outage degrades confidence but does not by itself block delivery.
  try{
    const freshness=ageDays(observedAt,input.sla?.newestRelevantReceivedDate);
    metrics.slaFreshnessDays=freshness;
    if(freshness< -1/24) degradations.push('SLA_METADATA_FUTURE');
    else if(freshness>7) degradations.push('SLA_STALE');
  }catch{ degradations.push('SLA_UNAVAILABLE'); }

  try{
    const freshness=ageDays(observedAt,input.dob?.rowsUpdatedAt);
    metrics.dobFreshnessDays=freshness;
    if(freshness< -1/24) degradations.push('DOB_METADATA_FUTURE');
    else if(freshness>7) degradations.push('DOB_STALE');
  }catch{ degradations.push('DOB_UNAVAILABLE'); }

  return {
    deliveryAllowed:blockers.length===0,
    confidenceDegraded:degradations.length>0,
    blockers:[...new Set(blockers)],
    degradations:[...new Set(degradations)],
    metrics,
  };
}

function slaDiscoveryEligibility(row){
  const county=String(row.county||'').trim().toUpperCase();
  const nyc=new Set(['NEW YORK','KINGS','QUEENS','BRONX','RICHMOND']);
  if(!nyc.has(county)) return {eligible:false,reason:'NON_NYC_COUNTY'};

  const received=time(row.receivedDate,'receivedDate');
  const observed=time(row.observedAt,'observedAt');
  if((observed-received)/DAY_MS>180) return {eligible:false,reason:'OUTSIDE_180_DAY_WINDOW'};

  const text=`${row.description||''} ${row.classification||''} ${row.dba||''} ${row.legalName||''}`.toUpperCase();
  const explicit=/\bRESTAURANT\b/.test(text);
  const foodBusiness=/FOOD\s*&\s*BEVERAGE BUSINESS/.test(text);
  const hospitality=/RESTAURANT|CAFE|BAR|LOUNGE|OMAKASE|SUSHI|PIZZA|PIZZERIA|BAKERY|COFFEE|TAVERN/.test(text);
  if(explicit || (foodBusiness&&hospitality)) return {eligible:true,reason:'EXPLICIT_HOSPITALITY'};
  return {eligible:false,reason:'OPAQUE_FOOD_BEVERAGE_AUDIT_ONLY'};
}

function dobFirstEligibility(row){
  const observed=time(row.observedAt,'observedAt');
  const material=time(row.materialDate,'materialDate');
  if((observed-material)/DAY_MS>240) return {eligible:false,reason:'OUTSIDE_240_DAY_WINDOW'};

  const address=String(row.address||'').trim();
  const zip=String(row.zip||'').trim();
  if(!address||!zip) return {eligible:false,reason:'MISSING_EXACT_ADDRESS_OR_ZIP'};

  const text=`${row.jobDescription||''} ${(row.workTypes||[]).join(' ')} ${row.useDescription||''}`.toUpperCase();
  const hospitality=/RESTAURANT|CAFE|BAR|TAVERN|EATING[ -]?DRINKING|FOOD[ -]?SERVICE|COMMERCIAL KITCHEN|PIZZA|PIZZERIA|BAKERY|COFFEE|TAKE[ -]?OUT/.test(text);
  if(!hospitality) return {eligible:false,reason:'NO_EXPLICIT_HOSPITALITY_USE'};
  return {eligible:true,reason:'EXPLICIT_HOSPITALITY_FILING'};
}

module.exports={evaluateSourceHealth,slaDiscoveryEligibility,dobFirstEligibility};
