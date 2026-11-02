import { html, num, shortDate } from "../ui.js";
import { byUpdated, dcKwp, loadAll } from "../data.js";
import { CLIENT_TYPES, clientView, requiredCapacity } from "../clients/model.js";
import { setTitle } from "../app.js";

export async function dashboard(main) {
  setTitle("Dashboard");
  const all = await loadAll();
  const clients = all.clients.map(clientView);
  const requested = clients.reduce((t, c) => { const r = requiredCapacity(c); return t + (r && r.unit === "dc" ? r.kw : 0); }, 0);
  const designedKwp = all.projects.map(all.full).reduce((t, p) => t + (dcKwp(p) || 0), 0);
  const recent = byUpdated(clients).slice(0, 10);
  main.innerHTML = html`
<div class="head">
  <div><h1>Dashboard</h1><div class="muted">Clients, stringing and paperwork in one place.</div></div>
  <div class="actions"><a class="btn" href="#/stringing">Stringing calculator</a><a class="btn primary" href="#/clients/new">New client</a></div>
</div>
<div class="stats">
  <div class="stat"><b>${clients.length}</b><span>Clients</span></div>
  <div class="stat"><b>${num(requested, 1)}</b><span>kWp requested by clients</span></div>
  <div class="stat"><b>${num(designedKwp, 1)}</b><span>kWp in design records</span></div>
  <div class="stat"><b>${all.modules.length}</b><span>Modules in library</span></div>
  <div class="stat"><b>${all.inverters.length}</b><span>Inverters in library</span></div>
</div>
${!all.modules.length && !all.inverters.length ? html`<div class="panel callout"><div><b>Start with the equipment library</b><div class="muted small">Load the Sungrow inverters and Jinko modules with one click each.</div></div><a class="btn sun" href="#/library">Open the library</a></div>` : ""}
<div class="panel">
  <div class="panel-head"><h2>Recently updated clients</h2><a class="small" href="#/clients">All clients</a></div>
  ${recent.length ? html`
  <table>
    <thead><tr><th>Client</th><th>Type</th><th class="r">Required capacity</th><th>Updated</th></tr></thead>
    <tbody>${recent.map((c) => html`<tr>
      <td><a href="#/clients/${c.id}">${c.name}</a></td><td><span class="pill">${CLIENT_TYPES[c.client_type]}</span></td>
      <td class="r num">${requiredCapacity(c)?.label || "—"}</td><td class="muted small">${shortDate(c.updated_at)}</td></tr>`)}</tbody>
  </table>` : html`<div class="empty">No clients yet. <a href="#/clients/new">Add the first one</a>.</div>`}
</div>`;
}
