'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');

const root=path.join(__dirname,'..');
const sample=fs.readFileSync(path.join(root,'sample.html'),'utf8');
const start=fs.readFileSync(path.join(root,'start.html'),'utf8');

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

console.log('PermitPlate public conversion copy regression tests passed.');
