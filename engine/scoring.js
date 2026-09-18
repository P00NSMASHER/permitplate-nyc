'use strict';

const { applyVerticalEvidenceCeiling } = require('./production_policy');

const CATEGORIES=['POS','Insurance','Equipment','HoodFire','Waste','Pest','Linen','Distribution'];

const STAGE_WEIGHTS={
  1:{POS:28,Insurance:25,Equipment:15,HoodFire:8,Waste:12,Pest:10,Linen:8,Distribution:10},
  2:{POS:25,Insurance:24,Equipment:35,HoodFire:35,Waste:18,Pest:15,Linen:15,Distribution:18},
  3:{POS:20,Insurance:17,Equipment:25,HoodFire:25,Waste:28,Pest:30,Linen:25,Distribution:32},
  4:{POS:15,Insurance:10,Equipment:10,HoodFire:12,Waste:32,Pest:35,Linen:30,Distribution:34},
};

const FIT={HIGH:20,MEDIUM:10,LOW:-20};

function clamp(n){ return Math.max(0,Math.min(100,Math.round(n))); }

function recency(ageDays){
  const n=Number(ageDays);
  if(!Number.isFinite(n)||n<0) throw new Error('materialAgeDays must be a nonnegative number');
  if(n<=3) return 15;
  if(n<=7) return 10;
  if(n<=30) return 5;
  return 0;
}

function corroboration(sourceCount){
  const n=Number(sourceCount);
  if(!Number.isInteger(n)||n<1) throw new Error('sourceCount must be an integer >= 1');
  if(n>=3) return 18;
  if(n===2) return 10;
  return 0;
}

function norm(value){ return String(value||'').toUpperCase(); }

function flags(input){
  const concept=norm(input.conceptText);
  const work=norm([input.dobJobDescription,...(input.dobWorkTypes||[])].join(' '));

  const hotFood=/(PIZZA|PIZZERIA|BAKERY|GRILL|BBQ|BARBECUE|CHICKEN|HOT[ -]?FOOD|COMMERCIAL KITCHEN)/.test(concept);
  const restaurant=/\b(RESTAURANT|PUB|BISTRO)\b/.test(concept);
  const pokeBowl=/\bPOKE\b|\bBOWL\b/.test(concept);
  const lightPrep=/(COFFEE|TEA|JUICE|FROZEN DESSERT|FROZEN-DESSERT|LIGHT[ -]?PREP)/.test(concept);
  const hoodScope=/(HOOD|FIRE SUPPRESSION|KITCHEN|MECHANICAL|PLUMBING|COMMERCIAL KITCHEN)/.test(work);
  const hoodExtra=/(PLUMBING|MECHANICAL|PLACE OF ASSEMBLY|COMMERCIAL KITCHEN)/.test(work);
  const kitchenMechanical=/(KITCHEN|MECHANICAL|PLUMBING|HOOD|FIRE SUPPRESSION|COMMERCIAL KITCHEN)/.test(work);

  return {hotFood,restaurant,pokeBowl,lightPrep,hoodScope,hoodExtra,kitchenMechanical};
}

