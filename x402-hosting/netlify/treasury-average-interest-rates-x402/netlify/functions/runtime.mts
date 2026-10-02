type LegacyResponse = {
  statusCode?: number;
  headers?: Record<string, string>;
  body?: string;
};

type RouteContext = {
  query: Record<string, string>;
  event: Record<string, unknown>;
  request: Request;
};

type RouteHandler = (context: RouteContext) => unknown | Promise<unknown>;
type RouteMap = Record<string, RouteHandler[]>;

export function json(value: unknown, statusCode = 200): LegacyResponse {
  return {
    statusCode,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(value),
  };
}

export function error(message: string, statusCode = 500): LegacyResponse {
  return json({ error: message }, statusCode);
}

function responseFromLegacy(value: unknown): Response {
  if (value instanceof Response) return value;
  if (!value || typeof value !== 'object') {
    return new Response(value == null ? '' : String(value), { status: 200 });
  }
  const legacy = value as LegacyResponse;
  const headers = new Headers();
  for (const [key, val] of Object.entries(legacy.headers ?? {})) {
    headers.set(key, String(val));
  }
  return new Response(legacy.body ?? '', {
    status: legacy.statusCode ?? 200,
    headers,
  });
}

function defaultOptions(): Response {
  return new Response('', {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers':
        'PAYMENT-SIGNATURE, X-PAYMENT, Content-Type, Accept',
      'access-control-expose-headers':
        'PAYMENT-REQUIRED, PAYMENT-RESPONSE, x402-settled, x402-price, x402-network, x402-asset, x402-pay-to, Retry-After',
      'cache-control': 'no-store',
    },
  });
}

export function router(routes: RouteMap) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    let key = method + ' ' + url.pathname;
    let handlers = routes[key];

    if (!handlers && method === 'GET') {
      const aliases = new Set([
        '/.well-known/x402-services.json',
        '/.well-known/x402-service.json',
        '/.well-known/x402-catalog.json',
      ]);
      if (aliases.has(url.pathname)) {
        handlers =
          routes['GET /.well-known/x402.json'] ??
          routes['GET /.well-known/x402'];
      }
    }

    if (!handlers && method === 'OPTIONS') return defaultOptions();
    if (!handlers) return responseFromLegacy(error('Not found.', 404));

    const query: Record<string, string> = {};
    for (const [name, value] of url.searchParams.entries()) {
      if (!(name in query)) query[name] = value;
    }

    const headers: Record<string, string> = {};
    request.headers.forEach((value, name) => {
      headers[name] = value;
    });

    const event = {
      headers,
      httpMethod: method,
      path: url.pathname,
      rawPath: url.pathname,
      rawQueryString: url.searchParams.toString(),
      requestContext: { http: { method, path: url.pathname } },
    };

    try {
      for (const routeHandler of handlers) {
        const result = await routeHandler({ query, event, request });
        if (result !== undefined) return responseFromLegacy(result);
      }
      return new Response('', { status: 204 });
    } catch (err) {
      console.error('Unhandled seller route error', err);
      return responseFromLegacy(error('Internal server error.', 500));
    }
  };
}
