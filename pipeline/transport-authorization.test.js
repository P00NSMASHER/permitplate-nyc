'use strict';

const assert=require('assert');
const auth=require('./transport-authorization');

function fixture(){
  const artifact={
    status:'READY',
    artifactFingerprint:'artifact-fp-1',
    signalKeys:['signal-1','signal-2']
  };
  const message={
    status:'READY',
    messageFingerprint:'message-fp-1',
    signalKeys:['signal-1','signal-2']
  };
  const attempt={
    state:'PLANNED',
    attemptId:'PP-ATTEMPT-1',
    messageIdentity:'PP-MSG-1',
    recipient:'buyer@example.com',
    signalKeys:['signal-1','signal-2']
  };
  const authorization=auth.buildAuthorizationReceipt({
    approved:true,
    authorizationType:'OWNER_EXPLICIT_SEND',
    approvalSource:'OWNER_CHAT_EXPLICIT',
    approvalNonce:'nonce-1',
    approvedAt:'2026-09-21T17:00:00Z',
    expiresAt:'2026-09-21T17:30:00Z',
    attemptId:attempt.attemptId,
    messageIdentity:attempt.messageIdentity,
    artifactFingerprint:artifact.artifactFingerprint,
    messageFingerprint:message.messageFingerprint,
    recipient:attempt.recipient,
    signalKeys:attempt.signalKeys
  });
  return {artifact,message,attempt,authorization};
}

{
  const f=fixture();
  const out=auth.validateTransportAuthorization({
    artifact:f.artifact,
    message:f.message,
    attempt:f.attempt,
    authorization:f.authorization,
    now:'2026-09-21T17:10:00Z'
  });
  assert.equal(out.allowed,true);
  assert.equal(out.failures.length,0);
  assert.equal(out.authorizationId,f.authorization.authorizationId);
  assert.match(out.authorizationId,/^AUTH:[0-9a-f]{24}$/);
}

{
  const f=fixture();
  const out=auth.validateTransportAuthorization({
    artifact:f.artifact,
    message:f.message,
    attempt:f.attempt,
    authorization:null,
    now:'2026-09-21T17:10:00Z'
  });
  assert.equal(out.allowed,false);
  assert(out.failures.includes('OWNER_AUTHORIZATION_MISSING'));
}

{
  const f=fixture();
  const bad=Object.assign({},f.authorization,{attemptId:'wrong'});
  const out=auth.validateTransportAuthorization({
    artifact:f.artifact,message:f.message,attempt:f.attempt,authorization:bad,
    now:'2026-09-21T17:10:00Z'
  });
  assert.equal(out.allowed,false);
  assert(out.failures.includes('ATTEMPT_ID_MISMATCH'));
  assert(out.failures.includes('AUTHORIZATION_ID_MISMATCH'));
}

{
  const f=fixture();
  const bad=Object.assign({},f.authorization,{messageFingerprint:'wrong'});
  const out=auth.validateTransportAuthorization({
    artifact:f.artifact,message:f.message,attempt:f.attempt,authorization:bad,
    now:'2026-09-21T17:10:00Z'
  });
  assert.equal(out.allowed,false);
  assert(out.failures.includes('MESSAGE_FINGERPRINT_MISMATCH'));
}

{
  const f=fixture();
  const out=auth.validateTransportAuthorization({
    artifact:f.artifact,message:f.message,attempt:f.attempt,authorization:f.authorization,
    now:'2026-09-21T17:31:00Z'
  });
  assert.equal(out.allowed,false);
  assert(out.failures.includes('AUTHORIZATION_EXPIRED'));
}

{
  const f=fixture();
  const bad=auth.buildAuthorizationReceipt({
    approved:true,authorizationType:'OWNER_EXPLICIT_SEND',
    approvalSource:'OWNER_CHAT_EXPLICIT',approvalNonce:'nonce-long',
    approvedAt:'2026-09-21T17:00:00Z',expiresAt:'2026-09-21T19:00:01Z',
    attemptId:f.attempt.attemptId,messageIdentity:f.attempt.messageIdentity,
    artifactFingerprint:f.artifact.artifactFingerprint,
    messageFingerprint:f.message.messageFingerprint,
    recipient:f.attempt.recipient,signalKeys:f.attempt.signalKeys
  });
  const out=auth.validateTransportAuthorization({
    artifact:f.artifact,message:f.message,attempt:f.attempt,authorization:bad,
    now:'2026-09-21T17:10:00Z'
  });
  assert.equal(out.allowed,false);
  assert(out.failures.includes('AUTHORIZATION_TTL_TOO_LONG'));
}

