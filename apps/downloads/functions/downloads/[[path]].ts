interface Env {
  RELEASES: R2Bucket;
}

interface PagesContext {
  request: Request;
  env: Env;
  params: { path?: string | string[] };
}

const RELEASE_VERSIONS = ['0.2.2', '0.2.1', '0.2', '0.1.7', '0.1.6', '0.1.5', '0.1.4', '0.1.3', '0.1.2', '0.1.1', '0.1.0'] as const;
const LINUX_MANIFEST = /^nodo-linux(?:-[^/]+)?\.json$/u;
const LINUX_MANIFEST_KEY = 'nodo-linux.json';

const asObjectKey = (path: string | string[] | undefined): string => {
  const pathname = Array.isArray(path) ? path.join('/') : (path ?? '');
  // There is one mutable manifest for Linux. Versioned/legacy filenames are
  // compatibility aliases only; nodes never need to walk old releases.
  if (LINUX_MANIFEST.test(pathname.split('/').at(-1) ?? '')) return LINUX_MANIFEST_KEY;
  const version = RELEASE_VERSIONS.find((candidate) => pathname.includes(candidate));
  const release = version ? `v${version}` : 'v0.1.3';
  return `${release}/${pathname}`;
};

const cacheControl = (key: string): string =>
  key.endsWith('.json') ? 'no-store, max-age=0' : 'public, max-age=3600, immutable';

export const onRequest = async ({ request, env, params }: PagesContext): Promise<Response> => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }

  const key = asObjectKey(params.path);
  if (key.endsWith('/')) return new Response('Not found', { status: 404 });

  if (request.method === 'HEAD') {
    const metadata = await env.RELEASES.head(key);
    if (metadata === null) return new Response('Not found', { status: 404 });

    const headers = new Headers();
    metadata.writeHttpMetadata(headers);
    headers.set('etag', metadata.httpEtag);
    headers.set('accept-ranges', 'bytes');
    headers.set('cache-control', cacheControl(key));
    headers.set('content-length', String(metadata.size));
    headers.set('content-disposition', `attachment; filename="${key.split('/').at(-1)}"`);
    return new Response(null, { headers });
  }

  const object = await env.RELEASES.get(key, {
    range: request.headers,
  });
  if (object === null) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('accept-ranges', 'bytes');
  headers.set('cache-control', cacheControl(key));
  headers.set('content-disposition', `attachment; filename="${key.split('/').at(-1)}"`);

  if ('range' in object && object.range) {
    const { offset, length } = object.range;
    headers.set('content-range', `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set('content-length', String(length));
  } else {
    headers.set('content-length', String(object.size));
  }

  return new Response(object.body, {
    status: 'range' in object && object.range ? 206 : 200,
    headers,
  });
};
