'use strict';

const assert=require('assert');
const {evaluateHistoricalFixture}=require('./historical-shadow-score-benchmark');

const result=evaluateHistoricalFixture();
console.log(JSON.stringify(result,null,2));

assert.equal(result.fitAgreementRate,1,'historical commercial-fit replay drift');
assert.equal(result.bestFitAgreementRate,1,'historical best-fit replay drift');
assert.equal(result.exactRowRate,1,'historical category-score replay drift');

console.log('PermitPlate 47-case historical shadow score benchmark passed.');
