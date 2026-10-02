import { runVendorGateFixture } from '../../../x402-rehost-core.mjs';

export default async (req) => {
  const url = new URL(req.url);
  const sampleCase = url.searchParams.get('case') ?? 'proceed';
  if (!['proceed', 'address_mismatch', 'domain_mismatch'].includes(sampleCase)) {
    return new Response(JSON.stringify({ error: 'unknown_fixture' }), {
      status: 400,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }

  try {
    const result = await runVendorGateFixture(sampleCase);
    return new Response(
      JSON.stringify({
        ...result,
        demo: true,
        paid: false,
        sampleInput: true,
        sampleCase,
      }),
      {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      }
    );
  } catch {
    return new Response(
      JSON.stringify({
        error: 'The live vendor-intake sample could not complete all evidence checks.',
      }),
      {
        status: 502,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      }
    );
  }
};

export const config = { path: '/_api/vendor-intake-demo' };
