'use strict';
const assert=require('node:assert/strict');
const research=require('./curated-research-ledger');
const engine=require('./category-evidence');

const dohmh='https://data.cityofnewyork.us/resource/43nn-pn8j.json?camis=50193805';
const dob='https://data.cityofnewyork.us/d/w9ak-ipjd';
const sample={
  entityId:'CAMIS:50193805',camis:'50193805',canonicalName:'Kitchen Example',
  address:'200 Example Road',borough:'Brooklyn',deliverySuppressed:false,
  sourceSystems:['DOHMH','DOB_NOW'],
  commercialEvidence:[
    {tag:'EQUIPMENT',sourceSystem:'DOB_NOW',
      sourceRecordId:'DOB_NOW:M000001-I1',
      sourceUrl:dob,matchedPatterns:['commercial kitchen']},
    {tag:'HOOD_FIRE',sourceSystem:'DOB_NOW',
      sourceRecordId:'DOB_NOW:M000002-I1',
      sourceUrl:dob,matchedPatterns:['kitchen exhaust']}
  ],
  acceptedCorroboration:[
    {sourceRecordId:'DOB_NOW:M000001-I1',sourceSystem:'DOB_NOW',sourceUrl:dob},
    {sourceRecordId:'DOB_NOW:M000002-I1',sourceSystem:'DOB_NOW',sourceUrl:dob}
  ]
};
const equipment=engine.classify(sample,'Equipment');
assert.equal(equipment.status,'SOURCE_KEYWORD_CONTEXT');
assert.equal(equipment.category,'Equipment');
assert.equal(equipment.sourceEvidence.length,1);
assert.equal(equipment.sourceEvidence[0].sourceRecordId,'DOB_NOW:M000001-I1');
assert.equal(equipment.sourceEvidence[0].tag,'EQUIPMENT');
assert.equal(equipment.manualReviewRequired,true);
assert(!Object.keys(equipment).some(key=>/score|probability|purchaseIntent/i.test(key)));

const hood=engine.classify(sample,'Hood/Fire');
assert.equal(hood.status,'SOURCE_KEYWORD_CONTEXT');
assert.equal(hood.sourceEvidence.length,1);
assert.equal(hood.sourceEvidence[0].tag,'HOOD_FIRE');
const insurance=engine.classify(sample,'Insurance');
assert.equal(insurance.status,'RELATED_OFFICIAL_ACTIVITY');
assert.equal(insurance.sourceEvidence.length,0);
const noExtra=engine.classify({...sample,sourceSystems:['DOHMH'],commercialEvidence:[]},'POS');
assert.equal(noExtra.status,'APPLICANT_CONTEXT_ONLY');
assert.equal(engine.classify(sample,'unrecognized').status,'REVIEW');
assert(!engine.classify(sample,'Equipment').sourceEvidence.some(x=>x.tag==='HOOD_FIRE'));

const validReview={
  approved:true,
  evidenceFingerprint:equipment.evidenceFingerprint,
  sourceUrl:dob,
  rationale:'The independently corroborated job description includes commercial kitchen language, meriting vendor research.'
};
assert.deepEqual(engine.validateFounderReview(sample,'Equipment',validReview).failures,[]);
const wrong=engine.validateFounderReview(sample,'Insurance',validReview);
assert(wrong.failures.includes('CATEGORY_EVIDENCE_STALE'));
assert(engine.validateFounderReview(sample,'Equipment',{...validReview,approved:false}).failures.includes('CATEGORY_FIT_NOT_APPROVED'));
assert(engine.validateFounderReview(sample,'Equipment',{...validReview,sourceUrl:'https://example.com/anything'}).failures.includes('CATEGORY_REVIEW_SOURCE_NOT_BOUND'));
assert(engine.validateFounderReview(sample,'Equipment',{...validReview,rationale:'looks good'}).failures.includes('CATEGORY_FIT_RATIONALE_TOO_SHORT'));
assert(engine.validateFounderReview(sample,'Equipment',{...validReview,evidenceFingerprint:'stale'}).failures.includes('CATEGORY_EVIDENCE_STALE'));
const forged={
  ...sample,
  commercialEvidence:[{tag:'EQUIPMENT',sourceSystem:'DOB_NOW',sourceRecordId:'DOB_NOW:fake',
  sourceUrl:'https://example.net/fake',matchedPatterns:['commercial kitchen']}],
  acceptedCorroboration:[]
};
assert.equal(engine.classify(forged,'Equipment').sourceEvidence.length,0);
assert.equal(engine.classify(forged,'Equipment').status,'APPLICANT_CONTEXT_ONLY');
const noCorroboration={
  ...sample,
  commercialEvidence:[{tag:'EQUIPMENT',sourceSystem:'DOB_NOW',sourceRecordId:'DOB_NOW:not-accepted',
  sourceUrl:dob,matchedPatterns:['commercial kitchen']}],
  acceptedCorroboration:[]
};
assert.equal(engine.classify(noCorroboration,'Equipment').status,'APPLICANT_CONTEXT_ONLY');
// Applicant-only founder review is possible but MUST show it is general
// restaurant context, never an evidence-backed category purchase.
const general={...sample,sourceSystems:['DOHMH'],acceptedCorroboration:[],commercialEvidence:[]};
const generalTag=engine.classify(general,'Equipment');
const generalReview={
  approved:true,evidenceFingerprint:generalTag.evidenceFingerprint,
  sourceUrl:dohmh,
  rationale:'An official restaurant applicant record is relevant background for this equipment vendor; no specific equipment need is asserted.'
};
assert.deepEqual(engine.validateFounderReview(general,'Equipment',generalReview).failures,[]);
const misleadingUrl=engine.validateFounderReview(general,'Equipment',{...generalReview,sourceUrl:dob});
assert(misleadingUrl.failures.includes('CATEGORY_REVIEW_SOURCE_NOT_BOUND'));
assert.notEqual(equipment.evidenceFingerprint,engine.classify({...sample,commercialEvidence:[]},'Equipment').evidenceFingerprint);
assert(!research.checkGraph({}).valid);
console.log('Category-source evidence and mandatory founder assessment tests passed.');
