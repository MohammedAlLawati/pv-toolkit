// Documents: every piece of paperwork in one place. Pick a project, then download its NAMA
// forms, the execution agreement or the submission pack, and write NEDC letters for it.
// The offer deck has its own section; the letter editor stays in pages/letters.js.
import { download, go, html, num, shortDate, toast } from "../ui.js";
import * as db from "../store.js";
import { above11kw, acKw, byUpdated, dcKwp, loadAll, projectCheck, settingsFor } from "../data.js";
import { DOCS, missingFields } from "../docgen/context.js";
import { generate, generatePack } from "../docgen/generate.js";
import { blocked } from "../sizing/engine.js";
import { TEMPLATES } from "../letters/defaults.js";
import { setTitle } from "../app.js";

const LANGS = { en: "English", ar: "Arabic" };
const templateName = (key) => TEMPLATES[key]?.en.name || key;

export async function documents(main, { query }) {
  setTitle("Documents");
  const all = await loadAll();
  const projects = byUpdated(all.projects);
  const raw = projects.find((x) => x.id === Number(query.project_id)) || null;
  const p = raw ? all.full(raw) : null;
  const letters = byUpdated(await db.list("letters"));
  const head = await db.getFile("letterhead_top");

  let docs = [], packKeys = [], blockDesign = false;
  if (p) {
    blockDesign = blocked(projectCheck(p, all)) && settingsFor(p, all).values.block_design_form;
    docs = Object.values(DOCS).map((d) => ({
      key: d.key, missing: missingFields(d.key, p),
      title: d.key === "design" ? d.title + (above11kw(p) ? " (above 11 kW AC)" : " (11 kW AC and below)") : d.title,
    }));
    packKeys = ["initial", "agency", ...(blockDesign ? [] : ["design"])];
  }
  const projectLetters = p ? letters.filter((l) => l.project_id === p.id) : letters.slice(0, 8);

  main.innerHTML = html`
<div class="head">
  <div><h1>Documents</h1><div class="muted">NAMA forms, execution agreements and NEDC letters, filled from your projects.</div></div>
  <div class="actions"><a class="btn primary" href="#/letters/new${p ? `?project_id=${p.id}` : ""}">New letter</a></div>
</div>

<div class="panel">
  <label>Project
    <select id="project"><option value="">Choose a project…</option>${projects.map((x) => html`<option value="${x.id}" ${x.id === p?.id ? "selected" : ""}>${x.name}${all.client.get(x.client_id) ? ` · ${all.client.get(x.client_id).name}` : ""}</option>`)}</select>
  </label>
  ${!projects.length ? html`<div class="empty">No projects yet. <a href="#/projects/new">Create one</a> to fill in the forms.</div>` : ""}
  ${p ? html`<div class="small muted spaced-top">
    ${p.client ? html`<a href="#/clients/${p.client.id}">${p.client.name}</a>` : "No client"} · ${num(dcKwp(p))} kWp DC / ${num(acKw(p))} kW AC ·
    <a href="#/projects/${p.id}">Open project</a> · <a href="#/projects/${p.id}/edit">Edit details</a></div>` : ""}
</div>

<div class="grid2">
  <div class="panel">
    <h2>Forms (Word)</h2>
    ${p ? html`
    ${docs.map((d) => html`
    <div class="doc">
      <div><b>${d.title}</b>
        ${d.missing.length ? html`<div class="missing">Still needs: ${d.missing.join(", ")}</div>` : html`<div class="ready">All fields filled</div>`}</div>
      <div class="btns">${d.key === "design" && blockDesign ? html`<a class="pill err" href="#/projects/${p.id}/sizing">Blocked by design check</a>`
        : html`<button class="btn small" data-doc="${d.key}">Word</button>`}</div>
    </div>`)}
    <p><button class="btn sun" id="pack">Download NAMA submission pack (.zip)</button></p>
    <p class="small muted">Missing fields are left blank so you can still print and fill by hand. Open the Word file and use File › Save as PDF if you need a PDF.</p>`
    : html`<div class="empty">Choose a project above to fill in the NAMA forms and the execution agreement.</div>`}
  </div>

  <div class="panel">
    <h2>NEDC letters</h2>
    ${head ? "" : html`<div class="flash warn">No letterhead uploaded yet, so letters print on plain paper. <a href="#/settings">Upload it in Settings</a>.</div>`}
    ${projectLetters.length ? html`<table>
      <thead><tr><th>Client</th><th>Letter</th><th>Date</th></tr></thead>
      <tbody>${projectLetters.map((l) => html`<tr><td><a href="#/letters/${l.id}">${l.values?.ClientName || "(no name)"}</a></td>
        <td>${templateName(l.template)} · ${LANGS[l.lang]}</td><td>${shortDate(l.date)}</td></tr>`)}</tbody>
    </table>` : html`<div class="empty">${p ? "No letters for this project yet." : "No letters yet."}</div>`}
    <p class="spaced-top"><a class="btn" href="#/letters/new${p ? `?project_id=${p.id}` : ""}">Write a letter${p ? " for this project" : ""}</a>
      <a class="btn" href="#/letters">All letters and blank templates</a></p>
  </div>
</div>`;

  main.querySelector("#project").addEventListener("change", (e) => go(e.target.value ? `#/documents?project_id=${e.target.value}` : "#/documents"));
  if (!p) return;

  const busy = async (btn, fn) => {
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = "Working…";
    try { await fn(); } catch (err) { console.error(err); toast("Couldn't make the document: " + err.message, "error"); }
    finally { btn.disabled = false; btn.textContent = label; }
  };
  main.querySelectorAll("[data-doc]").forEach((btn) => btn.addEventListener("click", () => busy(btn, async () => {
    const { blob, filename } = await generate(btn.dataset.doc, p);
    download(blob, filename);
  })));
  main.querySelector("#pack").addEventListener("click", (e) => busy(e.target, async () => {
    const { blob, filename } = await generatePack(packKeys, p);
    download(blob, filename);
  }));
}
