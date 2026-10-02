'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateCorroboration } = require('./corroboration');

test('same address alone never corroborates unrelated businesses', () => {
  const a = { source:'DOHMH', camis:'50123456', dba:'KOKE', address:'123 E 125th Street, New York, NY' };
  const b = { source:'DOB', applicationId:'M01329447-I1', entityName:'EASTHARLEM125 LLC', address:'123 E 125th St, New York, NY' };
  const result = evaluateCorroboration(a,b);
  assert.equal(result.status, 'review');
  assert.match(result.reasons.join(' '), /co-location alone/i);
});

test('known KOKE/EASTHARLEM class fails closed', () => {
  const koke = { source:'DOHMH', camis:'50123456', dba:'KOKE', address:'123 E 125TH ST NEW YORK NY' };
  const dob = { source:'DOB', applicationId:'M01329447-I1', entityName:'EASTHARLEM125', address:'123 E 125TH STREET NEW YORK NY' };
  assert.notEqual(evaluateCorroboration(koke,dob).status, 'corroborated');
});

test('same address plus strong entity overlap may corroborate', () => {
  const a = { source:'DOHMH', dba:'Crybaby Brooklyn LLC', address:'555 Example Ave Brooklyn NY' };
  const b = { source:'DOB', entityName:'CRYBABY BROOKLYN', address:'555 Example Avenue Brooklyn NY' };
  assert.equal(evaluateCorroboration(a,b).status, 'corroborated');
});

test('same address plus same phone may corroborate even when legal names differ', () => {
  const a = { source:'DOHMH', dba:'Royal Diner', phone:'212-555-1212', address:'10 Main St New York NY' };
  const b = { source:'SLA', entityName:'Vounaros Restaurant Corp', phone:'2125551212', address:'10 Main Street New York NY' };
  assert.equal(evaluateCorroboration(a,b).status, 'corroborated');
});

test('contradictory same-namespace stable identifiers reject even at same address', () => {
  const a = { source:'DOHMH', camis:'50000001', dba:'Alpha', address:'1 Main St New York NY' };
  const b = { source:'DOHMH', camis:'50000002', dba:'Alpha', address:'1 Main St New York NY' };
  assert.equal(evaluateCorroboration(a,b).status, 'rejected');
});

test('shared building id without entity linkage remains review', () => {
  const a = { source:'DOHMH', dba:'Tenant A', bin:'1234567', address:'100 Market St New York NY' };
  const b = { source:'DOB', entityName:'Landlord Holdings', bin:'1234567', address:'100 Market St New York NY' };
  assert.equal(evaluateCorroboration(a,b).status, 'review');
});

test('no location or identity linkage rejects', () => {
  const a = { source:'DOHMH', dba:'Alpha', address:'1 Main St New York NY' };
  const b = { source:'DOB', entityName:'Beta', address:'99 Broadway New York NY' };
  assert.equal(evaluateCorroboration(a,b).status, 'rejected');
});
