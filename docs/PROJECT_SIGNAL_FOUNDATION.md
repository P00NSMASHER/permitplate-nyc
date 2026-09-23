# ProjectSignal Foundation

## Purpose
Generalize PermitPlate from one NYC restaurant-opening use case into a reusable permit/property-event -> commercial-opportunity engine without weakening the current product.

## Non-negotiable gate before expansion
The known cross-entity/shared-site corroboration failure class must be closed first.

Regression case to preserve:
- unrelated/shared-site records must never corroborate one another merely because an address/site overlaps;
- known EASTHARLEM125 / DOB filing M01329447-I1 class must fail closed;
- KOKE remains LOW/audit-only unless independently supported by valid same-entity evidence;
- generalized cross-CAMIS suppression must be replay-tested across the full current venue graph.

No second jurisdiction work begins until this suite passes.

## Canonical ProjectSignal contract

```json
{
  "signal_id": "stable deterministic id",
  "jurisdiction": "NYC",
  "source_records": [],
  "property": {
    "address": null,
    "parcel_id": null,
    "building_id": null,
    "geo": null
  },
  "entities": {
    "owner": null,
    "operator": null,
    "contractor": null,
    "applicant": null
  },
  "event": {
    "event_type": null,
    "filing_date": null,
    "approval_date": null,
    "status": null,
    "permit_type": null,
    "work_description": null,
    "declared_value": null
  },
  "corroboration": {
    "entity_keys": [],
    "same_entity_only": true,
    "sources": [],
    "confidence": null,
    "reasons": []
  },
  "commercial_interpretation": {
    "project_stage": null,
    "industry_tags": [],
    "likely_purchases": [],
    "timing_window": null,
    "lead_score": null,
    "score_reasons": []
  },
  "provenance": {
    "source_urls": [],
    "retrieved_at": null,
    "pipeline_version": null
  }
}
```

## Corroboration rules
1. Address equality is evidence of co-location, not identity.
2. Cross-source corroboration requires at least one validated entity key beyond raw address where such a key exists.
3. CAMIS, BIN, BBL, application/permit ids, entity/operator identity, and temporal consistency must be treated as separate evidence dimensions.
4. A contradictory stable identifier suppresses corroboration.
5. Missing identity evidence produces WATCH/LOW confidence, never synthetic corroboration.
6. Every score contribution must expose its source evidence and reason.

## Adapter boundary
Each jurisdiction/source adapter emits normalized source records. No adapter may directly set a customer-facing commercial score.

```
Source Adapter
  -> Normalized SourceRecord
  -> Identity/Corroboration Engine
  -> ProjectSignal
  -> Commercial Category Mapper
  -> Customer-specific view/digest
```

## Commercial category mapping
Mappings should be evidence-constrained, e.g.:
- documented HVAC/mechanical work -> HVAC opportunity;
- documented kitchen/food-service construction -> restaurant equipment/cabinet/counter opportunity;
- demolition/large alteration -> waste/container opportunity;
- electrical scope -> electrical opportunity.

Do not infer a purchase category when the underlying work description does not support it.

## Release gates
- known false-match regression suite passes;
- full graph replay produces no newly introduced cross-entity corroboration;
- subscriber backlog semantics are deterministic;
- end-to-end subscriber canary passes;
- only then add a second jurisdiction adapter.
