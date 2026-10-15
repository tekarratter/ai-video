/** Send one file to the server in 8 MB parts (Cloudflare caps a request at 100 MB). Resumes and retries on network errors.
 *  Returns the upload id to hand to an endpoint that consumes it (e.g. /api/projects/restore). */
const CHUNK = 8 * 1024 * 1024;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function uploadParts(file: File, onProgress?: (loaded: number, total: number) => void): Promise<string> {
  const id = `up_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  let offset = 0, tries = 0;
  while (offset < file.size || (file.size === 0 && offset === 0 && tries === 0)) {
    try {
      const r = await fetch(`/api/upload/part/${id}?offset=${offset}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: file.slice(offset, offset + CHUNK),
      });
      const j = await r.json().catch(() => ({}));
      if (r.status === 200 || r.status === 409) offset = Number(j.size) || 0;
      else if (r.status >= 400 && r.status < 500) throw Object.assign(new Error(`Lỗi ${r.status}: ${j.error || 'không rõ'}`), { fatal: true });
      else throw new Error(`Lỗi ${r.status}`);
      tries = 0;
      onProgress?.(offset, file.size);
      if (file.size === 0) break;
    } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      if (e.fatal || ++tries > 8) throw e;
      await sleep(Math.min(30_000, 1000 * 2 ** tries));
      try { const r = await fetch(`/api/upload/part/${id}`); if (r.ok) offset = Number((await r.json()).size) || 0; } catch { /* retry anyway */ }
    }
  }
  return id;
}
