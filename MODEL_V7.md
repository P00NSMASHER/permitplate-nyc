# PermitPlate Model V7
Updated: 2026-09-19

## Design goal
Convert official public records into auditable material-change intelligence without allowing a commercially attractive score to hide weak identity resolution or weak evidence.

## Runtime version
Current deterministic decision runtime: `PermitPlate-v7.1.0`.

V7.1 adds typed source-observation receipts, fail-closed absence handling, and a deterministic Opportunity Decision receipt. It does not by itself prove that every live connector supplies complete receipt metadata; delivery operations treat that rollout separately.

## Core objects
### SourceObservation
- observation_id
- source_id
- connector_config_hash
- observed_at
- source_fresh: boolean
- transport / HTTP state
- redirect / moved-source metadata
- intended_full_scope: boolean
- publisher_count (when independently available)
- fetched_count
- cursor_closed
- schema_fingerprint
- raw_page_hashes
- computed state: VERIFIED_EMPTY | COMPLETE_NONEMPTY | PARTIAL | SOURCE_UNAVAILABLE | SOURCE_MOVED | UNKNOWN

Only VERIFIED_EMPTY or COMPLETE_NONEMPTY can support an absence-based close/delete/suppress/retire decision, and only when the source is fresh and the observation scope matches the entity being evaluated. A positive record observed in a PARTIAL window can still be useful evidence; partial coverage simply cannot prove absence.

### Entity
- entity_id
- canonical_name
- normalized_address
- geography
- entity_type
- commercial_fit
- status
- first_seen_at
- last_seen_at

### SourceEvent
- source_event_id
- entity_id (nullable until safely resolved)
- source_system
- source_record_id
- source_url
- source_effective_date
- observed_at
- source_revision_fingerprint
- event_type
- normalized_facts
- raw_fact_references
- source_freshness_state

### ResolutionEvidence
- source_event_id
- candidate_entity_id
- exact_identifier_match
- normalized_name_similarity
- normalized_address_match
- unit_or_tenant_match
- source_specific_keys
- contradictory_evidence
- resolution_confidence
- resolution_status: RESOLVED | REVIEW | UNRESOLVED

### OpportunityState
- entity_id
- prior_state_hash
- current_state_hash
- material_change_type
- material_change_at
- lifecycle_stage
- watch_next
- evidence_strength
- identity_confidence
- reopened: boolean

### OpportunityDecision
- model_version
- decision: DELIVER | REVIEW | HOLD
- reasons[]
- replay_fingerprint
- source_observation result
- resolution result
- material-change result
- vendor score
- source-lineage completeness
- delivery-gate result

The decision receipt is deterministic for the same normalized inputs. It is intended to replace prompt-only orchestration with replayable application logic. The replay fingerprint is a deterministic state fingerprint, not a cryptographic signature.

### VendorScore
Per category:
- change_recency_materiality: 0-30
- lifecycle_timing_urgency: 0-25
- category_relevance: 0-25
- evidence_strength: 0-20
- total: 0-100

Scoring occurs only after resolution/evidence gates pass.

## Delivery gate
Deliver only when:
1. entity resolution is safe enough for customer use,
2. commercial fit is not excluded,
3. the event is post-baseline OR represents a qualifying material reopen,
4. source freshness is acceptable,
5. the source observation state is usable for the positive record (COMPLETE_NONEMPTY or PARTIAL),
6. source record ID + HTTPS source URL lineage are present,
7. a material change exists,
8. the vendor score meets the customer's threshold,
9. the same customer/entity/change fingerprint was not already delivered.

## Material reopen examples
- new source system corroborates the entity,
- stage advances,
- permit/license status materially changes,
- corrected/superseding record changes the known facts,
- category-specific physical evidence appears,
- a prior weak event becomes strong enough to pass the evidence gate.

## Absence safety
Never infer a closure, disappearance, retirement, or suppression merely because a request returned zero rows. Absence mutation requires a fresh, scope-matched SourceObservation whose computed state is VERIFIED_EMPTY or COMPLETE_NONEMPTY. SOURCE_UNAVAILABLE, SOURCE_MOVED, PARTIAL, and UNKNOWN preserve the prior opportunity state.

## Non-events
Do not create a new customer signal for:
- unchanged re-fetches,
- duplicate source rows,
- weak spelling/name variants of the same record,
- building-level work that cannot be tied to the venue,
- a high commercial score with unresolved identity,
- old backlog presented as new.

## Feedback dispositions
- INVESTIGATE
- WATCH
- IRRELEVANT
- ALREADY_KNEW

Feedback can tune customer-specific filters and thresholds but never mutates source facts.

## Implementation status / next order
Implemented in deterministic code:
1. Entity resolution and contradiction gating.
2. State hashing + material-change detection.
3. Typed SourceObservation classification.
4. Fail-closed absence mutation gate.
5. Versioned Opportunity Decision receipt with deterministic replay fingerprint.
6. Vendor-score and delivery-gate composition.

Next:
1. Emit SourceObservation receipts from every live connector.
2. Persist receipt IDs alongside SourceEvents and delivery artifacts.
3. Make delivery verification fail closed once receipt coverage reaches 100% of production sources.
4. Add historical replay fixtures spanning source moves, partial pagination, schema change, and corrected records.
5. Add customer feedback/outcome loop without mutating source truth.
6. Expand markets only after source-specific validation.
