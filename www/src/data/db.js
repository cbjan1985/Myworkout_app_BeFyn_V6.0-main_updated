// Data access: a small adapter interface (IndexedDB in the app, in-memory in tests) and repositories on top.
// All multi-record changes go through `transact`, which is atomic: either every write lands or none does.
import { clone, ok, fail } from '../core/util.js';

export const DB_NAME = 'befyn';
export const SCHEMA_VERSION = 1;

/** store name -> { keyPath, indexes: { indexName: keyPath } } */
export const STORES = {
  meta: { keyPath: 'key', indexes: {} },
  prefs: { keyPath: 'key', indexes: {} },
  templates: { keyPath: 'key', indexes: { tid: 'id' } },          // key = `${id}@${version}`
  exercises: { keyPath: 'id', indexes: { category: 'category' } },
  workouts: { keyPath: 'id', indexes: { category: 'category' } }, // saved standalone workouts
  instances: { keyPath: 'id', indexes: { status: 'status' } },
  scheduled: { keyPath: 'id', indexes: { instanceId: 'instanceId', date: 'date' } },
  changes: { keyPath: 'id', indexes: { instanceId: 'instanceId' } },
  logs: { keyPath: 'id', indexes: { date: 'date', instanceId: 'instanceId', scheduledId: 'scheduledId' } },
  measurements: { keyPath: 'id', indexes: { type: 'type', date: 'date' } },
  health: { keyPath: 'id', indexes: { type: 'type', ext: 'extKey' } },
  nutrition: { keyPath: 'id', indexes: { date: 'date' } },
  reminders: { keyPath: 'id', indexes: {} },
};

/* ------------------------------ memory adapter (tests, fallback) ------------------------------ */
export function memoryAdapter() {
  /** @type {Record<string, Map<any, any>>} */
  const data = Object.fromEntries(Object.keys(STORES).map((s) => [s, new Map()]));
  const keyOf = (store, v) => v[STORES[store].keyPath];
  return {
    kind: 'memory',
    async get(store, key) { const v = data[store].get(key); return v === undefined ? undefined : clone(v); },
    async getAll(store) { return [...data[store].values()].map(clone); },
    async getByIndex(store, index, value) { const kp = STORES[store].indexes[index]; return [...data[store].values()].filter((v) => v[kp] === value).map(clone); },
    async transact(writes) {
      const stage = new Map(); // validate first: all or nothing
      for (const w of writes) {
        if (!STORES[w.store]) throw new Error(`Unknown store ${w.store}`);
        if (w.op === 'put' && keyOf(w.store, w.value) === undefined) throw new Error(`Missing key for ${w.store}`);
      }
      for (const w of writes) { if (!stage.has(w.store)) stage.set(w.store, new Map(data[w.store])); }
      for (const w of writes) {
        const m = stage.get(w.store);
        if (w.op === 'put') m.set(keyOf(w.store, w.value), clone(w.value));
        else if (w.op === 'delete') m.delete(w.key);
        else if (w.op === 'clear') m.clear();
      }
      for (const [s, m] of stage) data[s] = m;
    },
    async close() {},
  };
}

