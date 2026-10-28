// Browser storage (IndexedDB). Everything the app knows lives here, on this device only.
// Records are plain objects with a numeric `id`; files (stamps, layouts, datasheets,
// letterhead) are kept in the "files" store as { id, name, mime, blob, width?, height? }.
// Most files get a numeric id; a few app-wide ones use fixed string ids ("letterhead_top").

const DB_NAME = "pv-toolkit";
const DB_VERSION = 3;
export const STORES = ["clients", "projects", "parties", "modules", "inverters", "rule_profiles", "files", "settings", "letters", "offers"];

let _db = null;

function open() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, name === "settings" ? { keyPath: "key" } : { keyPath: "id", autoIncrement: true });
        }
      }
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then((r) => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

const wrap = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

export const get = (store, id) => tx(store, "readonly", (s) => wrap(s.get(id)));
export const list = (store) => tx(store, "readonly", (s) => wrap(s.getAll()));
export const del = (store, id) => tx(store, "readwrite", (s) => wrap(s.delete(id)));

/** Insert or update; returns the record's id. */
export function put(store, record) {
  const rec = { ...record };
  if (store !== "settings" && (rec.id === undefined || rec.id === null || rec.id === "")) delete rec.id;
  rec.updated_at = new Date().toISOString();
  if (!rec.created_at) rec.created_at = rec.updated_at;
  return tx(store, "readwrite", (s) => wrap(s.put(rec)));
}

// ---- settings (key/value) ------------------------------------------------------------

export async function getSetting(key, fallback = null) {
  const rec = await get("settings", key);
  return rec ? rec.value : fallback;
}
export const setSetting = (key, value) => put("settings", { key, value });

// ---- files ----------------------------------------------------------------------------

/** Store a Blob; `meta` may carry width / height for images. Returns the file id. */
export function putFile(blob, name, meta = {}) {
  return put("files", { name, mime: blob.type, blob, ...meta });
}
/** Store a Blob under a fixed id, e.g. "letterhead_top". Replaces what was there. */
export function putFileAs(id, blob, name, meta = {}) {
  return put("files", { id, name, mime: blob.type, blob, ...meta });
}
export const getFile = (id) => (id ? get("files", id).then((r) => r || null) : Promise.resolve(null));
export const delFile = (id) => (id ? del("files", id) : Promise.resolve());

// ---- backup ---------------------------------------------------------------------------

function blobToB64(blob) {
  return blob.arrayBuffer().then((buf) => {
    let s = "";
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  });
}

function b64ToBlob(b64, mime) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export async function exportAll() {
  const out = { app: "pv-toolkit", version: 1, exported_at: new Date().toISOString(), stores: {} };
  for (const name of STORES) {
    const rows = await list(name);
    if (name === "files") {
      for (const r of rows) { r.blob = await blobToB64(r.blob); }
    }
    out.stores[name] = rows;
  }
  return new Blob([JSON.stringify(out)], { type: "application/json" });
}

/** Replace everything with a backup made by exportAll(). */
export async function importAll(text) {
  const data = JSON.parse(text);
  if (data.app !== "pv-toolkit" || !data.stores) throw new Error("This isn't a PV Toolkit backup file.");
  const db = await open();
  await new Promise((resolve, reject) => {
    const t = db.transaction(STORES, "readwrite");
    for (const name of STORES) {
      const s = t.objectStore(name);
      s.clear();
      for (const r of data.stores[name] || []) {
        if (name === "files") r.blob = b64ToBlob(r.blob, r.mime);
        s.put(r);
      }
    }
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });
}
