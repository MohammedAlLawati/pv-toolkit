// Offer decks: the techno-commercial PowerPoint for each project, with a preview of the
// figures that go into it. The deck itself is filled in js/offer/ (see generateOffer).
import { download, html, num, shortDate, toast } from "../ui.js";
import * as db from "../store.js";
import { byUpdated, dcKwp, loadAll } from "../data.js";
import { setTitle } from "../app.js";
import { generateOffer } from "../docgen/generate.js";
import { fmtOmr } from "../docgen/context.js";
import { MONTHS, buildOfferValues, offerMissing } from "../offer/values.js";

// [project field, label, what happens without it]
const PICTURES = [
  ["offer_site_file_id", "Proposed location", "uses the layout image, or leaves the slot empty"],
  ["offer_shadow_file_id", "Shadow analysis", "drops the shadow analysis slide"],
  ["offer_structure_file_id", "Mounting structure", "leaves the structure picture empty"],
];

async function busy(btn, fn) {
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = "Working…";
  try { await fn(); } catch (err) { console.error(err); toast("Couldn't make the deck: " + err.message, "error"); }
  finally { btn.disabled = false; btn.textContent = label; }
}

async function downloadDeck(btn, p) {
  await busy(btn, async () => {
    const { blob, filename } = await generateOffer(p);
    download(blob, filename);
  });
}

const notFound = (main) => { main.innerHTML = html`<div class="panel empty">Project not found. <a href="#/offers">Back to offer decks</a>.</div>`; };

// ---- list --------------------------------------------------------------------------------

export async function list(main) {
  setTitle("Offer decks");
  const all = await loadAll();
  const projects = byUpdated(all.projects).map(all.full);
  main.innerHTML = html`
<div class="head">
  <div><h1>Offer decks</h1><div class="muted">The techno-commercial offer as a PowerPoint, filled from each project.</div></div>
  <div class="actions"><a class="btn primary" href="#/projects/new">New project</a></div>
</div>
<div class="panel">
  ${projects.length ? html`<table>
    <thead><tr><th>Project</th><th>Client</th><th class="r">DC kWp</th><th class="r">Price (OMR)</th><th>Deck</th><th>Updated</th><th></th></tr></thead>
    <tbody>${projects.map((p) => {
      const missing = offerMissing(p);
      return html`<tr>
      <td><a href="#/offers/${p.id}">${p.name}</a></td><td>${p.client?.name || "—"}</td>
      <td class="r num">${num(dcKwp(p))}</td><td class="r num">${fmtOmr(p.subtotal_omr) || "—"}</td>
      <td>${missing.length ? html`<span class="small missing-text" title="${missing.join(", ")}">Needs ${missing.length} field${missing.length === 1 ? "" : "s"}</span>`
        : html`<span class="small ok-text">Ready</span>`}</td>
      <td class="muted small">${shortDate(p.updated_at)}</td>
      <td class="r"><button class="btn small" data-deck="${p.id}">PowerPoint</button></td></tr>`;
    })}</tbody>
  </table>` : html`<div class="empty">No projects yet. An offer deck is made from a project: <a href="#/projects/new">create one</a>.</div>`}
</div>`;
  const byId = new Map(projects.map((p) => [p.id, p]));
  for (const b of main.querySelectorAll("[data-deck]")) {
    b.addEventListener("click", () => downloadDeck(b, byId.get(Number(b.dataset.deck))));
  }
}

// ---- one project -------------------------------------------------------------------------

function monthlyBars(months) {
  const max = Math.max(...months, 1);
  return html`<div class="bars">${months.map((k, i) => html`
    <div class="bar" title="${MONTHS[i]}: ${num(k, 0)} kWh"><i style="height:${((k / max) * 100).toFixed(1)}%"></i><span>${MONTHS[i]}</span></div>`)}</div>`;
}

