import { html, num, shortDate } from "../ui.js";
import { acKw, byUpdated, dcKwp, loadAll } from "../data.js";
import { setTitle } from "../app.js";

export async function dashboard(main) {
  setTitle("Dashboard");
  const all = await loadAll();
  const projects = all.projects.map(all.full);
  const totalKwp = projects.reduce((t, p) => t + (dcKwp(p) || 0), 0);
  const recent = byUpdated(projects).slice(0, 10);
  main.innerHTML = html`
<div class="head">
  <div><h1>Dashboard</h1><div class="muted">Clients, projects and paperwork in one place.</div></div>
  <div class="actions"><a class="btn" href="#/clients/new">New client</a><a class="btn primary" href="#/projects/new">New project</a></div>
</div>
<div class="stats">
  <div class="stat"><b>${all.projects.length}</b><span>Projects</span></div>
  <div class="stat"><b>${all.clients.length}</b><span>Clients</span></div>
  <div class="stat"><b>${num(totalKwp, 1)}</b><span>kWp across projects</span></div>
  <div class="stat"><b>${all.modules.length}</b><span>Modules in library</span></div>
  <div class="stat"><b>${all.inverters.length}</b><span>Inverters in library</span></div>
</div>
${!all.modules.length && !all.inverters.length ? html`<div class="panel callout"><div><b>Start with the equipment library</b><div class="muted small">Load the Sungrow inverters and Jinko modules with one click each.</div></div><a class="btn sun" href="#/library">Open the library</a></div>` : ""}
<div class="panel">
  <h2>Recently updated projects</h2>
  ${recent.length ? html`
  <table>
    <thead><tr><th>Project</th><th>Client</th><th class="r">DC kWp</th><th class="r">AC kW</th><th>Status</th><th>Updated</th></tr></thead>
    <tbody>${recent.map((p) => html`<tr>
      <td><a href="#/projects/${p.id}">${p.name}</a></td><td>${p.client?.name}</td>
      <td class="r num">${num(dcKwp(p))}</td><td class="r num">${num(acKw(p))}</td>
      <td><span class="pill">${p.status}</span></td><td class="muted small">${shortDate(p.updated_at)}</td></tr>`)}</tbody>
  </table>` : html`<div class="empty">No projects yet. Start by adding a client, then create a project for them.</div>`}
</div>`;
}
