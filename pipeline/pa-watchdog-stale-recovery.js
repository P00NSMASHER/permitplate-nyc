'use strict';
// Bounded operational recovery classification. No Stripe, GitHub API,
// credentials, private file writes, customer fields or outbound contact.
const fs=require('node:fs');
const core=require('./pa-permit-orders');
const ONLY_STALE='PA_PROVIDER_POLL_STALE';
function eligible(report){
  if(!report||typeof report!=='object'||Array.isArray(report))return false;
  const incidents=report.incidents;
  if(!Array.isArray(incidents)||incidents.length!==1||incidents[0]!==ONLY_STALE)return false;
  if(report.state!=='OPERATOR_ATTENTION_REQUIRED')return false;
  const checked=core.iso(report.lastProviderCheckAt);
  const observed=core.iso(report.checkedAt);
  if(!checked||!observed||Date.parse(observed)<=Date.parse(checked))return false;
  return report.customerIdentifyingFieldsEmitted===false
    && report.customerContactActions===0
    && report.paymentMutations===0
    && report.automaticResendAllowed===false
    && report.automaticRefundAllowed===false;
}
function main(){
  let report=null;
  try{
    if(process.argv.length===3)report=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
  }catch{
    // An unavailable/corrupt report cannot authorize an internal dispatch.
  }
  process.stdout.write('stale_poll='+(eligible(report)?'true':'false')+'\n');
}
if(require.main===module)main();
module.exports={eligible};