{
  const f=fixture();
  const future=auth.buildAuthorizationReceipt({
    approved:true,authorizationType:'OWNER_EXPLICIT_SEND',
    approvalSource:'OWNER_CHAT_EXPLICIT',approvalNonce:'nonce-future',
    approvedAt:'2026-09-21T17:20:00Z',expiresAt:'2026-09-21T17:40:00Z',
    attemptId:f.attempt.attemptId,messageIdentity:f.attempt.messageIdentity,
    artifactFingerprint:f.artifact.artifactFingerprint,
    messageFingerprint:f.message.messageFingerprint,
    recipient:f.attempt.recipient,signalKeys:f.attempt.signalKeys
  });
  const out=auth.validateTransportAuthorization({
    artifact:f.artifact,message:f.message,attempt:f.attempt,authorization:future,
    now:'2026-09-21T17:10:00Z'
  });
  assert.equal(out.allowed,false);
  assert(out.failures.includes('AUTHORIZATION_FROM_FUTURE'));
}

{
  const f=fixture();
  const out=auth.validateTransportAuthorization({
    artifact:f.artifact,message:f.message,attempt:f.attempt,authorization:f.authorization,
    now:'2026-09-21T17:10:00Z',
    consumedAuthorizationIds:[f.authorization.authorizationId]
  });
  assert.equal(out.allowed,false);
  assert(out.failures.includes('AUTHORIZATION_ALREADY_CONSUMED'));
}

{
  const f=fixture();
  const reversed=auth.buildAuthorizationReceipt({
    approved:true,authorizationType:'OWNER_EXPLICIT_SEND',
    approvalSource:'OWNER_CHAT_EXPLICIT',approvalNonce:'nonce-reverse',
    approvedAt:'2026-09-21T17:00:00Z',expiresAt:'2026-09-21T17:30:00Z',
    attemptId:f.attempt.attemptId,messageIdentity:f.attempt.messageIdentity,
    artifactFingerprint:f.artifact.artifactFingerprint,
    messageFingerprint:f.message.messageFingerprint,
    recipient:f.attempt.recipient,signalKeys:['signal-2','signal-1']
  });
  const out=auth.validateTransportAuthorization({
    artifact:f.artifact,message:f.message,attempt:f.attempt,authorization:reversed,
    now:'2026-09-21T17:10:00Z'
  });
  assert.equal(out.allowed,false);
  assert(out.failures.includes('SIGNAL_SET_MISMATCH'));
}

{
  const f=fixture();
  assert.throws(()=>auth.buildAuthorizationReceipt({
    approved:false,
    authorizationType:'OWNER_EXPLICIT_SEND'
  }),/approved=true/);
  assert.throws(()=>auth.buildAuthorizationReceipt({
    approved:true,
    authorizationType:'OTHER'
  }),/OWNER_EXPLICIT_SEND/);
}

{
  const f=fixture();
  const a=auth.buildAuthorizationReceipt({
    approved:true,authorizationType:'OWNER_EXPLICIT_SEND',
    approvalSource:'OWNER_CHAT_EXPLICIT',approvalNonce:'same',
    approvedAt:'2026-09-21T17:00:00Z',expiresAt:'2026-09-21T17:30:00Z',
    attemptId:f.attempt.attemptId,messageIdentity:f.attempt.messageIdentity,
    artifactFingerprint:f.artifact.artifactFingerprint,
    messageFingerprint:f.message.messageFingerprint,
    recipient:'BUYER@EXAMPLE.COM',signalKeys:f.attempt.signalKeys
  });
  const b=auth.buildAuthorizationReceipt({
    approved:true,authorizationType:'OWNER_EXPLICIT_SEND',
    approvalSource:'OWNER_CHAT_EXPLICIT',approvalNonce:'same',
    approvedAt:'2026-09-21T17:00:00Z',expiresAt:'2026-09-21T17:30:00Z',
    attemptId:f.attempt.attemptId,messageIdentity:f.attempt.messageIdentity,
    artifactFingerprint:f.artifact.artifactFingerprint,
    messageFingerprint:f.message.messageFingerprint,
    recipient:'buyer@example.com',signalKeys:f.attempt.signalKeys
  });
  assert.equal(a.authorizationId,b.authorizationId);
}

console.log('PermitPlate transport authorization tests passed.');
