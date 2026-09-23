// ============================================================================
// Persistence. Worlds live in IndexedDB (no size ceiling worth worrying about)
// with a localStorage mirror of the world *index* so the world list still
// renders instantly even before the database opens.
//
// A save holds: world metadata, the block delta from the generated world for
// every dimension, block entities (chests/furnaces), spawners, the player, the
// time of day and the weather. Reloading restores all of it exactly.
// ============================================================================

const DB_NAME = 'craftverse';
const DB_VERSION = 1;
const STORE = 'worlds';

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('IndexedDB unavailable')); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(mode) {
  return openDB().then((db) => db.transaction(STORE, mode).objectStore(STORE));
}

const wrap = (req) => new Promise((res, rej) => {
  req.onsuccess = () => res(req.result);
  req.onerror = () => rej(req.error);
});

export async function listWorlds() {
  try {
    const store = await tx('readonly');
    const all = await wrap(store.getAll());
    return all
      .map((w) => ({
        id: w.id, name: w.name, seed: w.seed, gamemode: w.gamemode,
        difficulty: w.difficulty, created: w.created, lastPlayed: w.lastPlayed,
        won: !!w.won, playtime: w.playtime || 0, version: w.version || 1,
      }))
      .sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
  } catch (e) {
    console.warn('[save] list failed', e);
    return [];
  }
}

export async function loadWorld(id) {
  const store = await tx('readonly');
  return wrap(store.get(id));
}

async function writeCommitted(method,value) {
  const db=await openDB();
  return new Promise((resolve,reject)=>{
    const txn=db.transaction(STORE,'readwrite');
    txn.oncomplete=()=>resolve();
    txn.onerror=txn.onabort=()=>reject(txn.error||new Error('Storage transaction failed'));
    txn.objectStore(STORE)[method](value);
  });
}
export async function saveWorld(record) {
  await writeCommitted('put',record);return record.id;
}

export async function deleteWorld(id) {
  await writeCommitted('delete',id);
}

export async function renameWorld(id, name) {
  const rec = await loadWorld(id);
  if (!rec) return false;
  rec.name = name;
  await saveWorld(rec);
  return true;
}

export function newWorldId() {
  return 'w_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 1e6).toString(36);
}

/** Estimated on-disk size, shown on the world list. */
export function estimateSize(rec) {
  try { return JSON.stringify(rec).length; } catch { return 0; }
}
