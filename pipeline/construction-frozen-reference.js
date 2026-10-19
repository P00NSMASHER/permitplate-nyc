'use strict';

// Immutable private reference for the first governed, source-rich DOB review.
// Once initialized, neither the reviewer packet nor its separately reserved
// audit can be regenerated, overwritten, rebalanced or combined with scoring.
const research=require('./curated-research-ledger');
const blind=require('./construction-blind-diagnostic');

const VERSION='PermitPlate-construction-frozen-reference-v1.0.0';
const PARTS=['panel','reviewerPacket','reservedAudit','manifest'];
function allOrNone(parts){
  const count=PARTS.filter(p=>parts&&parts[p]!=null).length;
  return count===0?'NONE':count===PARTS.length?'ALL':'PARTIAL';
}
function seal(parts,now,origin){
  if(allOrNone(parts)!=='ALL')return {status:'REVIEW',failures:['CONSTRUCTION_FROZEN_SOURCE_INCOMPLETE']};
  if(!['EXISTING_VERIFIED_PRIVATE_SNAPSHOT','CURRENT_VERIFIED_SOURCE_SNAPSHOT'].includes(origin)||
     !research.instant(now)||Date.parse(now)<Date.parse(parts.panel.sourceObservedAt)||
     !blind.verify({
       status:'READY_FOR_REAL_REVIEW',
       reviewerPacket:parts.reviewerPacket,
       reservedAudit:parts.reservedAudit,
       manifest:parts.manifest
     },parts.panel).valid){
    return {status:'REVIEW',failures:['CONSTRUCTION_FROZEN_SOURCE_INVALID']};
  }
  const core={
    version:VERSION,
    status:'IMMUTABLE_PRIVATE_CONSTRUCTION_AUDIT_REFERENCE',
    createdAt:now,
    originalSourceObservedAt:parts.panel.sourceObservedAt,
    origin,
    sourcePanelFingerprint:parts.panel.artifactFingerprint,
    reviewerPacketFingerprint:parts.reviewerPacket.packetFingerprint,
    reservedAuditFingerprint:parts.reservedAudit.reservedFingerprint,
    reviewCases:parts.reviewerPacket.cards.length,
    reservedCases:parts.reservedAudit.cases.length,
    reviewPremiseGroups:parts.manifest.reviewPremiseGroups,
    reservedPremiseGroups:parts.manifest.reservedPremiseGroups,
    originalScoringHoldoutCasesRead:0,
    reviewerAndReservedNeverCombined:true,
    simulatedReviewCount:0,
    genuineIndependentReviewerCount:0,
    customerDeliveryAllowed:false,
    scoringPromotionAuthorized:false
  };
  return {status:'FROZEN',parts,anchor:{
    ...core,anchorFingerprint:research.hash(core)
  }};
}
function validate(frozen){
  const f=frozen||{},issues=[];
  if(allOrNone(f)!=='ALL'||!f.anchor||f.anchor.version!==VERSION||
     f.anchor.status!=='IMMUTABLE_PRIVATE_CONSTRUCTION_AUDIT_REFERENCE'){
    return {valid:false,failures:['CONSTRUCTION_FROZEN_REFERENCE_INCOMPLETE']};
  }
  const {anchorFingerprint,...body}=f.anchor;
  if(anchorFingerprint!==research.hash(body))issues.push('CONSTRUCTION_FROZEN_ANCHOR_INVALID');
  const verified=blind.verify({
    status:'READY_FOR_REAL_REVIEW',
    reviewerPacket:f.reviewerPacket,reservedAudit:f.reservedAudit,
    manifest:f.manifest
  },f.panel);
  if(!verified.valid)issues.push('CONSTRUCTION_FROZEN_SOURCE_UNVERIFIED');
  if(f.anchor.originalSourceObservedAt!==f.panel.sourceObservedAt||
     f.anchor.sourcePanelFingerprint!==f.panel.artifactFingerprint||
     f.anchor.reviewerPacketFingerprint!==f.reviewerPacket.packetFingerprint||
     f.anchor.reservedAuditFingerprint!==f.reservedAudit.reservedFingerprint||
     f.anchor.reviewCases!==f.reviewerPacket.cards.length||
     f.anchor.reservedCases!==f.reservedAudit.cases.length||
     f.anchor.reviewPremiseGroups!==f.manifest.reviewPremiseGroups||
     f.anchor.reservedPremiseGroups!==f.manifest.reservedPremiseGroups||
     f.anchor.originalScoringHoldoutCasesRead!==0||
     f.anchor.reviewerAndReservedNeverCombined!==true||
     f.anchor.simulatedReviewCount!==0||
     f.anchor.genuineIndependentReviewerCount!==0||
     f.anchor.customerDeliveryAllowed!==false||
     f.anchor.scoringPromotionAuthorized!==false){
    issues.push('CONSTRUCTION_FROZEN_REFERENCE_MISMATCH');
  }
  return {valid:issues.length===0,failures:[...new Set(issues)]};
}
function sameLegacy(current,reference){
  // The source-rich diagnostic panel is intentionally refreshed daily.
  // Only the three historical reviewer/reserve artifacts are immutable.
  // Compare them independently of the rolling current diagnostic panel.
  return allOrNone(current)==='ALL'&&
    ['reviewerPacket','reservedAudit','manifest'].every(k=>
      research.hash(current[k])===research.hash(reference[k]));
}
function choose({previousFrozen,legacy,current,now}){
  const existing=allOrNone(previousFrozen||{});
  if(existing==='PARTIAL')return {
    status:'REVIEW',failures:['CONSTRUCTION_FROZEN_ARCHIVE_PARTIAL']};
  if(existing==='ALL'){
    const verified=validate(previousFrozen);
    if(!verified.valid)return {status:'REVIEW',failures:verified.failures};
    // Frozen reference must still match the historical legacy review
    // files, not a newly regenerated moving audit.
    if(!sameLegacy(legacy,previousFrozen)){
      return {status:'REVIEW',failures:['CONSTRUCTION_LEGACY_AUDIT_WAS_CHANGED']};
    }
    return {status:'FROZEN_ALREADY',newlyFrozen:false,
      frozen:previousFrozen};
  }
  const old=allOrNone(legacy||{});
  if(old==='PARTIAL')return {
    status:'REVIEW',failures:['CONSTRUCTION_LEGACY_SNAPSHOT_PARTIAL']};
  const usePrevious=old==='ALL';
  const parts=usePrevious?legacy:current;
  const sealed=seal(parts,now,usePrevious?
    'EXISTING_VERIFIED_PRIVATE_SNAPSHOT':'CURRENT_VERIFIED_SOURCE_SNAPSHOT');
  if(sealed.status!=='FROZEN')return sealed;
  const archive={...parts,anchor:sealed.anchor};
  const verified=validate(archive);
  if(!verified.valid)return {status:'REVIEW',failures:verified.failures};
  return {status:'FROZEN_CREATED',newlyFrozen:true,
    originalLegacyExists:usePrevious,frozen:archive};
}
module.exports={VERSION,PARTS,allOrNone,seal,validate,sameLegacy,choose};
