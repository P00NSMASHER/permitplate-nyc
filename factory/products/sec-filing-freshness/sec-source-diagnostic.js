"use strict";

const urls=[
  "https://www.sec.gov/files/company_tickers.json",
  "https://data.sec.gov/submissions/CIK0000320193.json"
];

async function main(){
  for(const url of urls){
    try{
      const r=await fetch(url,{headers:{
        "user-agent":"x402-product-factory/0.1 https://github.com/P00NSMASHER/permitplate-nyc",
        "accept":"application/json"
      }});
      console.log(JSON.stringify({
        url,status:r.status,ok:r.ok,
        server:r.headers.get("server"),
        contentType:r.headers.get("content-type"),
        retryAfter:r.headers.get("retry-after")
      }));
      const text=await r.text();
      console.log(text.slice(0,600).replace(/\s+/g," "));
    }catch(e){
      console.log(JSON.stringify({url,error:String(e)}));
    }
  }
}
main();
