"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {TREASURY_API,createTreasuryAverageRatesAdapter}=require("./treasury-average-rates");

function response(body,status=200){return{status,ok:status>=200&&status<300,async json(){return body;}};}

const rows=[
 {record_date:"2026-09-30",security_type_desc:"Marketable",security_desc:"Treasury Bills",avg_interest_rate_amt:"4.123"},
 {record_date:"2026-09-30",security_type_desc:"Marketable",security_desc:"Treasury Notes",avg_interest_rate_amt:"3.456"},
 {record_date:"2026-09-30",security_type_desc:"Marketable",security_desc:"Total Marketable",avg_interest_rate_amt:"3.789"},
 {record_date:"2026-08-31",security_type_desc:"Marketable",security_desc:"Total Marketable",avg_interest_rate_amt:"3.700"}
];

test("exact security match selects one latest-month rate",async()=>{
 const calls=[];
 const a=createTreasuryAverageRatesAdapter({fetchImpl:async url=>{calls.push(url);return response({data:rows});}});
 const r=await a.lookup({security:"Total Marketable"});
 assert.equal(calls.length,1);
 assert.ok(calls[0].startsWith(TREASURY_API));
 assert.equal(r.recordDate,"2026-09-30");
 assert.equal(r.matchCount,1);
 assert.equal(r.selected.averageInterestRatePercent,3.789);
});

test("substring with multiple matches is ambiguous",async()=>{
 const a=createTreasuryAverageRatesAdapter({fetchImpl:async()=>response({data:rows})});
 const r=await a.lookup({security:"Treasury"});
 assert.equal(r.matchCount,2);
 assert.equal(r.ambiguous,true);
 assert.equal(r.selected,null);
});

test("no match is completed found=false",async()=>{
 const a=createTreasuryAverageRatesAdapter({fetchImpl:async()=>response({data:rows})});
 const r=await a.lookup({security:"Nonexistent Security"});
 assert.equal(r.available,true);
 assert.equal(r.found,false);
 assert.equal(r.matchCount,0);
});

test("invalid numeric rate remains null rather than fabricated",async()=>{
 const a=createTreasuryAverageRatesAdapter({fetchImpl:async()=>response({data:[
  {record_date:"2026-09-30",security_type_desc:"Marketable",security_desc:"Total Marketable",avg_interest_rate_amt:"not-a-number"}
 ]})});
 const r=await a.lookup({security:"Total Marketable"});
 assert.equal(r.selected.averageInterestRatePercent,null);
});

test("Treasury transport failure throws source error",async()=>{
 const a=createTreasuryAverageRatesAdapter({fetchImpl:async()=>response({},503)});
 await assert.rejects(()=>a.lookup({security:"Total Marketable"}),e=>e.code==="SOURCE_HTTP_ERROR");
});
