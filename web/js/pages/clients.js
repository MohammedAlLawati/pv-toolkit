import { html, num, str, toast, go } from "../ui.js";
import * as db from "../store.js";
import { acKw, byName, dcKwp, loadAll } from "../data.js";
import { setTitle } from "../app.js";

const GOVERNORATES = ["Muscat", "Dhofar", "Musandam", "Al Buraimi", "Ad Dakhiliyah", "North Al Batinah",
  "South Al Batinah", "South Ash Sharqiyah", "North Ash Sharqiyah", "Ad Dhahirah", "Al Wusta"];
const FIELDS = ["name", "id_no", "mobile", "tel", "email", "governorate", "wilaya", "village",
                "signatory_name", "signatory_id", "notes"];

export async function list(main, { query }) {
  setTitle("Clients");
  const all = await loadAll();
  const q = (query.q || "").toLowerCase();
  const count = (id) => all.projects.filter((p) => p.client_id === id).length;
  const rows = byName(all.clients).filter((c) => !q ||
    [c.name, c.mobile, c.id_no, c.wilaya].some((v) => (v || "").toLowerCase().includes(q)));
  main.innerHTML = html`
<div class="head">
  <div><h1>Clients</h1><div class="muted">Enter a client once; every form and agreement reuses it.</div></div>
  <div class="actions"><a class="btn primary" href="#/clients/new">New client</a></div>
</div>
<form class="search" id="search"><input name="q" value="${query.q || ""}" placeholder="Search name, mobile, ID, wilayat"><button class="btn">Search</button></form>
<div class="panel">
  ${rows.length ? html`<table>
    <thead><tr><th>Name</th><th>Mobile</th><th>ID / C.R.</th><th>Wilayat</th><th class="r">Projects</th></tr></thead>
    <tbody>${rows.map((c) => html`<tr><td><a href="#/clients/${c.id}">${c.name}</a></td><td>${c.mobile}</td><td>${c.id_no}</td><td>${c.wilaya}</td><td class="r">${count(c.id)}</td></tr>`)}</tbody>
  </table>` : html`<div class="empty">${q ? "No matches." : "No clients yet."}</div>`}
</div>`;
  main.querySelector("#search").addEventListener("submit", (e) => {
    e.preventDefault();
    go("#/clients?q=" + encodeURIComponent(new FormData(e.target).get("q")));
  });
}

export async function form(main, { params }) {
  const all = await loadAll();
  const c = params.id ? all.client.get(params.id) : null;
  if (params.id && !c) { main.innerHTML = `<div class="panel empty">Client not found.</div>`; return; }
  const v = (k) => (c ? c[k] ?? "" : "");
  const projects = c ? all.projects.filter((p) => p.client_id === c.id).map(all.full) : [];
  setTitle(c ? c.name : "New client");
  main.innerHTML = html`
<div class="head">
  <div><h1>${c ? c.name : "New client"}</h1><div class="muted">These details appear on the NAMA forms and the execution agreement.</div></div>
  ${c ? html`<div class="actions"><a class="btn" href="#/letters/new?client_id=${c.id}">Write a letter</a><a class="btn primary" href="#/projects/new?client_id=${c.id}">New project for this client</a></div>` : ""}
</div>
<form id="client-form" class="panel">
  <div class="fields">
    <label class="wide">Full name (owner) <input name="name" value="${v("name")}" required></label>
    <label>Civil ID / C.R. number <input name="id_no" value="${v("id_no")}"></label>
    <label>Mobile <input name="mobile" value="${v("mobile")}"></label>
    <label>Telephone <input name="tel" value="${v("tel")}"></label>
    <label>E-mail <input name="email" type="email" value="${v("email")}"></label>
    <label>Governorate <input name="governorate" value="${v("governorate")}" list="governorates"></label>
    <label>Wilayat <input name="wilaya" value="${v("wilaya")}"></label>
    <label>Village / area <input name="village" value="${v("village")}"></label>
    <label>Authorised signatory <span class="hint">Companies only, for letters</span><input name="signatory_name" value="${v("signatory_name")}"></label>
    <label>Signatory's ID number <input name="signatory_id" value="${v("signatory_id")}"></label>
    <label class="wide">Notes <textarea name="notes">${v("notes")}</textarea></label>
  </div>
  <datalist id="governorates">${GOVERNORATES.map((g) => html`<option value="${g}">`)}</datalist>
  <div class="bar">
    ${c ? "" : html`<button class="btn" name="then" value="project">Save and create project</button>`}
    <button class="btn primary" name="then" value="">Save client</button>
  </div>
</form>
${c ? html`
<div class="panel">
  <h2>Projects</h2>
  ${projects.length ? html`<table><thead><tr><th>Project</th><th class="r">DC kWp</th><th class="r">AC kW</th><th>Status</th></tr></thead><tbody>
  ${projects.map((p) => html`<tr><td><a href="#/projects/${p.id}">${p.name}</a></td><td class="r">${num(dcKwp(p))}</td><td class="r">${num(acKw(p))}</td><td><span class="pill">${p.status}</span></td></tr>`)}
  </tbody></table>` : html`<div class="empty">No projects for this client yet.</div>`}
</div>
<button class="btn danger small" id="delete" data-confirm="Delete this client and all of their projects? This cannot be undone.">Delete client</button>` : ""}`;

  main.querySelector("#client-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const rec = { ...(c || {}) };
    for (const k of FIELDS) rec[k] = str(fd, k);
    if (!rec.name) { toast("The client's name is required.", "error"); return; }
    const id = await db.put("clients", rec);
    toast("Client saved.");
    go(e.submitter?.value === "project" ? `#/projects/new?client_id=${id}` : `#/clients/${id}`);
  });
  main.querySelector("#delete")?.addEventListener("click", async () => {
    for (const p of projects) {
      for (const k of ["layout_file_id", "offer_site_file_id", "offer_shadow_file_id", "offer_structure_file_id"]) await db.delFile(p[k]);
      await db.delFile(`weather_${p.id}`);
      await db.del("projects", p.id);
    }
    await db.del("clients", c.id);
    toast("Client deleted.");
    go("#/clients");
  });
}
