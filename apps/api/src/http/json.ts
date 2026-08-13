const JSON_HEADERS = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
} as const;

export function json(
  body: unknown,
  status = 200,
  headers?: HeadersInit,
): Response {
  const responseHeaders = new Headers(JSON_HEADERS);
  if (headers) {
    new Headers(headers).forEach((value, name) => responseHeaders.append(name, value));
  }
  return new Response(JSON.stringify(body), {
    headers: responseHeaders,
    status,
  });
}
