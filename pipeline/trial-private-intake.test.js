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
          if(sql.startsWith('SELECT 1 AS existing FROM trial_intake_requests WHERE business_domain=')){
            return db.requests.has(params[0])?{existing:1}:null;
          }
          throw Error('Unexpected read SQL '+sql);
        },
        async run(){
          if(db.fail)throw Error('DB_FAILURE');
          if(sql.startsWith('INSERT OR IGNORE INTO trial_intake_requests')){
            const [reference,name,domain,website,email,category,territory,now]=params;
            const existed=db.requests.has(domain);
            const cap=params[8]; // undefined for old unguarded INSERT (negative control).
            const pending=[...db.requests.values()].filter(x=>x.status==='PENDING').length;
            const allowed=cap===undefined||pending<cap;
            if(!existed&&allowed)db.requests.set(domain,{reference,name,domain,website,email,category,territory,now,status:'PENDING'});
            return {success:true,meta:{changes:!existed&&allowed?1:0}};
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
  assert.equal(saved.website,'https://www.vendor-customer.com/about');
  assert(!saved.website.includes('utm=abc'),'request tracking query must not reach private state');
  assert.equal(saved.email,'owner@vendor-customer.com');
  assert.equal(saved.status,'PENDING');
  assert.equal(saved.category,'equipment');
  const repeat=await json(await onRequestPost({request:request({...eligible,email:'other@vendor-customer.com'}),env:e}));
  assert.equal(repeat.code,202);
  assert.equal(d.requests.size,1);
  assert.deepEqual(repeat.body,first.body,'duplicate must not reveal prior applicant');
  assert.equal(d.rates.size,1);
});
test('shared-host trial inquiries cannot report a false online receipt',async()=>{
  // On sites.google.com, different business pages share one database domain key.
  // The second buyer would receive 202 while their distinct request was not saved.
  // Redirect both to the manual-email fallback instead of risking silent lost demand.
  const {onRequestPost}=await modulePromise,d=new FakeD1(),e=env(d);
  const a={...eligible,website:'https://sites.google.com/view/fixture-a?utm_source=private#bio'};
  const b={...eligible,website:'https://sites.google.com/view/fixture-b?secret=yes'};
  const first=await json(await onRequestPost({request:request(a),env:e}));
  const second=await json(await onRequestPost({request:request(b),env:e}));
  for(const result of [first,second]){
    assert.equal(result.code,503);
    assert.equal(result.body.status,'NOT_RECEIVED');
    assert.equal(result.body.code,'SHARED_HOST_MANUAL_REVIEW');
  }
  assert.deepEqual(second.body,first.body,'shared-host applicants receive the same non-identifying fallback');
  assert.equal(d.requests.size,0,'no shared-host applicant can be falsely reported as durably recorded');
  assert.equal(d.calls.length,0,'manual fallback must cost zero production D1 reads');
  const ordinary=await json(await onRequestPost({request:request(eligible),env:e}));
  assert.equal(ordinary.code,202,'ordinary independent business domains keep working');
  assert.equal(d.requests.size,1);
});
test('social business profile hosts cannot silently lose a second applicant behind hostname deduplication',async()=>{
  // Facebook and Instagram host unrelated vendors at different URL paths.
  // UNIQUE(business_domain) otherwise admits only the first and returns
  // an identical misleading 202 to the second, whose request is never stored.
  const {onRequestPost}=await modulePromise;
  for(const host of ['www.facebook.com','www.instagram.com','linktr.ee']){
    const d=new FakeD1(),e=env(d);
    for(const path of ['fixture-vendor-a','fixture-vendor-b']){
      const result=await json(await onRequestPost({
        request:request({...eligible,website:'https://'+host+'/'+path}),env:e
      }));
      assert.equal(result.code,503,host+'/'+path+' must require a manual identity review');
      assert.equal(result.body.code,'SHARED_HOST_MANUAL_REVIEW');
    }
    assert.equal(d.requests.size,0,host+' must not store a misleading single shared-host record');
    assert.equal(d.calls.length,0,host+' should use the privacy-preserving zero-D1 manual fallback');
  }
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
test('concurrent arrivals at 149 pending cannot overflow the 150-record operator queue',async()=>{
  const {onRequestPost}=await modulePromise,d=new FakeD1(),e=env(d);
  for(let i=0;i<149;i++)d.requests.set('existing-'+i+'.example.org',{status:'PENDING'});
  // Both requests observe the *same* old 149 count. A separate preflight
  // check alone accepts both and silently overbooks the queue to 151.
  const rawPrepare=d.prepare.bind(d);
  let firstReads=0,release;
  const bothRead=new Promise(resolve=>{release=resolve;});
  d.prepare=function(sql){
    const stmt=rawPrepare(sql);
    if(sql.includes('COUNT(*) AS count')){
      const previous=stmt.first.bind(stmt);
      stmt.first=async()=>{
        const result=await previous();
        if(++firstReads===2)release();
        if(firstReads<=2)await bothRead;
        return result;
      };
    }
    return stmt;
  };
  const applicants=[0,1].map(n=>onRequestPost({
    request:request({...eligible,website:'https://race-'+n+'.com'}),
    env:e
  }));
  const statuses=(await Promise.all(applicants)).map(r=>r.status).sort();
  assert.deepEqual(statuses,[202,503],
    'one of two concurrent validated requests must fail closed when only one slot remains');
  assert.equal(firstReads,3,'both preflight reads and final capacity check must execute');
  assert.equal(d.requests.size,150);
  assert.equal([...d.requests.values()].filter(x=>x.status==='PENDING').length,150);
  assert(d.calls.some(sql=>sql.includes("SELECT ?1,?2,?3,?4,?5,?6,?7,?8,'PENDING'")&&
    sql.includes("WHERE (SELECT COUNT(*) FROM trial_intake_requests WHERE status='PENDING') < ?9")),
    'the bound-capacity guard must occur inside the insertion statement');
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

test('private trial intake refuses unreachable dot-atom work-email syntax without persisting',async()=>{
  const {onRequestPost}=await modulePromise,d=new FakeD1(),e=env(d);
  const invalid=['buyer..contact@vendor.example.com','.buyer@vendor.example.com',
    'buyer.@vendor.example.com','a'.repeat(65)+'@vendor.example.com'];
  for(const email of invalid){
    const result=await json(await onRequestPost({request:request({...eligible,email}),env:e}));
    assert.equal(result.code,400,email);
    assert.equal(result.body.code,'EMAIL_INVALID',email);
  }
  assert.equal(d.requests.size,0,'invalid contact addresses must never reach the private queue');
  const valid=await onRequestPost({
    request:request({...eligible,email:'first.last+sales@vendor-customer.com'}),env:e});
  assert.equal(valid.status,202,'valid tagged business contacts remain supported');
  assert.equal(d.requests.size,1);
});


test('private intake rejects oversize public domain and DEL control name without storing anything',async()=>{
  const {onRequestPost}=await modulePromise,d=new FakeD1(),e=env(d);
  const hugeHost=['a'.repeat(63),'b'.repeat(63),'c'.repeat(63),'d'.repeat(60),'com'].join('.');
  assert.equal(hugeHost.length,256);
  for(const override of [
    {website:'https://'+hugeHost},
    {businessName:'Acme\x7f Partners'},
  ]){
    const r=await json(await onRequestPost({request:request({...eligible,...override}),env:e}));
    assert.equal(r.code,400,'invalid value cannot create pending receipt');
  }
  assert.equal(d.requests.size,0);
  const accepted=await onRequestPost({request:request({...eligible,businessName:'Cafe\u0301 Supplies'}),env:e});
  assert.equal(accepted.status,202);
  assert.equal([...d.requests.values()][0].name,'Caf\u00e9 Supplies');
});


test('skipped insertion without matching duplicate never claims customer request was received',async()=>{
  const {onRequestPost}=await modulePromise,d=new FakeD1(),e=env(d);
  const original=d.prepare.bind(d);
  d.prepare=function(sql){
    const statement=original(sql);
    if(sql.startsWith('INSERT OR IGNORE INTO trial_intake_requests')){
      statement.bind=()=>({run:async()=>({success:true,meta:{changes:0}})});
    }
    return statement;
  };
  const failed=await json(await onRequestPost({request:request(eligible),env:e}));
  assert.equal(d.requests.size,0,'no database record exists for this accepted-looking input');
  assert.equal(failed.code,503,'ignored nonduplicate insert must fail closed, not claim receipt');
  assert.equal(failed.body.status,'NOT_RECEIVED');
  assert.equal(failed.body.code,'STORAGE_UNAVAILABLE');
});

test('mobile subdomains of shared profile hosts cannot falsely acknowledge distinct applicants',async()=>{
  const {onRequestPost}=await modulePromise;
  // Exact-host protection must not be bypassed by supported mobile host aliases.
  for(const host of ['m.facebook.com','l.facebook.com','m.instagram.com']){
    const d=new FakeD1(),e=env(d);
    for(const suffix of ['fictional-vendor-one','fictional-vendor-two']){
      const result=await json(await onRequestPost({
        request:request({...eligible,website:'https://'+host+'/'+suffix}),env:e
      }));
      assert.equal(result.code,503,host+' must not acknowledge a profile request by domain alone');
      assert.equal(result.body.code,'SHARED_HOST_MANUAL_REVIEW');
    }
    assert.equal(d.requests.size,0,'shared hostname must never consume another business\'s slot');
    assert.equal(d.calls.length,0,'shared-profile fallback must consume zero D1 reads');
  }
});
