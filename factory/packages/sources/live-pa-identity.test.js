"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createPaRegistryAdapter,
  createCensusAddressAdapter,
  createRdapAdapter,
} = require("./live-pa-identity");

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return body; } };
}

test("PA registry adapter returns one complete exact match as strong", async () => {
  const rows = [{
    business_name: "Example LLC",
    filing_number: "123",
    typeofbusinessregistration: "Limited Liability Company",
    address_line1: "100 Market St",
    address_line2: null,
    city: "Pottsville",
    state: "PA",
    zip: "17901",
    creationdate: "2020-01-02T00:00:00.000",
    shortcountyname: "Schuylkill",
    county_code: "54"
  }];
  const fetchImpl = async () => response(rows);
  const adapter = createPaRegistryAdapter({ fetchImpl });
  const result = await adapter.lookup({ company: "Example" });
  assert.equal(result.available, true);
  assert.equal(result.strongMatch, true);
  assert.equal(result.matchScore, 0);
  assert.equal(result.entity.filingNumber, "123");
});

test("PA registry adapter treats multiple strong candidates as ambiguous", async () => {
  const rows = [
    { business_name:"Example LLC",filing_number:"1",typeofbusinessregistration:"LLC",address_line1:"1 A St",city:"Pottsville",state:"PA",zip:"17901" },
    { business_name:"Example Inc",filing_number:"2",typeofbusinessregistration:"Corporation",address_line1:"2 A St",city:"Pottsville",state:"PA",zip:"17901" }
  ];
  const adapter = createPaRegistryAdapter({ fetchImpl: async () => response(rows) });
  const result = await adapter.lookup({ company:"Example" });
  assert.equal(result.ambiguous, true);
  assert.equal(result.strongMatch, false);
});

test("Census adapter requires same street number and ZIP and computes distance", async () => {
  const bodies = [
    { input:"100 Market St, Pottsville, PA 17901",matched:true,matchedAddress:"100 MARKET ST, POTTSVILLE, PA, 17901",coordinates:{latitude:40.684,longitude:-76.195},source:"U.S. Census Bureau Geocoding Services" },
    { input:"100 Market St, Pottsville, PA, 17901",matched:true,matchedAddress:"100 MARKET ST, POTTSVILLE, PA, 17901",coordinates:{latitude:40.68401,longitude:-76.19501},source:"U.S. Census Bureau Geocoding Services" }
  ];
  let index=0;
  const adapter=createCensusAddressAdapter({fetchImpl:async()=>response(bodies[index++])});
  const result=await adapter.compare({suppliedAddress:bodies[0].input,registryAddress:bodies[1].input});
  assert.equal(result.available,true);
  assert.equal(result.suppliedMatched,true);
  assert.equal(result.registryMatched,true);
  assert.equal(result.sameStreetNumber,true);
  assert.equal(result.sameZip,true);
  assert.ok(result.distanceMiles <= 0.01);
});

test("Census contract mismatch becomes unavailable", async () => {
  const adapter=createCensusAddressAdapter({fetchImpl:async()=>response({input:"wrong",matched:true,matchedAddress:"100 MARKET ST, POTTSVILLE, PA, 17901",coordinates:{latitude:40.684,longitude:-76.195},source:"U.S. Census Bureau Geocoding Services"})});
  const result=await adapter.compare({suppliedAddress:"100 Market St, Pottsville, PA 17901",registryAddress:"100 Market St, Pottsville, PA 17901"});
  assert.equal(result.available,false);
  assert.equal(result.detail,"census_contract_incomplete");
});

test("RDAP adapter validates requested domain and authoritative evidence", async () => {
  const adapter=createRdapAdapter({fetchImpl:async()=>response({
    domain:"example.com",
    registered:true,
    authoritativeRdap:"https://rdap.verisign.com/com/v1/",
    registrar:{name:"Example Registrar"},
    events:{registration:"1995-08-14"},
    source:"IANA RDAP bootstrap + authoritative registry RDAP"
  })});
  const result=await adapter.lookup({domain:"EXAMPLE.COM"});
  assert.equal(result.available,true);
  assert.equal(result.registered,true);
  assert.equal(result.domain,"example.com");
});

test("RDAP incomplete contract becomes unavailable", async () => {
  const adapter=createRdapAdapter({fetchImpl:async()=>response({domain:"example.com",registered:true,source:"RDAP"})});
  const result=await adapter.lookup({domain:"example.com"});
  assert.equal(result.available,false);
  assert.equal(result.detail,"rdap_contract_incomplete");
});
