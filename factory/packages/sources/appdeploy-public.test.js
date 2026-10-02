"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createAppDeployPublicAdapters } = require("../../packages/sources/appdeploy-public");
const { createPaRegistryAdapter, createCensusAddressAdapter } = require("./live-pa-identity");

function response(body, status=200) {
  return { ok: status >= 200 && status < 300, status, async json(){ return body; } };
}

test("concrete adapters normalize registry, Census, and RDAP evidence", async () => {
  const seen=[];
  const fetchImpl=async (url) => {
    seen.push(String(url));
    if (String(url).startsWith("https://data.pa.gov/")) return response([{
      business_name:"Example LLC", filing_number:"123", typeofbusinessregistration:"Limited Liability Company",
      address_line1:"100 Market St", address_line2:null, city:"Pottsville", state:"PA", zip:"17901", creationdate:"2020-01-01T00:00:00.000"
    }]);
    if (String(url).includes("us-census-address-geocoder")) {
      const address=new URL(String(url)).searchParams.get("address");
      return response({
        input:address, matched:true, matchedAddress:"100 MARKET ST, POTTSVILLE, PA, 17901",
        coordinates:{longitude:-76.19,latitude:40.68}, source:"U.S. Census Bureau Geocoding Services"
      });
    }
    if (String(url).includes("domain-rdap")) return response({
      domain:"example.com", registered:true, authoritativeRdap:"https://rdap.verisign.com/com/v1/",
      source:"Authoritative RDAP server discovered via IANA bootstrap"
    });
    return response({},404);
  };
  const a=createAppDeployPublicAdapters({fetchImpl});
  const registry=await a.registry.lookup({company:"Example LLC"});
  assert.equal(registry.strongMatch,true);
  const address=await a.address.compare({
    suppliedAddress:"100 Market St, Pottsville, PA 17901",
    registryAddress:"100 Market St, Pottsville, PA, 17901"
  });
  assert.equal(address.sameStreetNumber,true);
  assert.equal(address.sameZip,true);
  assert.equal(address.distanceMiles,0);
  const rdap=await a.rdap.lookup({domain:"example.com"});
  assert.equal(rdap.available,true);
  assert.equal(rdap.registered,true);
  assert.equal(seen.length,4);
});

test("ambiguous strong registry candidates fail closed", async () => {
  const fetchImpl=async () => response([
    {business_name:"Example LLC",filing_number:"1"},
    {business_name:"Example Inc",filing_number:"2"}
  ]);
  const a=createAppDeployPublicAdapters({fetchImpl});
  const registry=await a.registry.lookup({company:"Example"});
  assert.equal(registry.strongMatch,false);
  assert.equal(registry.strongCandidateCount,2);
});

test("source aborts normalize to SOURCE_TIMEOUT",async()=>{
  const aborted=new Error("aborted");
  aborted.name="AbortError";
  aborted.code=20;
  const adapter=createPaRegistryAdapter({
    fetchImpl:async()=>{throw aborted;},
    timeoutMs:1
  });
  await assert.rejects(
    ()=>adapter.lookup({company:"OpenAI OpCo"}),
    error=>error?.code==="SOURCE_TIMEOUT"&&error?.message==="source_timeout"
  );
});

test("incomplete Census contracts throw SOURCE_CONTRACT_INVALID",async()=>{
  const adapter=createCensusAddressAdapter({
    fetchImpl:async()=>response({result:{addressMatches:[{matchedAddress:null,coordinates:{x:-76.19,y:40.68}}]}})
  });
  await assert.rejects(
    ()=>adapter.compare({
      suppliedAddress:"100 Market St, Pottsville, PA 17901",
      registryAddress:"100 Market St, Pottsville, PA 17901"
    }),
    error=>error?.code==="SOURCE_CONTRACT_INVALID"&&error?.message==="census_contract_incomplete"
  );
});
