"use strict";

const TREASURY_API =
  "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/avg_interest_rates";
const SOURCE_TIMEOUT_MS = 10000;

async function fetchJson(fetchImpl,url,init={},timeoutMs=SOURCE_TIMEOUT_MS){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetchImpl(url,{...init,signal:controller.signal});
    if(!response||response.ok!==true){
      const error=new Error("treasury_http_"+(response?.status??"unknown"));
      error.code="SOURCE_HTTP_ERROR";
      throw error;
    }
    return await response.json();
  }finally{clearTimeout(timer);}
}

function normalizeSecurity(value){
  return String(value||"").trim().replace(/\s+/g," ");
}

function createTreasuryAverageRatesAdapter({fetchImpl=fetch,timeoutMs=SOURCE_TIMEOUT_MS}={}){
  return {async lookup({security}){
    const wanted=normalizeSecurity(security);
    if(wanted.length<2||wanted.length>100){
      const error=new Error("invalid_security");
      error.code="INVALID_INPUT";
      throw error;
    }

    const url=new URL(TREASURY_API);
    url.searchParams.set("fields","record_date,security_type_desc,security_desc,avg_interest_rate_amt");
    url.searchParams.set("sort","-record_date");
    url.searchParams.set("page[size]","100");

    const payload=await fetchJson(fetchImpl,url.toString(),{
      headers:{
        accept:"application/json",
        "user-agent":"x402-product-factory/0.1 https://github.com/P00NSMASHER/permitplate-nyc"
      }
    },timeoutMs);

    const rows=Array.isArray(payload?.data)?payload.data:null;
    if(!rows||rows.length===0){
      const error=new Error("treasury_no_data");
      error.code="SOURCE_CONTRACT_INVALID";
      throw error;
    }

    const recordDate=String(rows[0]?.record_date??"");
    if(!/^\d{4}-\d{2}-\d{2}$/.test(recordDate)){
      const error=new Error("treasury_record_date_invalid");
      error.code="SOURCE_CONTRACT_INVALID";
      throw error;
    }

    const latest=rows.filter(row=>String(row?.record_date??"")===recordDate);
    const needle=wanted.toLowerCase();

    const exact=latest.filter(row=>
      String(row?.security_desc??"").trim().toLowerCase()===needle
    );
    const candidates=exact.length>0?exact:latest.filter(row=>
      String(row?.security_desc??"").toLowerCase().includes(needle)
    );

    const normalized=candidates.map(row=>{
      const raw=row?.avg_interest_rate_amt;
      const rate=raw==null||raw===""?null:Number(raw);
      return {
        securityDescription:row?.security_desc??null,
        securityType:row?.security_type_desc??null,
        averageInterestRatePercent:Number.isFinite(rate)?rate:null
      };
    });

    return {
      available:true,
      recordDate,
      query:wanted,
      matchCount:normalized.length,
      ambiguous:normalized.length>1,
      found:normalized.length>0,
      selected:normalized.length===1?normalized[0]:null,
      matches:normalized,
      provenance:{
        source:"U.S. Treasury Fiscal Data — Average Interest Rates on U.S. Treasury Securities",
        url:TREASURY_API,
        frequency:"monthly"
      }
    };
  }};
}

module.exports={TREASURY_API,normalizeSecurity,createTreasuryAverageRatesAdapter};
