export default async () =>
  new Response(
    JSON.stringify({
      ok: true,
      service: 'agent-data-tools-x402',
      runtime: 'netlify',
      appDeployDependency: false,
    }),
    {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    }
  );

export const config = { path: '/_api/health' };
