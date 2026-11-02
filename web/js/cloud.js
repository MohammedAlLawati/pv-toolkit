// Cloud copy of this browser's data, in a Supabase project (cloud_config.js), for the signed-in user.
//
// The browser stays the working copy (IndexedDB, store.js): pages read and write it as before, and
// every change is also queued in store.js's outbox. Here the queue is sent to the cloud (records
// table, files bucket), and changes made on other devices are fetched ("pull"), newest first by
// each record's updated_at. Signing in on a new device fetches everything; signing in where data
// already exists uploads it.
import { CLOUD } from "./cloud_config.js";
import * as db from "./store.js";

export const configured = !!(CLOUD.url && CLOUD.anonKey);
export const signedIn = () => !!user;

// "Continue as guest" on the welcome screen: the app works in this browser only, as before.
const GUEST = "pv-toolkit-guest";
export const isGuest = () => { try { return localStorage.getItem(GUEST) === "1"; } catch { return false; } };
export const setGuest = (on) => { try { on ? localStorage.setItem(GUEST, "1") : localStorage.removeItem(GUEST); } catch { /* asked again next time */ } };

/** One line on how much of this browser's data is in the cloud. */
export function syncText(s) {
  if (s.error) return `Sync problem: ${s.error}`;
  if (s.progress) return `${s.progress.label} ${s.progress.done} of ${s.progress.total}…`;
  const saved = Math.max(0, s.total - s.pending), pct = s.total ? Math.floor((saved / s.total) * 100) : 100;
  return `${pct}% synced · ${saved} of ${s.total} items in the cloud${s.last ? ` · checked ${ago(s.last)}` : ""}`;
}
/** 0..1, for a progress bar. */
export function syncShare(s) {
  if (s.progress) return s.progress.total ? s.progress.done / s.progress.total : 0;
  return s.total ? Math.max(0, s.total - s.pending) / s.total : 1;
}
export function ago(d) {
  const sec = Math.round((Date.now() - d) / 1000);
  return sec < 60 ? "just now" : sec < 3600 ? `${Math.round(sec / 60)} min ago` : new Date(d).toLocaleString();
}

let client = null, user = null, pushTimer = null, running = null;
// total: records in this browser; pending: those not yet in the cloud; progress: { label, done, total } while syncing
const state = { ready: false, email: null, busy: false, pending: 0, total: 0, progress: null, last: null, error: null };
const listeners = new Set();
/** Call fn(state) now and whenever the sign-in or sync state changes; returns an unsubscribe. */
export function onStatus(fn) { listeners.add(fn); fn({ ...state }); return () => listeners.delete(fn); }
const set = (patch) => { Object.assign(state, patch); for (const fn of listeners) fn({ ...state }); };

const BUCKET = "files";
const cursorKey = () => `pv-toolkit-cloud-cursor:${user.id}`;
const getCursor = () => { try { return localStorage.getItem(cursorKey()); } catch { return null; } };
const setCursor = (v) => { try { localStorage.setItem(cursorKey(), v); } catch { /* the next pull starts over */ } };
const filePath = (id) => `${user.id}/${encodeURIComponent(String(id))}`;
const ridToId = (store, rid) => (store !== "settings" && /^\d+$/.test(rid) ? Number(rid) : rid);
const stampOf = (data) => data?.updated_at || data?.deleted_at || "";

function loadLibrary() {
  if (globalThis.supabase?.createClient) return Promise.resolve(globalThis.supabase);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "vendor/supabase/supabase.js";
    s.onload = () => resolve(globalThis.supabase);
    s.onerror = () => reject(new Error("Couldn't load the sign-in library."));
    document.head.appendChild(s);
  });
}

/** Connect to the cloud project, if one is configured. Called once at start-up. */
export async function start() {
  if (!configured) return;
  db.enableOutbox(() => { refreshPending(); schedulePush(); });
  try {
    const { createClient } = await loadLibrary();
    client = createClient(CLOUD.url, CLOUD.anonKey, { auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true, autoRefreshToken: true } });
    const { data } = await client.auth.getSession();
    // the sign-in link comes back as ?code=...; once used, take it out of the address
    if (/[?&]code=/.test(location.search)) history.replaceState(null, "", location.pathname + location.hash);
    setUser(data.session?.user || null);
    client.auth.onAuthStateChange((_event, session) => setUser(session?.user || null));
  } catch (err) {
    set({ error: err.message });
  }
  set({ ready: true });
  refreshPending();
  setInterval(() => sync(), 60_000);
  addEventListener("focus", () => sync());
  addEventListener("online", () => sync());
}

function setUser(u) {
  const changed = (u?.id || null) !== (user?.id || null);
  user = u;
  set({ email: u?.email || null, error: null });
  if (changed && u) sync();
}

/** Email a sign-in link; it brings the user back to the account page, signed in. */
export async function signIn(email) {
  const { error } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname + "#/account" } });
  if (error) throw error;
}

