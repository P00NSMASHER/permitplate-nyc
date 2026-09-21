'use strict';

const assert=require('assert');
const p=require('./subscriber-profile');

{
  const out=p.normalizeProfile({
    subscriberId:'sub_123',
    recipientEmail:' Buyer@Example.COM ',
    baselineAt:'2026-09-21T12:00:00-04:00',
    categories:'POS/payments; Hood/Fire',
    boroughs:'Manhattan, Queens',
    minimumScore:'65',
    starterSnapshotEnabled:'false',
    status:'active'
  });
  assert.equal(out.status,'ACTIVE');
  assert.equal(out.profile.recipientEmail,'buyer@example.com');
  assert.equal(out.profile.baselineAt,'2026-09-21T16:00:00.000Z');
  assert.deepEqual(out.profile.categories,['POS','Hood/Fire']);
  assert.deepEqual(out.profile.boroughs,['Manhattan','Queens']);
  assert.equal(out.profile.minimumScore,65);
  assert.equal(out.profile.starterSnapshotEnabled,false);
  assert.match(out.profileFingerprint,/^[0-9a-f]{64}$/);
}

{
  const out=p.normalizeProfile({
    subscriberId:'sub_1',
    recipientEmail:'a@example.com',
    baselineAt:'2026-09-21T16:00:00Z',
    category:'Equipment'
  });
  assert.equal(out.status,'ACTIVE');
  assert.deepEqual(out.profile.boroughs,p.BOROUGH_ORDER);
  assert.equal(out.profile.minimumScore,60);
  assert.equal(out.profile.starterSnapshotEnabled,false);
  assert.equal(out.profile.starterDays,7);
  assert.equal(out.profile.starterLimit,10);
  assert.equal(out.profile.maxSignals,25);
}

{
  const out=p.fromSheetRow({
    Email:'a@example.com',
    Categories:'POS',
    'Boroughs/Territory':'ALL NYC',
    'Minimum Score':70,
    'Baseline At':'2026-09-21T16:00:00Z',
    'Starter Snapshot Enabled':'FALSE',
    'Stripe Subscription':'sub_1',
    Status:'active'
  });
  assert.equal(out.status,'ACTIVE');
  assert.equal(out.profile.starterSnapshotEnabled,false);
  assert.deepEqual(out.profile.boroughs,p.BOROUGH_ORDER);
}

{
  const out=p.fromSheetRow({
    Email:'a@example.com',
    Categories:'Equipment',
    'Boroughs/Territory':'Brooklyn',
    'Minimum Score':50,
    'Baseline At':'2026-09-21T16:00:00Z',
    'Starter Snapshot Enabled':'TRUE',
    'Stripe Subscription':'sub_1',
    Status:'trialing'
  });
  assert.equal(out.status,'ACTIVE');
  assert.equal(out.profile.starterSnapshotEnabled,true);
  assert.deepEqual(out.profile.boroughs,['Brooklyn']);
}

{
  const out=p.normalizeProfile({
    subscriberId:'sub_1',
    recipientEmail:'not-an-email',
    baselineAt:'bad-date',
    categories:'Unknown Vendor Category',
    boroughs:'Mars',
    minimumScore:101,
    starterDays:8,
    starterLimit:11,
    maxSignals:26
  });
  assert.equal(out.status,'REVIEW');
  assert(out.failures.includes('RECIPIENT_EMAIL_INVALID'));
  assert(out.failures.includes('BASELINE_INVALID'));
  assert(out.failures.some(x=>x.startsWith('CATEGORY_INVALID:')));
  assert(out.failures.some(x=>x.startsWith('BOROUGH_INVALID:')));
  assert(out.failures.includes('MINIMUM_SCORE_INVALID'));
  assert(out.failures.includes('STARTER_DAYS_INVALID'));
  assert(out.failures.includes('STARTER_LIMIT_INVALID'));
  assert(out.failures.includes('MAX_SIGNALS_INVALID'));
}

{
  const a=p.normalizeProfile({
    subscriberId:'sub_1',recipientEmail:'a@example.com',
    baselineAt:'2026-09-21T16:00:00Z',
    categories:['Equipment','POS'],boroughs:['Queens','Manhattan']
  });
  const b=p.normalizeProfile({
    subscriberId:'sub_1',recipientEmail:'A@EXAMPLE.COM',
    baselineAt:'2026-09-21T16:00:00.000Z',
    categories:['POS/payments','Equipment'],boroughs:['Manhattan','Queens']
  });
  assert.equal(a.status,'ACTIVE');
  assert.equal(b.status,'ACTIVE');
  assert.equal(a.profileFingerprint,b.profileFingerprint);
}

{
  assert.equal(p.canonicalCategory('POS/payments'),'POS');
  assert.equal(p.canonicalCategory('fire suppression'),'Hood/Fire');
  assert.equal(p.canonicalBorough('Kings County'),'Brooklyn');
  assert.equal(p.canonicalBorough('Richmond County'),'Staten Island');
  assert.equal(p.parseBoolean('FALSE',true),false);
  assert.equal(p.parseBoolean('yes',false),true);
}

console.log('PermitPlate subscriber profile contract tests passed.');
