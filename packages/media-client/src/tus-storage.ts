import { defaultOptions } from 'tus-js-client';

// tus-js-client persists the Location returned by Nodo. Older deployments
// returned HTTP URLs behind HTTPS, so normalize those before resuming.
export function uploadStorage(baseUrl: string, storage = defaultOptions.urlStorage) {
  const origin = new URL(baseUrl);
  const uploadPath = /^\/v1\/uploads\/[0-9a-f-]{36}$/i;

  return {
    findAllUploads: () => storage.findAllUploads(),
    async findUploadsByFingerprint(fingerprint: string) {
      const previous = await storage.findUploadsByFingerprint(fingerprint);
      const usable: typeof previous = [];
      for (const upload of previous) {
        let url: URL;
        try {
          url = new URL(upload.uploadUrl ?? '');
        } catch {
          await storage.removeUpload(upload.urlStorageKey);
          continue;
        }
        if (origin.protocol === 'https:' && url.protocol === 'http:' && url.host === origin.host) {
          url.protocol = 'https:';
        }
        if (url.origin !== origin.origin || !uploadPath.test(url.pathname) || url.search || url.hash) {
          await storage.removeUpload(upload.urlStorageKey);
          continue;
        }
        usable.push({ ...upload, uploadUrl: url.href });
      }
      return usable;
    },
    removeUpload: (key: string) => storage.removeUpload(key),
    addUpload: (fingerprint: string, upload: Parameters<typeof storage.addUpload>[1]) =>
      storage.addUpload(fingerprint, upload)
  };
}
