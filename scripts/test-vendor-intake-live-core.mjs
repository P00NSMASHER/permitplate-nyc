import { runVendorIntakeGate } from '../recovery/vendor-intake-core.mjs';

const cases = [
  {
    name: 'proceed',
    input: {
      name: 'OpenAI OpCo',
      address: '600 North Second Street, Suite 401, Harrisburg, PA 17101',
      domain: 'openai.com',
    },
    decision: 'proceed',
    trigger: null,
  },
  {
    name: 'address_mismatch',
    input: {
      name: 'OpenAI OpCo',
      address: '4600 Silver Hill Rd, Washington, DC 20233',
      domain: 'openai.com',
    },
    decision: 'human_review',
    trigger: 'registered_address_differs',
  },
  {
    name: 'domain_mismatch',
    input: {
      name: 'OpenAI OpCo',
      address: '600 North Second Street, Suite 401, Harrisburg, PA 17101',
      domain: 'example.com',
    },
    decision: 'human_review',
    trigger: 'domain_name_not_aligned',
  },
];

let passed = 0;

for (const fixture of cases) {
  const started = Date.now();
  try {
    const result = await runVendorIntakeGate(fixture.input);
    const codes = result.reviewTriggers.map((item) => item.code);
    const decisionOk = result.decision === fixture.decision;
    const triggerOk = fixture.trigger
      ? codes.includes(fixture.trigger)
      : codes.length === 0;
    const evidenceComplete =
      result.evidence.registry.complete === true &&
      result.evidence.address.providedEvidenceComplete === true &&
      result.evidence.ofac.complete === true &&
      result.evidence.domain.complete === true;
    const ok = decisionOk && triggerOk && evidenceComplete;

    console.log(
      `${ok ? 'PASS' : 'FAIL'} ${fixture.name} decision=${result.decision} triggers=${codes.join(',') || 'none'} latencyMs=${Date.now() - started}`
    );

    if (!decisionOk) {
      console.log(
        `  - decision=${result.decision} expected=${fixture.decision}`
      );
    }
    if (!triggerOk) {
      console.log(
        `  - trigger mismatch expected=${fixture.trigger ?? 'none'} actual=${codes.join(',') || 'none'}`
      );
    }
    if (!evidenceComplete) {
      console.log('  - one or more required evidence families were incomplete');
    }

    if (ok) passed += 1;
  } catch (error) {
    console.log(
      `FAIL ${fixture.name} error=${error instanceof Error ? error.message : String(error)}`
    );
  }
}

console.log(`SUMMARY ${passed}/${cases.length} live vendor-gate cases passed`);
if (passed !== cases.length) process.exitCode = 1;
