'use strict';

function text(value) {
  return String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function address(value) {
  return text(value)
    .replace(/\bSTREET\b/g, 'ST')
    .replace(/\bAVENUE\b/g, 'AVE')
    .replace(/\bBOULEVARD\b/g, 'BLVD')
    .replace(/\bROAD\b/g, 'RD')
    .replace(/\bPLACE\b/g, 'PL')
    .replace(/\bAPARTMENT\b|\bSUITE\b|\bUNIT\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(value) {
  const stop = new Set(['LLC','INC','CORP','CORPORATION','CO','THE','RESTAURANT','BAR','CAFE','NYC','NEW','YORK']);
  return new Set(text(value).split(' ').filter(t => t.length >= 3 && !stop.has(t)));
}

function entitySimilarity(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let intersection = 0;
  for (const t of A) if (B.has(t)) intersection += 1;
  return intersection / Math.max(A.size, B.size);
}

const ID_FIELDS = ['camis', 'bin', 'bbl', 'licenseId', 'applicationId', 'permitId'];

function sameNonEmpty(a, b) {
  return a != null && b != null && String(a).trim() !== '' && String(b).trim() !== '' && String(a) === String(b);
}

function conflictingSameNamespaceIds(a, b) {
  return ID_FIELDS.filter(field => {
    const av = a[field], bv = b[field];
    return av != null && bv != null && String(av).trim() && String(bv).trim() && String(av) !== String(bv);
  });
}

function evaluateCorroboration(a, b) {
  const reasons = [];
  const conflicts = conflictingSameNamespaceIds(a, b);
  if (conflicts.length) {
    return { status: 'rejected', confidence: 'low', reasons: [`conflicting stable identifiers: ${conflicts.join(', ')}`] };
  }

  const sameAddress = address(a.address) && address(a.address) === address(b.address);
  const sameBuilding = sameNonEmpty(a.bin, b.bin) || sameNonEmpty(a.bbl, b.bbl);
  const sameDirectId = sameNonEmpty(a.camis, b.camis) || sameNonEmpty(a.licenseId, b.licenseId) || sameNonEmpty(a.applicationId, b.applicationId) || sameNonEmpty(a.permitId, b.permitId);
  const nameScore = Math.max(
    entitySimilarity(a.entityName, b.entityName),
    entitySimilarity(a.dba, b.dba),
    entitySimilarity(a.entityName, b.dba),
    entitySimilarity(a.dba, b.entityName),
  );
  const samePhone = sameNonEmpty(String(a.phone || '').replace(/\D/g,''), String(b.phone || '').replace(/\D/g,''));

  if (sameDirectId) reasons.push('shared stable source identifier');
  if (sameBuilding) reasons.push('shared building/parcel identifier');
  if (sameAddress) reasons.push('same normalized address');
  if (nameScore >= 0.6) reasons.push('strong entity-name overlap');
  if (samePhone) reasons.push('shared phone');

  if (sameDirectId && (sameAddress || sameBuilding || nameScore >= 0.6 || samePhone)) {
    return { status: 'corroborated', confidence: 'high', reasons };
  }

  const linkageCount = Number(sameAddress || sameBuilding) + Number(nameScore >= 0.6) + Number(samePhone);
  if (linkageCount >= 2 && (sameAddress || sameBuilding)) {
    return { status: 'corroborated', confidence: 'medium', reasons };
  }

  if (sameAddress || sameBuilding) {
    return { status: 'review', confidence: 'low', reasons: [...reasons, 'co-location alone does not establish entity identity'] };
  }

  return { status: 'rejected', confidence: 'low', reasons: reasons.length ? reasons : ['no sufficient identity linkage'] };
}

module.exports = { evaluateCorroboration, entitySimilarity, address };