export async function view(main, { params }) {
  const all = await loadAll();
  const raw = all.projects.find((x) => x.id === params.id);
  if (!raw) return notFound(main);
  const p = all.full(raw);
  setTitle(`Offer deck · ${p.name}`);
  const missing = offerMissing(p);
  const { values: v, months, estimated, flow, annual } = buildOfferValues(p);
  const pics = await Promise.all(PICTURES.map(async ([key]) => !!(await db.getFile(p[key]))));
  const hasLayout = !!(await db.getFile(p.layout_file_id));
  const cum25 = flow?.years[24]?.cumulative;

  main.innerHTML = html`
<div class="head">
  <div>
    <h1>Offer deck</h1>
    <div class="muted"><a href="#/projects/${p.id}">${p.name}</a> · ${p.client?.name || "No client"}</div>
  </div>
  <div class="actions"><a class="btn" href="#/projects/${p.id}/edit">Edit project</a><button class="btn primary" id="deck">Download PowerPoint</button></div>
</div>
${missing.length ? html`<div class="flash warn">Still needs: ${missing.join(", ")}. Those parts of the deck are left blank. <a href="#/projects/${p.id}/edit">Fill them in</a>.</div>` : ""}

<div class="summary">
  <div><span>System</span><b>${v.DCCapacity || num(dcKwp(p))} kWp</b><small class="muted">${v.ACCapacity ? `${v.ACCapacity} kW AC` : ""}</small></div>
  <div><span>Price before VAT</span><b>${v.Subtotal ? `OMR ${v.Subtotal}` : "—"}</b><small class="muted">${v.OmrPerKwp ? `${v.OmrPerKwp} OMR/kWp` : ""}</small></div>
  <div><span>Year 1 savings</span><b>${v.AnnualSavings ? `OMR ${v.AnnualSavings}` : "—"}</b><small class="muted">at ${v.TariffBz} bz/kWh</small></div>
  <div><span>Payback · ROI</span><b>${v.PaybackText || "—"}</b><small class="muted">${v.ROI ? `ROI ${v.ROI}% a year` : ""}</small></div>
</div>

<div class="grid2">
  <div class="panel">
    <h2>Energy ${estimated ? html`<span class="pill">estimated</span>` : ""}</h2>
    ${months ? html`
    ${monthlyBars(months)}
    <p class="small muted">${num(annual, 0)} kWh in year 1, losing ${v.Degradation}% a year (${flow ? v.Y25E : "—"} MWh in year 25).
      ${estimated ? html`Monthly figures are the annual figure spread over a typical Oman year. Paste the 12 PVsyst figures on the project for the real ones.` : "Monthly figures from the project."}</p>`
    : html`<div class="empty">No annual generation yet. Add it, or the 12 monthly figures, on the project.</div>`}
  </div>
  <div class="panel">
    <h2>Returns over 25 years</h2>
    <dl class="kv">
      <dt>Year 1 savings</dt><dd>${v.AnnualSavings ? `OMR ${v.AnnualSavings}` : "—"}</dd>
      <dt>Payback</dt><dd>${v.PaybackText || "—"}</dd>
      <dt>ROI</dt><dd>${v.ROI ? `${v.ROI}% (average yearly savings ÷ price)` : "—"}</dd>
      <dt>Net after 25 years</dt><dd>${cum25 !== undefined && p.subtotal_omr ? `OMR ${num(cum25, 0)}` : "—"}</dd>
      <dt>Tariff · degradation</dt><dd>${v.TariffBz} bz/kWh · ${v.Degradation}% a year</dd>
    </dl>
    <h2 class="spaced-top">Environmental equivalents (per year)</h2>
    <dl class="kv">
      <dt>CO₂ avoided</dt><dd>${v.CO2Tonnes ? `${v.CO2Tonnes} t` : "—"}</dd>
      <dt>Omani homes powered</dt><dd>${v.Homes || "—"}</dd>
      <dt>Gas saved</dt><dd>${v.GasGallons ? `${v.GasGallons} gallons` : "—"}</dd>
      <dt>Cars off the road</dt><dd>${v.Cars || "—"}</dd>
      <dt>Tree seedlings (10 years)</dt><dd>${v.Seedlings || "—"}</dd>
    </dl>
  </div>
</div>

<div class="grid2">
  <div class="panel">
    <h2>Equipment slides</h2>
    <dl class="kv">
      <dt>Modules</dt><dd>${p.module_count || "—"} × ${p.module ? `${p.module.make} ${p.module.model}` : "—"}</dd>
      <dt>Inverters</dt><dd>${p.inverter_qty || "—"} × ${p.inverter ? `${p.inverter.make} ${p.inverter.model}` : "—"}</dd>
      <dt>DC/AC ratio</dt><dd>${v.DCACRatioPct ? `${v.DCACRatioPct}%` : "—"}</dd>
      <dt>Tilt · orientation</dt><dd>${v.Tilt ? `${v.Tilt}°` : "—"} · ${v.Orientation || "—"}</dd>
    </dl>
    <p class="small muted">Models with datasheet slides in the template keep them; others get a spec table from the equipment library.</p>
  </div>
  <div class="panel">
    <h2>Pictures</h2>
    <dl class="kv">${PICTURES.map(([, label, without], i) => html`
      <dt>${label}</dt><dd>${pics[i] ? html`<span class="ok-text">Added</span>`
        : i === 0 && hasLayout ? html`<span class="muted">Uses the layout image</span>`
        : html`<span class="muted">None, ${without}</span>`}</dd>`)}</dl>
    <p class="small muted"><a href="#/projects/${p.id}/edit">Add or change pictures on the project</a>.</p>
  </div>
</div>`;

  main.querySelector("#deck").addEventListener("click", (e) => downloadDeck(e.target, p));
}
