// <option> lists shared by the project and sizing forms.
import { html, sel } from "./ui.js";
import { CATEGORIES, inverterLabel, moduleLabel, moduleReady } from "./equipment_fields.js";
import { sortInverters, sortModules } from "./data.js";

export function moduleOptions(modules, selected, { blank = "Choose…", readiness = false } = {}) {
  return html`${blank !== null ? html`<option value="" data-wp="">${blank}</option>` : ""}${sortModules(modules).map((m) =>
    html`<option value="${m.id}" data-wp="${m.wp}" ${sel(m.id === selected)}>${moduleLabel(m)}${readiness && !moduleReady(m) ? " (no electrical values)" : ""}</option>`)}`;
}

export function inverterOptions(inverters, selected, { blank = "Choose…" } = {}) {
  const sorted = sortInverters(inverters);
  const groups = Object.entries(CATEGORIES).map(([cat, label]) => [label, sorted.filter((v) => v.category === cat)]);
  const other = sorted.filter((v) => !(v.category in CATEGORIES));
  if (other.length) groups.push(["Other", other]);
  return html`${blank !== null ? html`<option value="" data-kw="">${blank}</option>` : ""}${groups.filter(([, items]) => items.length).map(([label, items]) =>
    html`<optgroup label="${label}">${items.map((v) =>
      html`<option value="${v.id}" data-kw="${v.ac_kw}" data-phases="${v.phases}" data-trafo="${v.internal_transformer ? 1 : 0}" ${sel(v.id === selected)}>${inverterLabel(v)}</option>`)}</optgroup>`)}`;
}

export const partyOptions = (parties, selected) =>
  html`<option value="">None</option>${parties.map((x) => html`<option value="${x.id}" ${sel(x.id === selected)}>${x.name}</option>`)}`;
