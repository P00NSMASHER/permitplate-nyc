'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');

const root=path.join(__dirname,'..');
const sample=fs.readFileSync(path.join(root,'sample.html'),'utf8');
const start=fs.readFileSync(path.join(root,'start.html'),'utf8');
const fallback=fs.readFileSync(path.join(root,'start-checkout.html'),'utf8');

assert(sample.includes('<tr><td>Equipment</td><td>100</td></tr>'));
assert(sample.includes('<tr><td>Hood/Fire</td><td>93</td></tr>'));
assert(!sample.includes('<tr><td>Hood/Fire</td><td>100</td></tr>'));
assert(sample.includes('current canonical Equipment priority is 100 and Hood/Fire is 93'));

assert(start.includes('name="territory"'));
assert(start.includes('list="territory-options"'));
assert(start.includes('pattern="\\s*(Manhattan|Brooklyn|Queens|Bronx|Staten Island)'));
for(const borough of ['Manhattan','Brooklyn','Queens','Bronx','Staten Island']){
  assert(start.includes('<option value="'+borough+'"></option>'));
}
assert(start.includes('Leave blank for all five boroughs.'));
assert(start.includes('use commas and the exact borough names shown above'));
assert(start.includes('Submitting this form does not charge you.'));
assert(start.includes('name="activation_ref"'));
assert(start.includes("fetch('/',{"));
assert(start.includes("'locked_prefilled_email'"));
assert(start.includes("'client_reference_id'"));
assert(start.includes("'pp_'+uuid"));
assert(start.includes('window.location.assign(checkout.toString())'));
assert(start.includes('you have not been charged'));
assert(start.includes('#checkout-submit{display:none!important}'));

assert(!fallback.includes('http-equiv="refresh"'));
assert(!fallback.includes('buy.stripe.com'));
assert(fallback.includes('CHECKOUT NOT STARTED'));
assert(fallback.includes('Return to PermitPlate setup'));

console.log('PermitPlate public conversion copy regression tests passed.');
