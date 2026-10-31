'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const origin='https://permitplate.retallyrecovery.com';
const source=fs.readFileSync(path.resolve(__dirname,'../functions/api/trial-request.js'),'utf8');
const modulePromise=import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
class FakeD1 {
  constructor(){this.rates=new Map();this.requests=new Map();this.calls=[];this.fail=false;}
  prepare(sql){
    this.calls.push(sql);
    const db=this;
    return {bind(...params){
      return {
        async first(){
          if(db.fail)throw Error('DB_FAILURE');
          if(sql.startsWith('INSERT INTO trial_intake_limits')){
            const [bucket,expires,now]=params;
            const existing=db.rates.get(bucket);
            const attempts=existing&&existing.expires>now?existing.attempts+1:1;
            db.rates.set(bucket,{expires,attempts});
            return {attempts};
          }
          if(sql.includes('COUNT(*) AS count')){
            return {count:[...db.requests.values()].filter(x=>x.status==='PENDING').length};
          }
          throw Error('Unexpected read SQL '+sql);
        },
        async run(){
          if(db.fail)throw Error('DB_FAILURE');
          if(sql.startsWith('INSERT OR IGNORE INTO trial_intake_requests')){
            const [reference,name,domain,website,email,category,territory,now]=params;
            const existed=db.requests.has(domain);
            if(!existed)db.requests.set(domain,{reference,name,domain,website,email,category,territory,now,status:'PENDING'});
            return {success:true,meta:{changes:existed?0:1}};
          }
          throw Error('Unexpected write SQL '+sql);
        }
      };
    }};
  }
}
// D1 supports parameterless prepare(sql).first() as well as bound statements.
// The test double must match both real API shapes, including failures.
const originalPrepare=FakeD1.prototype.prepare;
FakeD1.prototype.prepare=function(sql){
  const statement=originalPrepare.call(this,sql);
  statement.first=()=>statement.bind().first();
  return statement;
};
const eligible={
  businessName:'Fictional Kitchen Supply',website:'https://www.vendor-customer.com/about?utm=abc',
  email:'owner@vendor-customer.com',category:'equipment',territory:'Brooklyn',consent:true,fax:''
};
function env(db=new FakeD1()){return {TRIAL_REQUEST_DB:db,TRIAL_INTAKE_ENABLED:'1',TRIAL_INTAKE_RATE_SECRET:'a'.repeat(64)};}
function request(body,overrides={}){
  return new Request(origin+'/api/trial-request',{method:'POST',
    headers:{Origin:origin,'Sec-Fetch-Site':'same-origin','Content-Type':'application/json',
      'CF-Connecting-IP':'198.51.100.41',...(overrides.headers||{})},
    body:typeof body==='string'?body:JSON.stringify(body)});
}
async function json(res){return {code:res.status,body:await res.json(),headers:res.headers};}
test('health refuses unprovisioned backend, never leaks records or secrets',async()=>{
  const {onRequestGet}=await modulePromise;
  const blocked=await json(await onRequestGet({env:{}}));
  assert.equal(blocked.code,503);
  assert.equal(blocked.body.status,'REQUEST_INTAKE_UNAVAILABLE');
  const live=await json(await onRequestGet({env:env()}));
  assert.equal(live.code,200);
  assert.deepEqual(live.body,{status:'REQUEST_INTAKE_READY'});
  assert(!JSON.stringify(live.body).includes('TRIAL_INTAKE_RATE_SECRET'));
});
test('one validated request persists privately; duplicate domain does not consume another slot',async()=>{
  const {onRequestPost}=await modulePromise,d=new FakeD1(),e=env(d);
  const first=await json(await onRequestPost({request:request(eligible),env:e}));
  assert.equal(first.code,202);
  assert.equal(first.body.status,'RECEIVED_FOR_REVIEW');
  assert.equal(first.headers.get('Cache-Control'),'no-store,max-age=0');
  assert.equal(first.headers.get('Access-Control-Allow-Origin'),null);
  assert.equal(d.requests.size,1);
  const saved=[...d.requests.values()][0];
  assert.equal(saved.domain,'vendor-customer.com');
  assert.equal(saved.website,'https://www.vendor-customer.com');
  assert.equal(saved.email,'owner@vendor-customer.com');
  assert.equal(saved.status,'PENDING');
  assert.equal(saved.category,'equipment');
  const repeat=await json(await onRequestPost({request:request({...eligible,email:'other@vendor-customer.com'}),env:e}));
  assert.equal(repeat.code,202);
  assert.equal(d.requests.size,1);
  assert.deepEqual(repeat.body,first.body,'duplicate must not reveal prior applicant');
  assert.equal(d.rates.size,1);
});
test('invalid origin, method context, missing db and unsupported content type fail closed',async()=>{
  const {onRequestPost}=await modulePromise,d=new FakeD1(),e=env(d);
  assert.equal((await onRequestPost({request:request(eligible),env:{...e,TRIAL_INTAKE_ENABLED:'0'}})).status,503);
  assert.equal((await onRequestPost({request:request(eligible,{headers:{Origin:'https://other.example'}}),env:e})).status,403);
  assert.equal((await onRequestPost({request:request(eligible,{headers:{'Sec-Fetch-Site':'cross-site'}}),env:e})).status,403);
  assert.equal((await onRequestPost({request:request(eligible,{headers:{'Content-Type':'text/plain'}}),env:e})).status,415);
  assert.equal(d.requests.size,0);
});
test('adversarial invalid payload and honeypot never enter private request table',async()=>{
  const {onRequestPost}=await modulePromise,d=new FakeD1(),e=env(d);
  const invalid=[
    {website:'http://vendor-customer.com'},
    {website:'https://127.0.0.1/private'},
    {website:'https://user:pass@vendor-customer.com'},
    {website:'https://vendor-customer.com:1234'},
    {email:'bad.email'},
    {email:'Bcc:\r\nbuyer@vendor.com'},
    {category:'premium'},
    {territory:'New Jersey'},
    {consent:false},
    {businessName:'X'},
    {businessName:'bad\nBcc: malicious@vendor.com'},
    {arbitraryFlag:'ownerApproved'},
  ];
  for(const override of invalid){
    const result=await onRequestPost({request:request({...eligible,...override}),env:e});
    assert.equal(result.status,400,'Expected refusal for '+JSON.stringify(override));
  }
  assert.equal(d.requests.size,0);
  const trap=await json(await onRequestPost({request:request({...eligible,fax:'please contact me'}),env:e}));
  assert.equal(trap.code,400);
  assert.equal(trap.body.status,'NOT_RECEIVED');
  assert.equal(d.requests.size,0,'honeypot must not persist');
  const big=await onRequestPost({request:request(JSON.stringify({...eligible,extra:'x'.repeat(4000)})),env:e});
  assert.equal(big.status,413);
});
test('pseudonymous per-IP rate limit rejects sixth daily request without storing it',async()=>{
  const {onRequestPost}=await modulePromise,d=new FakeD1(),e=env(d);
  for(let i=0;i<5;i++){
    const r=await onRequestPost({request:request({...eligible,website:'https://vendor-'+i+'.com',
      businessName:'Fictional Vendor '+i,email:'owner'+i+'@vendor.com'}),env:e});
    assert.equal(r.status,202);
  }
  const rejected=await json(await onRequestPost({request:request({...eligible,website:'https://another-vendor.com'}),env:e}));
  assert.equal(rejected.code,429);
  assert.equal(d.requests.size,5);
  const savedKey=[...d.rates.keys()][0];
  assert.match(savedKey,/^[0-9a-f]{64}$/);
  assert(!savedKey.includes('198.51.100.41'));
});
test('storage outages and manually saturated review queues never emit a success receipt',async()=>{
  const {onRequestPost}=await modulePromise,d=new FakeD1(),e=env(d);
  d.fail=true;
  let r=await json(await onRequestPost({request:request(eligible),env:e}));
  assert.equal(r.code,503);
  d.fail=false;
  for(let i=0;i<150;i++)d.requests.set('vendor-'+i+'.com',{status:'PENDING'});
  r=await json(await onRequestPost({request:request(eligible),env:e}));
  assert.equal(r.code,503);
  assert.equal(r.body.status,'NOT_RECEIVED');
  assert.equal(d.requests.size,150);
});
test('public and privileged paths never provide automatic enroll, send or charge authority',()=>{
  assert(!/\b(?:stripe|emailProvider|sendMail|paymentIntent|subscribe|createSubscription)\s*\(/i.test(source));
  assert(!/return\s+reply\(20[01]/.test(source),'acknowledgment must be 202, not enrolled');
  assert(source.includes("env?.TRIAL_INTAKE_ENABLED==='1'"));
  assert(source.includes("request.headers.get('origin')!==ORIGIN"));
  assert(source.includes('crypto.subtle.sign'));
});
