'use strict';

const assert = require('assert');
const f = require('./commercial-fit');

function candidate(name, overrides) {
  return Object.assign({
    entityId:'CAMIS:1',
    canonicalName:name,
    lifecycleStage:'JUST FILED',
    sourceLatestEffectiveAt:'2026-09-21T12:00:00Z',
    sourceSystems:['DOHMH'],
    sourceCount:1,
    commercialEvidence:[],
    deliverySuppressed:false,
    crossCamisOperationalConflicts:[],
    primaryRecord:{
      sourceSystem:'DOHMH',
      sourceRecordId:'DOHMH:1'
    },
    projectSignal:{
      corroboration:{accepted:[]}
    }
  }, overrides || {});
}

{
  const out=f.classifyCommercialFit({candidate:candidate('SWEET ICE CREAM SHOP CORPORATION')});
  assert.equal(out.status,'CLASSIFIED');
  assert.equal(out.fit,'HIGH');
  assert(out.reasons.some((reason)=>reason.startsWith('DIRECT_DBA_COMMERCIAL_CONCEPT:')));
}

{
  const out=f.classifyCommercialFit({candidate:candidate('MONBACKS')});
  assert.equal(out.fit,'MEDIUM');
  assert(out.reasons.includes('DOHMH_APPLICANT_CONCEPT_UNCLEAR'));
}

{
  const out=f.classifyCommercialFit({
    candidate:candidate('Koke',{
      deliverySuppressed:true,
      crossCamisOperationalConflicts:[{
        camis:'50184059',
        primarySourceRecordId:'DOHMH:50184059:PREPERMIT'
      }]
    })
  });
  assert.equal(out.fit,'LOW');
  assert(out.reasons.includes('OPERATIONAL_PREDECESSOR_OR_IDENTITY_CONFLICT'));
  assert(out.evidenceRefs.includes('DOHMH:50184059:PREPERMIT'));
}

{
  const out=f.classifyCommercialFit({candidate:candidate('ROCKEFELLER GROUP 21ST FL')});
  assert.equal(out.fit,'EXCLUDE');
  assert(out.reasons.includes('INSTITUTIONAL_CONTEXT:CORPORATE_FLOOR'));
}

{
  const out=f.classifyCommercialFit({candidate:candidate('THE MARKLE RESIDENCE')});
  assert.equal(out.fit,'EXCLUDE');
  assert(out.reasons.includes('INSTITUTIONAL_CONTEXT:RESIDENCE'));
}

{
  const c=candidate('WILKIE',{
    projectSignal:{
      corroboration:{accepted:[
        {sourceRecordId:'SLA_PENDING:NA-1',sourceSystem:'SLA_PENDING'}
      ]}
    }
  });
  const records=[{
    sourceSystem:'SLA_PENDING',
    sourceRecordId:'SLA_PENDING:NA-1',
    facts:{description:'Food & Beverage Business'},
    parties:{dba:'WILKIE',legalName:'Beanstable LLC'}
  }];
  const out=f.classifyCommercialFit({candidate:c,sourceRecords:records});
  assert.equal(out.fit,'HIGH');
  assert(out.reasons.includes('ACCEPTED_SLA_HOSPITALITY_CLASSIFICATION'));
}

{
  const c=candidate('CRYBABY',{
    projectSignal:{
      corroboration:{accepted:[
        {sourceRecordId:'DOB_NOW:M00692498-P1',sourceSystem:'DOB_NOW'}
      ]}
    }
  });
  const records=[{
    sourceSystem:'DOB_NOW',
    sourceRecordId:'DOB_NOW:M00692498-P1',
    facts:{job_description:'NEW EATING & DRINKING ESTABLISHMENT WITH COMMERCIAL KITCHEN'}
  }];
  const out=f.classifyCommercialFit({candidate:c,sourceRecords:records});
  assert.equal(out.fit,'HIGH');
  assert(out.reasons.includes('ACCEPTED_DOB_HOSPITALITY_SCOPE'));
}

// Co-located but rejected auxiliary evidence cannot improve fit.
{
  const c=candidate('EASTHARLEM125 LLC',{
    projectSignal:{
      corroboration:{
        accepted:[],
        rejected:[{sourceRecordId:'DOB_NOW:M01329447-I1',sourceSystem:'DOB_NOW'}]
      }
    }
  });
  const records=[{
    sourceSystem:'DOB_NOW',
    sourceRecordId:'DOB_NOW:M01329447-I1',
    facts:{job_description:'Commercial kitchen restaurant buildout'}
  }];
  const out=f.classifyCommercialFit({candidate:c,sourceRecords:records});
  assert.equal(out.fit,'MEDIUM');
  assert(!out.reasons.includes('ACCEPTED_DOB_HOSPITALITY_SCOPE'));
}

// Unknown non-DOHMH context is held for review, not guessed.
{
  const c=candidate('UNKNOWN ENTITY',{
    primaryRecord:{sourceSystem:'OTHER',sourceRecordId:'OTHER:1'}
  });
  const out=f.classifyCommercialFit({candidate:c});
  assert.equal(out.status,'REVIEW');
  assert.equal(out.fit,null);
  assert(out.reasons.includes('COMMERCIAL_CONTEXT_UNPROVEN'));
}

// Receipt identity is deterministic for the same evidence.
{
  const c=candidate('Joe & John\'s Slice Shoppe');
  const a=f.classifyCommercialFit({candidate:c});
  const b=f.classifyCommercialFit({candidate:JSON.parse(JSON.stringify(c))});
  assert.equal(a.fitReceiptId,b.fitReceiptId);
}

{
  const out=f.classifyCommercialFit({candidate:candidate("TONY'S BRICK OVEN")});
  assert.equal(out.fit,'HIGH');
  assert.equal(out.conceptEvidence.explicit,true);
  assert.equal(out.conceptEvidence.hotFood,false);
}

{
  const out=f.classifyCommercialFit({candidate:candidate('PAM AND STEVE GUYANESE RESTAURANT AND BAKERY LTD')});
  assert.equal(out.fit,'HIGH');
  assert.equal(out.conceptEvidence.archetype,'HOT_FOOD');
  assert.equal(out.conceptEvidence.hotFood,true);
  assert.equal(out.conceptEvidence.restaurant,false);
}

{
  const out=f.classifyCommercialFit({candidate:candidate('CARNEGIE DINER & CAFE')});
  assert.equal(out.fit,'HIGH');
  assert.equal(out.conceptEvidence.archetype,'GENERAL_COMMERCIAL');
  assert.equal(out.conceptEvidence.hotFood,false);
  assert.equal(out.conceptEvidence.restaurant,false);
  assert.equal(out.conceptEvidence.lightPrep,false);
}

{
  const out=f.classifyCommercialFit({candidate:candidate('SPITFIRE COFFEE & SANDWICH')});
  assert.equal(out.fit,'HIGH');
  assert.equal(out.conceptEvidence.archetype,'LIGHT_PREP');
  assert.equal(out.conceptEvidence.lightPrep,true);
}

console.log('PermitPlate commercial-fit receipt regression tests passed.');