/* ------------------------------ IndexedDB adapter ------------------------------ */
export function indexedDbAdapter(name = DB_NAME, factory = globalThis.indexedDB) {
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((resolve, reject) => {
    if (!factory) { reject(new Error('IndexedDB is not available in this WebView.')); return; }
    const req = factory.open(name, SCHEMA_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [s, def] of Object.entries(STORES)) {
        if (db.objectStoreNames.contains(s)) continue;
        const os = db.createObjectStore(s, { keyPath: def.keyPath });
        for (const [ix, kp] of Object.entries(def.indexes)) os.createIndex(ix, kp, { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Database upgrade is blocked by another open window.'));
  }));
  const wrap = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  return {
    kind: 'indexeddb',
    async get(store, key) { const db = await open(); return wrap(db.transaction(store).objectStore(store).get(key)); },
    async getAll(store) { const db = await open(); return wrap(db.transaction(store).objectStore(store).getAll()); },
    async getByIndex(store, index, value) { const db = await open(); return wrap(db.transaction(store).objectStore(store).index(index).getAll(value)); },
    async transact(writes) {
      const db = await open();
      const names = [...new Set(writes.map((w) => w.store))];
      if (!names.length) return;
      await new Promise((res, rej) => {
        const tx = db.transaction(names, 'readwrite');
        tx.oncomplete = () => res(undefined);
        tx.onerror = () => rej(tx.error);
        tx.onabort = () => rej(tx.error || new Error('Database transaction aborted.'));
        try {
          for (const w of writes) {
            const os = tx.objectStore(w.store);
            if (w.op === 'put') os.put(w.value); else if (w.op === 'delete') os.delete(w.key); else if (w.op === 'clear') os.clear();
          }
        } catch (e) { try { tx.abort(); } catch (_) { /* already finished */ } rej(e); }
      });
    },
    async close() { if (dbp) (await dbp).close(); dbp = null; },
  };
}

/* ------------------------------ repositories ------------------------------ */
const tkey = (id, version) => `${id}@${version}`;
const put = (store, value) => ({ op: 'put', store, value });
const del = (store, key) => ({ op: 'delete', store, key });

export function createRepos(adapter) {
  const A = adapter;
  const repos = {
    adapter: A,
    write: (writes) => A.transact(writes),
    put, del,

    meta: {
      get: async (key) => (await A.get('meta', key))?.value,
      set: (key, value) => A.transact([put('meta', { key, value })]),
      op: (key, value) => put('meta', { key, value }),
    },
    prefs: {
      async all() { const rows = await A.getAll('prefs'); return Object.fromEntries(rows.map((r) => [r.key, r.value])); },
      async get(key, dflt) { const r = await A.get('prefs', key); return r ? r.value : dflt; },
      set: (key, value) => A.transact([put('prefs', { key, value })]),
      op: (key, value) => put('prefs', { key, value }),
    },

    templates: {
      async get(id, version) { return A.get('templates', tkey(id, version)); },
      async versions(id) { return (await A.getByIndex('templates', 'tid', id)).sort((a, b) => b.version - a.version); },
      async all() { return A.getAll('templates'); },
      async latestPublished(id) { return (await this.versions(id)).find((t) => t.status === 'published') || null; },
      /** Published versions are immutable. Drafts can be overwritten. */
      async save(t) {
        const existing = await A.get('templates', tkey(t.id, t.version));
        if (existing && existing.status === 'published') return fail('immutable', 'A published programme version cannot be edited. Create a new version instead.');
        await A.transact([put('templates', { ...t, key: tkey(t.id, t.version) })]);
        return ok();
      },
      op: (t) => put('templates', { ...t, key: tkey(t.id, t.version) }),
      /** Archiving a template never touches instances or logs that reference it. */
      async archive(id) {
        const vs = await this.versions(id);
        await A.transact(vs.map((v) => put('templates', { ...v, status: v.status === 'published' ? 'archived' : v.status, archivedFrom: v.status })));
      },
    },

    exercises: {
      get: (id) => A.get('exercises', id), all: () => A.getAll('exercises'),
      op: (e) => put('exercises', e),
      async search(q = '', { category = '', muscle = '', equipment = '' } = {}) {
        const s = q.trim().toLowerCase();
        return (await A.getAll('exercises')).filter((e) =>
          (!s || e.name.toLowerCase().includes(s) || (e.primaryMuscles || []).some((m) => m.toLowerCase().includes(s))) &&
          (!category || e.category === category) &&
          (!muscle || (e.primaryMuscles || []).concat(e.secondaryMuscles || []).some((m) => m.toLowerCase().includes(muscle.toLowerCase()))) &&
          (!equipment || (e.equipment || []).includes(equipment))).sort((a, b) => a.name.localeCompare(b.name));
      },
      /** Prevents duplicate definitions: returns the existing exercise with the same normalised name, if any. */
      async findDuplicate(name, exceptId) {
        const n = name.toLowerCase().replace(/[^a-z0-9]+/g, '');
        return (await A.getAll('exercises')).find((e) => e.id !== exceptId && e.name.toLowerCase().replace(/[^a-z0-9]+/g, '') === n) || null;
      },
    },

    workouts: { get: (id) => A.get('workouts', id), all: () => A.getAll('workouts'), op: (w) => put('workouts', w), delOp: (id) => del('workouts', id) },

    instances: {
      get: (id) => A.get('instances', id), all: () => A.getAll('instances'),
      async active() { return (await A.getAll('instances')).find((i) => i.status === 'active' || i.status === 'paused') || null; },
      op: (i) => put('instances', i),
    },

    scheduled: {
      byInstance: (id) => A.getByIndex('scheduled', 'instanceId', id),
      get: (id) => A.get('scheduled', id),
      op: (s) => put('scheduled', s), delOp: (id) => del('scheduled', id),
    },

    changes: {
      async byInstance(id) { return (await A.getByIndex('changes', 'instanceId', id)).sort((a, b) => (a.at < b.at ? 1 : -1)); },
      op: (c) => put('changes', c),
    },

    logs: {
      get: (id) => A.get('logs', id), all: async () => (await A.getAll('logs')).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
      byDate: (d) => A.getByIndex('logs', 'date', d), byInstance: (id) => A.getByIndex('logs', 'instanceId', id),
      /** Logs are append-only: a normal save refuses to overwrite an existing log. Corrections use `correct`. */
      async append(log) {
        if (await A.get('logs', log.id)) return fail('append-only', 'Workout history is never overwritten. Use a correction to amend it.');
        await A.transact([put('logs', log)]); return ok();
      },
      appendOp: (log) => put('logs', log),
      /** Explicit, auditable correction: keeps the previous version inside `revisions`. */
      async correct(id, patch, reason) {
        const cur = await A.get('logs', id); if (!cur) return fail('not-found', 'That workout log no longer exists.');
        const { revisions, ...snapshot } = cur;
        const next = { ...cur, ...patch, id, revisions: [...(revisions || []), { at: new Date().toISOString(), reason: reason || 'Correction', previous: snapshot }] };
        await A.transact([put('logs', next)]); return ok({ log: next });
      },
    },

    measurements: {
      all: async () => (await A.getAll('measurements')).sort((a, b) => (a.date < b.date ? 1 : -1)),
      byType: async (t) => (await A.getByIndex('measurements', 'type', t)).sort((a, b) => (a.date < b.date ? 1 : -1)),
      op: (m) => put('measurements', m), delOp: (id) => del('measurements', id),
    },
    health: {
      all: () => A.getAll('health'), byType: (t) => A.getByIndex('health', 'type', t),
      /** Deduplicates by source + external id so repeated syncs never double count. */
      async upsertMany(records) {
        const existing = new Map((await A.getAll('health')).map((r) => [r.extKey, r]));
        let added = 0, updated = 0; const writes = [];
        for (const r of records) {
          const prev = existing.get(r.extKey);
          if (prev) { if (JSON.stringify({ ...prev, syncedAt: 0 }) !== JSON.stringify({ ...prev, ...r, id: prev.id, syncedAt: 0 })) updated++; writes.push(put('health', { ...prev, ...r, id: prev.id })); }
          else { added++; writes.push(put('health', r)); }
        }
        await A.transact(writes); return { added, updated };
      },
      clearOp: () => ({ op: 'clear', store: 'health' }),
    },
    nutrition: {
      all: () => A.getAll('nutrition'), byDate: (d) => A.getByIndex('nutrition', 'date', d),
      op: (n) => put('nutrition', n), delOp: (id) => del('nutrition', id),
    },
    reminders: { all: () => A.getAll('reminders'), op: (r) => put('reminders', r), delOp: (id) => del('reminders', id) },

    /** Persist an instance + its sessions + an optional change record in one atomic write. */
    instanceStateOps(state, change) {
      const ops = [put('instances', state.instance), ...state.sessions.map((s) => put('scheduled', s))];
      if (change) ops.push(put('changes', change));
      return ops;
    },
    async saveInstanceState(state, change, removedIds = []) {
      await A.transact([...removedIds.map((id) => del('scheduled', id)), ...this.instanceStateOps(state, change)]);
    },
    async loadInstanceState(id) {
      const instance = await A.get('instances', id); if (!instance) return null;
      const sessions = (await A.getByIndex('scheduled', 'instanceId', id)).sort((a, b) => a.seq - b.seq || a.run - b.run);
      return { instance, sessions };
    },
  };
  return repos;
}

/** Row counts for verification (migration, backup). */
export async function counts(repos) {
  const out = {};
  for (const s of Object.keys(STORES)) out[s] = (await repos.adapter.getAll(s)).length;
  return out;
}
