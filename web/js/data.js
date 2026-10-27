// Domain helpers on top of store.js: related records, derived values, rule profiles,
// the design check and the built-in equipment.
import * as db from "./store.js";
import { CATEGORIES, syncMpptSummary } from "./equipment_fields.js";
import { DEFAULT_PROFILE_NAME, defaults, settingsFrom } from "./sizing/rules.js";
import { check, designFrom } from "./sizing/engine.js";
import { SUNGROW_MENA, JINKO_MODULES } from "./seed_data.js";

export { dcKwp, acKw, dcAcRatio, above11kw } from "./docgen/context.js";

const byId = (rows) => new Map(rows.map((r) => [r.id, r]));

/** Every store loaded at once, with lookups by id. Cheap for a one-person data set. */
export async function loadAll() {
  const [clients, projects, parties, modules, inverters, profiles] = await Promise.all(
    ["clients", "projects", "parties", "modules", "inverters", "rule_profiles"].map((s) => db.list(s)));
  const all = { clients, projects, parties, modules, inverters, profiles,
                client: byId(clients), party: byId(parties), module: byId(modules),
                inverter: byId(inverters), profile: byId(profiles) };
  all.full = (p) => full(p, all);
  return all;
}

/** A project with its related records attached (what docgen and the engine expect). */
export function full(p, all) {
  return { ...p,
    client: all.client.get(p.client_id) || null,
    module: all.module.get(p.module_id) || null,
    inverter: all.inverter.get(p.inverter_id) || null,
    consultant: all.party.get(p.consultant_id) || null,
    contractor: all.party.get(p.contractor_id) || null,
    rule_profile: all.profile.get(p.rule_profile_id) || null };
}

export async function loadFull(pid) {
  const all = await loadAll();
  const p = all.projects.find((x) => x.id === pid);
  return p ? { p: full(p, all), all } : { p: null, all };
}

export const sortModules = (rows) => [...rows].sort((a, b) => (a.make || "").localeCompare(b.make || "") || a.wp - b.wp);
export function sortInverters(rows) {
  const order = Object.keys(CATEGORIES);
  const rank = (v) => (order.includes(v.category) ? order.indexOf(v.category) : 9);
  return [...rows].sort((a, b) => rank(a) - rank(b) || (a.make || "").localeCompare(b.make || "") || a.ac_kw - b.ac_kw);
}
export const byName = (rows) => [...rows].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
export const byUpdated = (rows) => [...rows].sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));

// ---- rule profiles ---------------------------------------------------------------------

/** Make sure a default profile exists; returns the profiles. */
export async function ensureDefaultProfile() {
  let rows = await db.list("rule_profiles");
  if (!rows.length) {
    await db.put("rule_profiles", { name: DEFAULT_PROFILE_NAME, is_default: true, ...defaults() });
    rows = await db.list("rule_profiles");
  } else if (!rows.some((r) => r.is_default)) {
    rows[0].is_default = true;
    await db.put("rule_profiles", rows[0]);
  }
  return rows;
}

/** The settings a project is checked with: its own profile, else the default one. */
export function settingsFor(p, all) {
  const prof = (p.rule_profile_id && all.profile.get(p.rule_profile_id)) || all.profiles.find((x) => x.is_default);
  return prof ? settingsFrom(prof) : defaults();
}

/** Rules check of a full project. */
export function projectCheck(p, all) {
  return check(designFrom(p, p.module, p.inverter), settingsFor(p, all));
}

// ---- built-in equipment ----------------------------------------------------------------

const DATASHEET_DIR = "data/datasheets/";

async function attachDatasheet(name) {
  if (!name) return null;
  const res = await fetch(DATASHEET_DIR + encodeURIComponent(name));
  if (!res.ok) return null;
  const blob = await res.blob();
  return db.putFile(new Blob([blob], { type: "application/pdf" }), name, { kind: "datasheet" });
}

/** Add or refresh built-in items, matched on make + model. Returns [added, updated]. */
async function importItems(store, items) {
  const existing = await db.list(store);
  let added = 0, updated = 0;
  for (const src of items) {
    const { datasheet, ...item } = src;
    if (store === "inverters") syncMpptSummary(item);
    const old = existing.find((x) => x.make === item.make && x.model === item.model);
    const rec = old ? { ...old, ...item } : { ...item };
    if (!rec.datasheet_id && datasheet) rec.datasheet_id = await attachDatasheet(datasheet);
    await db.put(store, rec);
    if (old) updated++; else added++;
  }
  return [added, updated];
}

export const importSungrow = () => importItems("inverters", SUNGROW_MENA);
export const importJinko = () => importItems("modules", JINKO_MODULES);
