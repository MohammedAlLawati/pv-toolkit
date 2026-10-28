import { chk, float, g, go, html, sel, str, toast } from "../ui.js";
import * as db from "../store.js";
import { byName, ensureDefaultProfile } from "../data.js";
import { PARAMS, RULES, SEVERITIES, paramGroups, settingsFrom } from "../sizing/rules.js";
import { setTitle } from "../app.js";

export async function rules(main, { params }) {
  setTitle("Design rules");
  const profiles = byName(await ensureDefaultProfile());
  const prof = params.id ? profiles.find((x) => x.id === params.id) : profiles.find((x) => x.is_default);
  if (!prof) { main.innerHTML = `<div class="panel empty">Profile not found. <a href="#/rules">Design rules</a></div>`; return; }
  const st = settingsFrom(prof);
  main.innerHTML = html`
<div class="head">
  <div><h1>Design rules</h1><div class="muted">The limits and rules every design is checked against. A failing hard rule blocks reports; a warning doesn't.</div></div>
  <div class="actions">
    <div class="tabs">${profiles.map((x) => html`<a href="#/rules/${x.id}" class="${x.id === prof.id ? "on" : ""}">${x.name}${x.is_default ? " ★" : ""}</a>`)}</div>
    <button class="btn" id="copy">Copy this profile</button>
  </div>
</div>
<div class="flash warn">Isc per MPPT uses IEC 62548-1 (1.25 × Isc plus bifacial rear gain) and the 1-phase, LVRT and remote-control limits follow the APSR connection conditions. Check them against the latest APSR / NAMA documents before relying on them.</div>
<form id="rules-form">
  <div class="panel"><div class="fields">
    <label>Profile name <input name="name" value="${prof.name}"></label>
    <label class="check"><input type="checkbox" name="is_default" ${chk(prof.is_default)}> Default for projects that don't choose one</label>
  </div></div>
  ${paramGroups().map(([group, prms]) => html`
  <div class="panel"><h2>${group}</h2><div class="fields">
    ${prms.map((prm) => {
      const v = st.values[prm.key];
      return prm.type === "bool"
        ? html`<label class="check wide"><input type="checkbox" name="${prm.key}" ${chk(v)}> ${prm.label}${prm.hint ? html` <span class="hint">· ${prm.hint}</span>` : ""}</label>`
        : html`<label>${prm.label}${prm.unit ? ` (${prm.unit})` : ""}<input name="${prm.key}" value="${g(v)}" inputmode="decimal">${prm.hint ? html`<span class="hint">${prm.hint}</span>` : ""}</label>`;
    })}
  </div></div>`)}
  <div class="panel"><h2>Rules</h2>
    <table><thead><tr><th>Rule</th><th>Setting</th></tr></thead><tbody>
    ${RULES.map((rule) => html`<tr><td><b>${rule.label}</b>${rule.hint ? html`<div class="small muted">${rule.hint}</div>` : ""}</td>
      <td><select name="sev_${rule.key}">${Object.entries(SEVERITIES).map(([k, lab]) => html`<option value="${k}" ${sel(st.severity[rule.key] === k)}>${lab}</option>`)}</select></td></tr>`)}
    </tbody></table>
  </div>
  <div class="bar">${profiles.length > 1 && !prof.is_default ? html`<button type="button" class="btn danger" id="delete" data-confirm="Delete this rule profile? Projects using it go back to the default.">Delete profile</button>` : ""}<button class="btn primary">Save rules</button></div>
</form>`;

  main.querySelector("#rules-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const values = { ...st.values }, severity = { ...st.severity };
    for (const prm of PARAMS) {
      if (prm.type === "bool") values[prm.key] = fd.get(prm.key) === "on";
      else {
        values[prm.key] = float(fd, prm.key);
        if (values[prm.key] === null && prm.default !== null) values[prm.key] = prm.default; // only optional limits may be blank
      }
    }
    for (const rule of RULES) {
      const v = str(fd, "sev_" + rule.key);
      if (v in SEVERITIES) severity[rule.key] = v;
    }
    if (values.dcac_min > values.dcac_max) { toast("The lowest DC/AC ratio must be below the highest. Nothing was saved.", "error"); return; }
    const makeDefault = fd.get("is_default") === "on" && !prof.is_default;
    if (makeDefault) for (const other of profiles) if (other.is_default) await db.put("rule_profiles", { ...other, is_default: false });
    await db.put("rule_profiles", { ...prof, name: str(fd, "name") || prof.name, values, severity, is_default: prof.is_default || makeDefault });
    toast("Rule profile saved. Every project using it is re-checked.");
    go(`#/rules/${prof.id}`);
  });
  main.querySelector("#copy").addEventListener("click", async () => {
    const id = await db.put("rule_profiles", { name: `${prof.name} (copy)`, is_default: false, values: st.values, severity: st.severity });
    toast("Profile copied. Rename it and change the values you need.");
    go(`#/rules/${id}`);
  });
  main.querySelector("#delete")?.addEventListener("click", async () => {
    for (const p of await db.list("projects")) if (p.rule_profile_id === prof.id) await db.put("projects", { ...p, rule_profile_id: null });
    await db.del("rule_profiles", prof.id);
    toast("Profile deleted.");
    go("#/rules");
  });
}