function computeScores(input){
  const fit=String(input.commercialFit||'').toUpperCase();
  if(fit==='EXCLUDE'){
    const zero=Object.fromEntries(CATEGORIES.map(c=>[c,0]));
    return {...zero,BestVendorFit:'SUPPRESSED',BestScore:0,scoreReasons:{common:['Commercial Fit EXCLUDE => all scores 0']}};
  }
  if(!(fit in FIT)) throw new Error('commercialFit must be HIGH, MEDIUM, LOW, or EXCLUDE');

  const stage=Number(input.stageNumber);
  if(!STAGE_WEIGHTS[stage]) throw new Error('stageNumber must be 1..4');
  const sourceCount=Number(input.sourceCount);
  const common=FIT[fit]+recency(input.materialAgeDays)+corroboration(sourceCount)+(input.publicPhone?5:0);
  const scores={};
  const reasons={common:[
    `Fit ${fit} ${FIT[fit]>=0?'+':''}${FIT[fit]}`,
    `Recency +${recency(input.materialAgeDays)}`,
    `Corroboration +${corroboration(sourceCount)}`,
    `Public phone +${input.publicPhone?5:0}`,
  ]};
  for(const c of CATEGORIES){
    scores[c]=common+STAGE_WEIGHTS[stage][c];
    reasons[c]=[`Stage ${stage} +${STAGE_WEIGHTS[stage][c]}`];
  }

  const F=flags(input);
  const sourceSet=new Set((input.sources||[]).map(norm));
  const hasSla=sourceSet.has('SLA');
  const matchedDob=Boolean(input.strictVenueLinkedHospitalityDob) && !input.buildingLevelUnmatchedDob;

  if(hasSla){
    scores.POS+=8; scores.Insurance+=10;
    reasons.POS.push('SLA +8'); reasons.Insurance.push('SLA +10');
  }

  if(matchedDob){
    scores.Equipment+=20; reasons.Equipment.push('Strict venue-linked hospitality DOB +20');

    if(F.hoodScope || input.directHoodFireDobScope){
      scores.HoodFire+=18; reasons.HoodFire.push('Strict venue-linked hood/kitchen/mechanical/plumbing DOB +18');
    }

    const cost=Number(input.dobInitialCost||0);
    if(Number.isFinite(cost) && cost>=150000){
      scores.Equipment+=8; reasons.Equipment.push('Relevant DOB cost >=150k +8');
    }else if(Number.isFinite(cost) && cost>=50000){
      scores.Equipment+=5; reasons.Equipment.push('Relevant DOB cost >=50k +5');
    }

    if(F.hoodExtra){
      scores.HoodFire+=8; reasons.HoodFire.push('Plumbing/mechanical/place-of-assembly/commercial-kitchen +8');
    }
  }

  if(F.hotFood){
    scores.Equipment+=20; scores.HoodFire+=18; scores.Linen+=10; scores.Distribution+=12;
    reasons.Equipment.push('Hot-food/equipment-intensive concept +20');
    reasons.HoodFire.push('Hot-food/hood-likely concept +18');
    reasons.Linen.push('Hot-food concept +10');
    reasons.Distribution.push('Hot-food concept +12');
  }
  if(F.restaurant){
    scores.Equipment+=12; scores.HoodFire+=12; scores.Linen+=12; scores.Distribution+=10;
    reasons.Equipment.push('Restaurant/pub/bistro +12');
    reasons.HoodFire.push('Restaurant/pub/bistro +12');
    reasons.Linen.push('Restaurant/pub/bistro +12');
    reasons.Distribution.push('Restaurant/pub/bistro +10');
  }
  if(F.pokeBowl){
    scores.Equipment+=8; scores.HoodFire+=6; scores.Distribution+=8;
    reasons.Equipment.push('Poke/bowl +8');
    reasons.HoodFire.push('Poke/bowl +6');
    reasons.Distribution.push('Poke/bowl +8');
  }
  if(F.lightPrep){
    scores.HoodFire-=12; scores.Linen-=8;
    reasons.HoodFire.push('Light-prep concept -12');
    reasons.Linen.push('Light-prep concept -8');
  }
  if(input.knownCuisineType){
    scores.Distribution+=8; reasons.Distribution.push('Known cuisine/type +8');
  }
  if(input.actualDohmhPrePermit){
    scores.Pest+=5; scores.Waste+=5; scores.Distribution+=5;
    reasons.Pest.push('Actual DOHMH pre-permit +5');
    reasons.Waste.push('Actual DOHMH pre-permit +5');
    reasons.Distribution.push('Actual DOHMH pre-permit +5');
  }

  for(const c of CATEGORIES) scores[c]=clamp(scores[c]);

  const ceilingEvidence={
    directCategoryDobScope: matchedDob && (
      Boolean(input.directEquipmentDobScope) ||
      /INTERIOR|BUILDOUT|KITCHEN|EQUIPMENT|PLUMBING|MECHANICAL|COMMERCIAL KITCHEN|TAKE[ -]?OUT/.test(
        norm([input.dobJobDescription,...(input.dobWorkTypes||[])].join(' '))
      )
    ),
    explicitHotFoodSpecialist:F.hotFood,
  };
  const ceiled=applyVerticalEvidenceCeiling(scores,ceilingEvidence);
  Object.assign(scores,ceiled);

  const {BestVendorFit,BestScore}=selectBestVendor(scores,{
    ...input,
    _flags:F,
    hasSla,
    matchedDob,
  });
  return {...scores,BestVendorFit,BestScore,scoreReasons:reasons};
}

function selectBestVendor(scores,input={}){
  const max=Math.max(...CATEGORIES.map(c=>Number(scores[c])));
  const tied=CATEGORIES.filter(c=>Number(scores[c])===max);
  if(tied.length===1) return {BestVendorFit:tied[0],BestScore:max};

  const F=input._flags||flags(input);
  const matchedDob=Boolean(input.matchedDob||input.strictVenueLinkedHospitalityDob) && !input.buildingLevelUnmatchedDob;
  const work=norm([input.dobJobDescription,...(input.dobWorkTypes||[])].join(' '));
  const kitchenMechanicalDob=matchedDob && /(KITCHEN|MECHANICAL|PLUMBING|HOOD|FIRE SUPPRESSION|COMMERCIAL KITCHEN)/.test(work);
  const cost=Number(input.dobInitialCost||0);
  const highCostDob=matchedDob && Number.isFinite(cost) && cost>=50000;
  const hasSla=input.hasSla ?? new Set((input.sources||[]).map(norm)).has('SLA');
  const early=Number(input.stageNumber)===1;

  const preferences=[];
  if(kitchenMechanicalDob) preferences.push('HoodFire');
  if(highCostDob) preferences.push('Equipment');
  if(F.hotFood) preferences.push('Equipment');
  if(hasSla&&early) preferences.push('Insurance');
  preferences.push('POS','Insurance','Equipment','HoodFire','Waste','Pest','Linen','Distribution');

  for(const candidate of preferences){
    if(tied.includes(candidate)) return {BestVendorFit:candidate,BestScore:max};
  }
  throw new Error('unable to select Best Vendor Fit');
}

module.exports={CATEGORIES,STAGE_WEIGHTS,computeScores,selectBestVendor,recency,corroboration};
