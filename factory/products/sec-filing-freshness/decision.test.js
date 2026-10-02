"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {assessFilingFreshness}=require("./decision");

const COMPANY={name:"Apple Inc.",cik:"0000320193",tickers:["AAPL"]};

test("filing inside window returns recent_filing",()=>{
 const r=assessFilingFreshness({available:true,found:true,company:COMPANY,filings:[{form:"8-K",filingDate:"2026-10-01"}]},{maxAgeDays:30,now:"2026-10-02T12:00:00Z"});
 assert.equal(r.decision,"recent_filing");
 assert.equal(r.recentFilingCount,1);
});

test("filing outside window returns no_recent_filing",()=>{
 const r=assessFilingFreshness({available:true,found:true,company:COMPANY,filings:[{form:"10-Q",filingDate:"2026-08-01"}]},{maxAgeDays:30,now:"2026-10-02T12:00:00Z"});
 assert.equal(r.decision,"no_recent_filing");
 assert.equal(r.recentFilingCount,0);
});

test("cutoff day counts as recent",()=>{
 const r=assessFilingFreshness({available:true,found:true,company:COMPANY,filings:[{form:"8-K",filingDate:"2026-09-02"}]},{maxAgeDays:30,now:"2026-10-02T00:00:00Z"});
 assert.equal(r.decision,"recent_filing");
});

test("company not found is explicit completed outcome",()=>{
 const r=assessFilingFreshness({available:true,found:false,company:null,filings:[]},{maxAgeDays:30,now:"2026-10-02T00:00:00Z"});
 assert.equal(r.decision,"company_not_found");
 assert.ok(r.reasonCodes.includes("SEC_COMPANY_NOT_FOUND"));
});
