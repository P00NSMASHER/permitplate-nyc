// Cloudflare Pages Function: private, supervised free-trial REQUEST intake.
// No trial enrollment, provider sends, billing, Stripe or delivery authority.
const ORIGIN='https://permitplate.retallyrecovery.com';
const CATEGORIES=new Set(['pos','insurance','equipment','hoodfire','waste','pest','linen','distribution']);
const TERRITORIES=new Set(['AllNYC','Manhattan','Brooklyn','Queens','Bronx','StatenIsland',
  'ManhattanBrooklyn','ManhattanQueens','BrooklynQueens','ManhattanBronx',
  'ManhattanBrooklynQueens','BrooklynStatenIsland']);
const FIELDS=new Set(['businessName','website','email','category','territory','consent','fax']);
const MAX_BYTES=2048,MAX_IP_REQUESTS=5,MAX_PENDING=150;
const DISALLOWED=/(?:^|\.)(?:localhost|local|localdomain|internal|lan|home|test|example|invalid|onion)$/;
function reply(status,payload){return new Response(JSON.stringify(payload),{status,headers:{
  'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store,max-age=0',
  'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
  'Cross-Origin-Resource-Policy':'same-origin'}});}
const denied=(status,code,message)=>reply(status,{status:'NOT_RECEIVED',code,message});
const text=x=>typeof x==='string'?x.trim():'';
function domain(input){
  const d=text(input).toLowerCase().replace(/^www\./,'').replace(/\.$/,'');
  if(d.length>253||!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(d)||
      DISALLOWED.test(d))throw Error('WEBSITE_INVALID');
  return d;
}
function validate(raw){
  if(!raw||Array.isArray(raw)||typeof raw!=='object'||
    Object.keys(raw).some(k=>!FIELDS.has(k)))throw Error('FIELDS_INVALID');
  const businessName=text(raw.businessName).normalize('NFC');
  if(businessName.length<2||businessName.length>160||/[\u0000-\u001f\u007f<>]/.test(businessName))
    throw Error('BUSINESS_NAME_INVALID');
  let u;
  try{u=new URL(text(raw.website));}catch{throw Error('WEBSITE_INVALID');}
  if(u.protocol!=='https:'||u.username||u.password||u.port||!u.hostname.includes('.'))
    throw Error('WEBSITE_INVALID');
  const businessDomain=domain(u.hostname),email=text(raw.email).toLowerCase();
  if(email.length<6||email.length>254||!(/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,63}$/.test(email)))
    throw Error('EMAIL_INVALID');
  try{domain(email.slice(email.indexOf('@')+1));}catch{throw Error('EMAIL_INVALID');}
  if(!CATEGORIES.has(raw.category)||!TERRITORIES.has(raw.territory))throw Error('SCOPE_INVALID');
  if(raw.consent!==true)throw Error('CONTACT_CONSENT_REQUIRED');
  if(text(raw.fax).length>300)throw Error('FIELDS_INVALID');
  // Preserve a public page path for manual identity review on shared hosts.
  // Query strings and fragments may contain tracking or tokens, so never retain them.
  // Admission and duplicate suppression continue using businessDomain only.
  const website=u.origin+(u.pathname==='/'?'':u.pathname);
  if(website.length>700)throw Error('WEBSITE_INVALID');
  return {businessName,businessDomain,website,email,
    category:raw.category,territory:raw.territory,spam:!!text(raw.fax)};
}
async function boundedJSON(request){
  if(Number(request.headers.get('content-length')||0)>MAX_BYTES)throw Error('PAYLOAD_TOO_LARGE');
  if(!request.body)throw Error('FIELDS_INVALID');
  const reader=request.body.getReader();let size=0;const chunks=[];
  try{
    for(;;){
      const {value,done}=await reader.read();
      if(done)break;
      size+=value.byteLength;
      if(size>MAX_BYTES){await reader.cancel();throw Error('PAYLOAD_TOO_LARGE');}
      chunks.push(value);
    }
  }finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let at=0;
  for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{throw Error('FIELDS_INVALID');}
}
async function ipBucket(ip,secret,now){
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),
    {name:'HMAC',hash:'SHA-256'},false,['sign']);
  const day=new Date(now).toISOString().slice(0,10);
  const signature=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(day+'|'+ip));
  return Array.from(new Uint8Array(signature)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
const enabled=env=>env?.TRIAL_INTAKE_ENABLED==='1'&&env?.TRIAL_REQUEST_DB&&
  typeof env?.TRIAL_INTAKE_RATE_SECRET==='string'&&env.TRIAL_INTAKE_RATE_SECRET.length>=32;
export async function onRequestGet({env}){
  const yes=enabled(env);
  return reply(yes?200:503,{status:yes?'REQUEST_INTAKE_READY':'REQUEST_INTAKE_UNAVAILABLE'});
}
export async function onRequestPost({request,env}){
  if(!enabled(env))return denied(503,'TEMPORARILY_UNAVAILABLE','Online requests are temporarily unavailable. Please use email.');
  if(request.headers.get('origin')!==ORIGIN||
      (request.headers.get('sec-fetch-site')&&!['same-origin'].includes(request.headers.get('sec-fetch-site'))))
    return denied(403,'ORIGIN_REJECTED','Please use the official PermitPlate trial page.');
  if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type')||''))
    return denied(415,'CONTENT_TYPE_REJECTED','Please use the trial form.');
  const ip=request.headers.get('CF-Connecting-IP');
  if(!ip||ip.length>64)return denied(503,'REQUEST_CONTEXT_UNAVAILABLE','Please try again later.');
  let data;
  try{data=validate(await boundedJSON(request));}
  catch(e){const code=e?.message||'FIELDS_INVALID';return denied(code==='PAYLOAD_TOO_LARGE'?413:400,code,
    'Please check the business, website, contact email and territory.');}
  // Never show a genuine receipt when a bot-trap field prevented storage.
  if(data.spam)return denied(400,'REQUEST_NOT_ACCEPTED','Please review the request fields.');
  try{
    const db=env.TRIAL_REQUEST_DB,now=Date.now(),expires=now+86400000;
    const bucket=await ipBucket(ip,env.TRIAL_INTAKE_RATE_SECRET,now);
    const ratelimit=await db.prepare(
      'INSERT INTO trial_intake_limits(bucket,attempts,expires_at) VALUES(?1,1,?2) '+
      'ON CONFLICT(bucket) DO UPDATE SET '+
      'attempts=CASE WHEN expires_at<=?3 THEN 1 ELSE attempts+1 END, '+
      'expires_at=CASE WHEN expires_at<=?3 THEN ?2 ELSE expires_at END RETURNING attempts'
    ).bind(bucket,expires,now).first();
    if(!ratelimit||!Number.isInteger(ratelimit.attempts))
      return denied(503,'STORAGE_UNAVAILABLE','We could not confirm receipt. Please use email.');
    if(ratelimit.attempts>MAX_IP_REQUESTS)
      return denied(429,'TRY_LATER','Too many requests from this connection. Please use email.');
    const waiting=await db.prepare(
      "SELECT COUNT(*) AS count FROM trial_intake_requests WHERE status='PENDING'").first();
    if(!waiting||!Number.isInteger(waiting.count))
      return denied(503,'STORAGE_UNAVAILABLE','We could not confirm receipt. Please use email.');
    if(waiting.count>=MAX_PENDING)
      return denied(503,'MANUAL_REVIEW_QUEUE_FULL','Online requests are paused. Please use email.');
    const reference='PP-'+crypto.randomUUID().replace(/-/g,'').slice(0,16).toUpperCase();
    const saved=await db.prepare(
      "INSERT OR IGNORE INTO trial_intake_requests "+
      "(reference,business_name,business_domain,website,contact_email,category,territory,requested_at,status) "+
      "VALUES(?1,?2,?3,?4,?5,?6,?7,?8,'PENDING')"
    ).bind(reference,data.businessName,data.businessDomain,data.website,data.email,
      data.category,data.territory,now).run();
    if(!saved?.success)return denied(503,'STORAGE_UNAVAILABLE','We could not confirm receipt. Please use email.');
    // Duplicates intentionally share one neutral acknowledgment. Never reveal who applied.
    return reply(202,{status:'RECEIVED_FOR_REVIEW',
      message:'Your request is on file for manual review. This is not enrollment or a reserved spot.'});
  }catch{
    return denied(503,'STORAGE_UNAVAILABLE','We could not confirm receipt. Please use email.');
  }
}