export async function signOut() {
  await client.auth.signOut();
  user = null;
  set({ email: null, last: null });
}

async function refreshPending() { set({ pending: (await db.outbox()).length, total: await db.countAll() }); }

function schedulePush() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => sync(), 1500);
}

/** Fetch others' changes, then send ours. Runs one at a time; resolves when done. */
export function sync() {
  if (!client || !user || !navigator.onLine) return Promise.resolve();
  if (running) return running;
  running = (async () => {
    set({ busy: true, error: null });
    try {
      // first sync for this user here: everything already in this browser goes up too
      if (!getCursor()) await db.queueAll();
      const changed = await pull();
      await push();
      set({ last: new Date() });
      if (changed) dispatchEvent(new CustomEvent("cloud-pulled", { detail: { changed } }));
    } catch (err) {
      console.warn("Cloud sync:", err);
      set({ error: err.message || String(err) });
    } finally {
      running = null;
      set({ busy: false, progress: null });
      refreshPending();
    }
  })();
  return running;
}

async function pull() {
  const pending = new Map((await db.outbox()).map((e) => [e.key, e]));
  let cursor = getCursor() || "1970-01-01T00:00:00Z", changed = 0;
  for (;;) {
    const { data: rows, error } = await client.from("records").select("store, rid, data, deleted, server_at")
      .gt("server_at", cursor).order("server_at").limit(500);
    if (error) throw error;
    let n = 0;
    for (const row of rows) {
      if (rows.length > 20 && ++n % 10 === 0) set({ progress: { label: "Downloading from the cloud:", done: n, total: rows.length } });
      if (!db.STORES.includes(row.store)) continue;
      const id = ridToId(row.store, row.rid), key = `${row.store}:${id}`;
      const local = await db.get(row.store, id);
      const remote = stampOf(row.data), mine = pending.get(key);
      if (mine && (local?.updated_at || "") > remote) continue;  // ours is newer: it goes up next
      if (row.deleted) {
        if (local) { await db.delRaw(row.store, id); changed++; }
      } else if (!local || local.updated_at !== row.data.updated_at) {
        let rec = row.data;
        if (row.store === "files") {
          const { data: blob, error: e } = await client.storage.from(BUCKET).download(filePath(id));
          if (e) { console.warn(`Cloud file ${id}:`, e); continue; }
          rec = { ...rec, blob: rec.mime ? new Blob([blob], { type: rec.mime }) : blob };
        }
        await db.putRaw(row.store, rec);
        changed++;
      }
      if (mine) await db.outboxDone(mine);
    }
    if (rows.length) { cursor = rows[rows.length - 1].server_at; setCursor(cursor); }
    if (rows.length < 500) break;
  }
  if (!getCursor()) setCursor(cursor);
  return changed;
}

async function push() {
  const entries = await db.outbox();
  const rows = [], done = [];
  let sent = 0;
  const step = () => set({ progress: { label: "Uploading to the cloud:", done: sent, total: entries.length } });
  if (entries.length) step();
  for (const e of entries) {
    const rid = String(e.id), base = { user_id: user.id, store: e.store, rid };
    const rec = e.op === "put" ? await db.get(e.store, e.id) : null;
    if (!rec) {
      if (e.store === "files") await client.storage.from(BUCKET).remove([filePath(e.id)]);
      rows.push({ ...base, deleted: true, data: { id: e.id, deleted_at: new Date().toISOString() } });
    } else if (e.store === "files") {
      const { blob, ...meta } = rec;
      if (blob) {
        const { error } = await client.storage.from(BUCKET).upload(filePath(e.id), blob, { upsert: true, contentType: rec.mime || blob.type || "application/octet-stream" });
        if (error) throw error;
      }
      rows.push({ ...base, deleted: false, data: meta });
    } else {
      rows.push({ ...base, deleted: false, data: rec });
    }
    done.push(e);
    if (rows.length >= (e.store === "files" ? 1 : 50)) { sent += rows.length; await send(rows.splice(0), done.splice(0)); step(); }
  }
  if (rows.length) await send(rows, done);
}

/** What the signed-in user has in the cloud: { records, files, bytes } (file bytes; records are small). */
export async function usage() {
  const { count, error } = await client.from("records").select("rid", { count: "exact", head: true }).eq("deleted", false);
  if (error) throw error;
  let files = 0, bytes = 0;
  for (let offset = 0; ; offset += 1000) {
    const { data, error: e } = await client.storage.from(BUCKET).list(user.id, { limit: 1000, offset });
    if (e) throw e;
    for (const f of data) { files++; bytes += f.metadata?.size || 0; }
    if (data.length < 1000) break;
  }
  return { records: count || 0, files, bytes };
}

async function send(rows, entries) {
  const { error } = await client.from("records").upsert(rows, { onConflict: "user_id,store,rid" });
  if (error) throw error;
  for (const e of entries) await db.outboxDone(e);
}
