'use strict';

const crypto=require('crypto');

const TRANSPORT_AUTHORIZATION_VERSION='PermitPlate-transport-authorization-v1.0.0';
const MAX_AUTHORIZATION_TTL_MS=60*60*1000;

function stableStringify(value){
  if(Array.isArray(value)) return '['+value.map(stableStringify).join(',')+']';
  if(value&&typeof value==='object'){
    return '{'+Object.keys(value).sort()
      .map((key)=>JSON.stringify(key)+':'+stableStringify(value[key])).join(',')+'}';
  }
  return JSON.stringify(value);
}
function sha256(value){
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}
function text(value){ return value==null?'':String(value).trim(); }
function instant(value){
  const ms=Date.parse(text(value));
  return Number.isFinite(ms)?ms:null;
}
function sameArray(a,b){
  return stableStringify((a||[]).map(String))===stableStringify((b||[]).map(String));
}

function buildAuthorizationReceipt(input){
  const data=input||{};
  if(data.approved!==true) throw new Error('explicit approved=true required');
  if(data.authorizationType!=='OWNER_EXPLICIT_SEND') {
    throw new Error('authorizationType must be OWNER_EXPLICIT_SEND');
  }
  const core={
    authorizationVersion:TRANSPORT_AUTHORIZATION_VERSION,
    authorizationType:'OWNER_EXPLICIT_SEND',
    approved:true,
    approvalSource:text(data.approvalSource)||'OWNER_EXPLICIT',
    approvalNonce:text(data.approvalNonce),
    approvedAt:text(data.approvedAt),
    expiresAt:text(data.expiresAt),
    attemptId:text(data.attemptId),
    messageIdentity:text(data.messageIdentity),
    artifactFingerprint:text(data.artifactFingerprint),
    messageFingerprint:text(data.messageFingerprint),
    recipient:text(data.recipient).toLowerCase(),
    signalKeys:Array.isArray(data.signalKeys)?data.signalKeys.map(String):[]
  };
  if(!core.approvalNonce) throw new Error('approvalNonce required');
  const authorizationId='AUTH:'+sha256(stableStringify(core)).slice(0,24);
  return Object.assign(core,{authorizationId});
}

function validateTransportAuthorization(input){
  const data=input||{};
  const attempt=data.attempt||{};
  const artifact=data.artifact||{};
  const message=data.message||{};
  const authorization=data.authorization;
  const failures=[];

  if(attempt.state!=='PLANNED') failures.push('ATTEMPT_NOT_PLANNED');
  if(artifact.status!=='READY') failures.push('ARTIFACT_NOT_READY');
  if(message.status!=='READY') failures.push('MESSAGE_NOT_READY');

  if(!authorization){
    failures.push('OWNER_AUTHORIZATION_MISSING');
    return {allowed:false,failures,authorizationId:null};
  }
  if(authorization.authorizationVersion!==TRANSPORT_AUTHORIZATION_VERSION){
    failures.push('AUTHORIZATION_VERSION_INVALID');
  }
  if(authorization.authorizationType!=='OWNER_EXPLICIT_SEND'||authorization.approved!==true){
    failures.push('OWNER_EXPLICIT_APPROVAL_REQUIRED');
  }

  const approvedAt=instant(authorization.approvedAt);
  const expiresAt=instant(authorization.expiresAt);
  const nowMs=instant(data.now||new Date().toISOString());
  if(approvedAt===null) failures.push('APPROVED_AT_INVALID');
  if(expiresAt===null) failures.push('EXPIRES_AT_INVALID');
  if(nowMs===null) failures.push('NOW_INVALID');
  if(approvedAt!==null&&expiresAt!==null){
    if(expiresAt<=approvedAt) failures.push('AUTHORIZATION_EXPIRY_INVALID');
    if(expiresAt-approvedAt>MAX_AUTHORIZATION_TTL_MS) failures.push('AUTHORIZATION_TTL_TOO_LONG');
  }
  if(approvedAt!==null&&nowMs!==null&&approvedAt>nowMs) failures.push('AUTHORIZATION_FROM_FUTURE');
  if(expiresAt!==null&&nowMs!==null&&nowMs>expiresAt) failures.push('AUTHORIZATION_EXPIRED');

  if(text(authorization.attemptId)!==text(attempt.attemptId)) failures.push('ATTEMPT_ID_MISMATCH');
  if(text(authorization.messageIdentity)!==text(attempt.messageIdentity)){
    failures.push('MESSAGE_IDENTITY_MISMATCH');
  }
  if(text(authorization.artifactFingerprint)!==text(artifact.artifactFingerprint)){
    failures.push('ARTIFACT_FINGERPRINT_MISMATCH');
  }
  if(text(authorization.messageFingerprint)!==text(message.messageFingerprint)){
    failures.push('MESSAGE_FINGERPRINT_MISMATCH');
  }
  if(text(authorization.recipient).toLowerCase()!==text(attempt.recipient).toLowerCase()){
    failures.push('RECIPIENT_MISMATCH');
  }
  if(!sameArray(authorization.signalKeys,attempt.signalKeys)){
    failures.push('SIGNAL_SET_MISMATCH');
  }
  if(!sameArray(message.signalKeys,attempt.signalKeys)){
    failures.push('MESSAGE_SIGNAL_SET_MISMATCH');
  }
  if(!sameArray(artifact.signalKeys,attempt.signalKeys)){
    failures.push('ARTIFACT_SIGNAL_SET_MISMATCH');
  }

  let expectedId=null;
  try{
    expectedId=buildAuthorizationReceipt({
      approved:authorization.approved,
      authorizationType:authorization.authorizationType,
      approvalSource:authorization.approvalSource,
      approvalNonce:authorization.approvalNonce,
      approvedAt:authorization.approvedAt,
      expiresAt:authorization.expiresAt,
      attemptId:authorization.attemptId,
      messageIdentity:authorization.messageIdentity,
      artifactFingerprint:authorization.artifactFingerprint,
      messageFingerprint:authorization.messageFingerprint,
      recipient:authorization.recipient,
      signalKeys:authorization.signalKeys
    }).authorizationId;
  }catch(error){
    failures.push('AUTHORIZATION_RECEIPT_INVALID');
  }
  if(expectedId&&text(authorization.authorizationId)!==expectedId){
    failures.push('AUTHORIZATION_ID_MISMATCH');
  }

  const consumed=data.consumedAuthorizationIds instanceof Set?
    data.consumedAuthorizationIds:new Set(data.consumedAuthorizationIds||[]);
  if(authorization.authorizationId&&consumed.has(authorization.authorizationId)){
    failures.push('AUTHORIZATION_ALREADY_CONSUMED');
  }

  return {
    authorizationVersion:TRANSPORT_AUTHORIZATION_VERSION,
    allowed:failures.length===0,
    failures,
    authorizationId:authorization.authorizationId||null
  };
}

module.exports={
  TRANSPORT_AUTHORIZATION_VERSION,
  MAX_AUTHORIZATION_TTL_MS,
  stableStringify,
  sha256,
  text,
  instant,
  sameArray,
  buildAuthorizationReceipt,
  validateTransportAuthorization
};
