import { blobAccess, blobConfigured } from './status.js';

/*
 * One JSON document in the private Vercel Blob store, shared by /api/tasks and /api/inbox.
 */

async function readStream(stream) {
  if (typeof stream.getReader === 'function') {
    const reader = stream.getReader();
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

/** JSON document in the private Blob store with optimistic concurrency (ETag / ifMatch). */
export function jsonBlobStore(key, env = process.env, label = 'blob') {
  return {
    key,
    kind: 'blob',
    configured: () => blobConfigured(env),
    async read() {
      const { get, head, BlobNotFoundError } = await import('@vercel/blob');
      // The ETag comes from head() (the Blob API), the same source put() checks ifMatch against.
      // If the document changes between head() and get(), the write fails the ifMatch check and retries,
      // so an update is never lost.
      let meta;
      try {
        meta = await head(key);
      } catch (error) {
        if (error instanceof BlobNotFoundError) return { doc: null, etag: null };
        throw error;
      }
      const file = await get(key, { access: blobAccess(env), useCache: false });
      if (!file || file.statusCode !== 200 || !file.stream) {
        const stale = new Error('conflict');
        stale.code = 'conflict';
        throw stale;
      }
      return { doc: JSON.parse(await readStream(file.stream)), etag: meta?.etag || file.blob?.etag || null };
    },
    async write(doc, etag) {
      const { put, BlobPreconditionFailedError } = await import('@vercel/blob');
      try {
        await put(key, JSON.stringify(doc), {
          access: blobAccess(env),
          addRandomSuffix: false,
          allowOverwrite: Boolean(etag),
          ...(etag ? { ifMatch: etag } : {}),
          contentType: 'application/json',
          cacheControlMaxAge: 60
        });
      } catch (error) {
        const precondition = error instanceof BlobPreconditionFailedError;
        if (precondition || /already exists/i.test(String(error?.message))) {
          console.warn(`${label}: write conflict (${precondition ? 'etag' : 'exists'})`);
          const conflict = new Error('conflict');
          conflict.code = 'conflict';
          throw conflict;
        }
        throw error;
      }
    }
  };
}

/** In-memory store for tests and the local dev server. */
export function memoryStore(initial = null) {
  let doc = initial ? structuredClone(initial) : null;
  let version = initial ? 1 : 0;
  return {
    key: 'memory',
    kind: 'memory',
    configured: () => true,
    async read() {
      return { doc: doc ? structuredClone(doc) : null, etag: doc ? String(version) : null };
    },
    async write(next, etag) {
      if ((etag || null) !== (doc ? String(version) : null)) {
        const conflict = new Error('conflict');
        conflict.code = 'conflict';
        throw conflict;
      }
      doc = structuredClone(next);
      version += 1;
    },
    peek: () => (doc ? structuredClone(doc) : null)
  };
}

