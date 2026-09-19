# PermitPlate Model V7
Updated: 2026-09-19

## Design goal
Convert official public records into auditable material-change intelligence without allowing a commercially attractive score to hide weak identity resolution or weak evidence.

## Core objects
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
5. the vendor score meets the customer's threshold,
6. the same customer/entity/change fingerprint was not already delivered.

## Material reopen examples
- new source system corroborates the entity,
- stage advances,
- permit/license status materially changes,
- corrected/superseding record changes the known facts,
- category-specific physical evidence appears,
- a prior weak event becomes strong enough to pass the evidence gate.

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

## Implementation order
1. Stable entity and source-event schema.
2. Resolution benchmark / false-join corpus.
3. State hash + material-change detector.
4. Versioned score rules.
5. Historical replay fixtures.
6. Customer feedback and outcome loop.
7. Additional markets only after model-specific validation.
