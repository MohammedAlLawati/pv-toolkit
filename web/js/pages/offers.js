// Offer decks: the techno-commercial PowerPoint, either as a quick offer (client, equipment,
// price per kWp, and the pictures and figures of the Helioscope reports) or from a full
// project, with a preview of the figures that go into it. The deck itself is filled in
// js/offer/ (see generateOffer).
import { download, fileUrl, float, g, go, html, int, num, raw, readImage, sel, shortDate, str, toast } from "../ui.js";
import * as db from "../store.js";
import { byName, byUpdated, dcKwp, loadAll } from "../data.js";
import { setTitle } from "../app.js";
import { generateOffer } from "../docgen/generate.js";
import { fmtOmr } from "../docgen/context.js";
import { MONTHS, SHADING_LIMIT_PCT, buildOfferValues, offerMissing, parseMonthly } from "../offer/values.js";
import { DEFAULT_SCHEDULE, DESIGN_TYPES, IMAGE_KEYS, MAX_WEEKS, QUICK_DEFAULTS, SLOT_OF, SPECIFIC_YIELD, annualKwh,
  capacities, quickMissing, suggestCode, toProject } from "../offer/quick.js";
import { inverterOptions, moduleOptions } from "../options.js";

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

const notFound = (main, what = "Project") => { main.innerHTML = html`<div class="panel empty">${what} not found. <a href="#/offers">Back to offer decks</a>.</div>`; };

// ---- list --------------------------------------------------------------------------------

export async function list(main) {
  setTitle("Offer decks");
  const all = await loadAll();
  const offers = byUpdated(await db.list("offers"));
  const projects = byUpdated(all.projects).map(all.full);
  main.innerHTML = html`
<div class="head">
  <div><h1>Offer decks</h1><div class="muted">The techno-commercial offer as a PowerPoint: from a few inputs, or from a full project.</div></div>
  <div class="actions"><a class="btn primary" href="#/offers/new">New offer</a></div>
</div>
<div class="panel">
  <h2>Offers</h2>
  ${offers.length ? html`<div class="table-scroll"><table>
    <thead><tr><th>Client</th><th class="r">DC kWp</th><th class="r">AC kW</th><th class="r">Price (OMR)</th><th>Updated</th><th></th></tr></thead>
    <tbody>${offers.map((o) => { const p = toProject(o, all); return html`<tr>
      <td><a href="#/offers/quick/${o.id}">${o.client_name || "(no name)"}</a></td>
      <td class="r num">${num(p.dc_kwp)}</td><td class="r num">${num(p.ac_kw)}</td>
      <td class="r num">${fmtOmr(p.subtotal_omr) || "—"}</td>
      <td class="muted small">${shortDate(o.updated_at)}</td>
      <td class="r"><button class="btn small" data-quick="${o.id}">PowerPoint</button></td></tr>`; })}</tbody>
  </table></div>` : html`<div class="empty">No offers yet. <a href="#/offers/new">Make one</a> from the client, equipment, price per kWp and the Helioscope reports.</div>`}
</div>
<div class="panel">
  <h2>From projects</h2>
  ${projects.length ? html`<div class="table-scroll"><table>
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
  </table></div>` : html`<div class="empty">No projects yet.</div>`}
</div>`;
  const byId = new Map(projects.map((p) => [p.id, p]));
  for (const b of main.querySelectorAll("[data-deck]")) {
    b.addEventListener("click", () => downloadDeck(b, byId.get(Number(b.dataset.deck))));
  }
  const offerById = new Map(offers.map((o) => [o.id, o]));
  for (const b of main.querySelectorAll("[data-quick]")) {
    b.addEventListener("click", () => downloadDeck(b, toProject(offerById.get(Number(b.dataset.quick)), all)));
  }
}

// ---- the figures that go into a deck -----------------------------------------------------

/** Monthly generation as a bar chart, with each month's MWh above its bar. */
export function monthlyBars(months) {
  const max = Math.max(...months, 1);
  return html`<div class="bars labelled">${months.map((k, i) => html`
    <div class="bar" title="${MONTHS[i]}: ${num(k, 0)} kWh"><em>${num(k / 1000, 1)}</em><i style="height:${((k / max) * 82).toFixed(1)}%"></i><span>${MONTHS[i]}</span></div>`)}</div>
    <p class="small muted">MWh per month · total ${num(months.reduce((a, b) => a + b, 0) / 1000, 1)} MWh</p>`;
}

const shadingFlag = (pct) => (pct > SHADING_LIMIT_PCT
  ? html`<div class="flash warn">Shading losses are ${num(pct, 1)}%, above the ${SHADING_LIMIT_PCT}% limit. Slide 16 says so in place of the "minimal shading" wording.</div>` : "");

/** Summary row plus energy / returns / environment panels for a project-shaped record. */
function figures(p, energyNote) {
  const { values: v, months, flow, annual } = buildOfferValues(p);
  const cum25 = flow?.years[24]?.cumulative;
  return html`
${shadingFlag(p.shading_loss_pct)}
<div class="summary">
  <div><span>System</span><b>${v.DCCapacity || "—"} kWp</b><small class="muted">${v.ACCapacity ? `${v.ACCapacity} kW AC` : ""}${v.DCACRatioPct ? ` · ${v.DCACRatioPct}%` : ""}</small></div>
  <div><span>Price before VAT</span><b>${v.Subtotal ? `OMR ${v.Subtotal}` : "—"}</b><small class="muted">${v.OmrPerKwp ? `${v.OmrPerKwp} OMR/kWp` : ""}</small></div>
  <div><span>Year 1 savings</span><b>${v.AnnualSavings ? `OMR ${v.AnnualSavings}` : "—"}</b><small class="muted">at ${v.TariffBz} bz/kWh</small></div>
  <div><span>Payback · ROI</span><b>${v.PaybackText || "—"}</b><small class="muted">${v.ROI ? `ROI ${v.ROI}% a year` : ""}</small></div>
</div>
<div class="grid2">
  <div class="panel">
    <h2>Energy</h2>
    ${months ? html`${monthlyBars(months)}
    <p class="small muted">${num(annual, 0)} kWh in year 1, losing ${v.Degradation}% a year (${flow ? v.Y25E : "—"} MWh in year 25). ${energyNote}</p>`
    : html`<div class="empty">No generation figure yet.</div>`}
  </div>
  <div class="panel">
    <h2>Returns over 25 years</h2>
    <dl class="kv">
      <dt>Year 1 savings</dt><dd>${v.AnnualSavings ? `OMR ${v.AnnualSavings}` : "—"}</dd>
      <dt>Payback</dt><dd>${v.PaybackText || "—"}</dd>
      <dt>ROI</dt><dd>${v.ROI ? `${v.ROI}% (average yearly savings ÷ price)` : "—"}</dd>
      <dt>Net after 25 years</dt><dd>${cum25 !== undefined && p.subtotal_omr ? `OMR ${num(cum25, 0)}` : "—"}</dd>
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
</div>`;
}

// ---- deck from a project -----------------------------------------------------------------

export async function view(main, { params }) {
  const all = await loadAll();
  const raw = all.projects.find((x) => x.id === params.id);
  if (!raw) return notFound(main);
  const p = all.full(raw);
  setTitle(`Offer deck · ${p.name}`);
  const missing = offerMissing(p);
  const { values: v, estimated } = buildOfferValues(p);
  const pics = await Promise.all(PICTURES.map(async ([key]) => !!(await db.getFile(p[key]))));
  const hasLayout = !!(await db.getFile(p.layout_file_id));

  main.innerHTML = html`
<div class="head">
  <div>
    <h1>Offer deck</h1>
    <div class="muted"><a href="#/projects/${p.id}">${p.name}</a> · ${p.client?.name || "No client"}</div>
  </div>
  <div class="actions"><a class="btn" href="#/projects/${p.id}/edit">Edit project</a><button class="btn primary" id="deck">Download PowerPoint</button></div>
</div>
${missing.length ? html`<div class="flash warn">Still needs: ${missing.join(", ")}. Those parts of the deck are left blank. <a href="#/projects/${p.id}/edit">Fill them in</a>.</div>` : ""}
${figures(p, estimated ? "Monthly figures are the annual figure spread over a typical Oman year. Paste the 12 PVsyst figures on the project for the real ones." : "Monthly figures from the project.")}
<div class="grid2">
  <div class="panel">
    <h2>Equipment slides</h2>
    <dl class="kv">
      <dt>Modules</dt><dd>${p.module_count || "—"} × ${p.module ? `${p.module.make} ${p.module.model}` : "—"}</dd>
      <dt>Inverters</dt><dd>${p.inverter_qty || "—"} × ${p.inverter ? `${p.inverter.make} ${p.inverter.model}` : "—"}</dd>
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


// ---- quick offer: a few inputs -> the whole deck -----------------------------------------

const ENERGY_NOTE = {
  monthly: "Monthly figures as entered (or read off the Helioscope chart).",
  annual: "Monthly figures are the annual figure spread over a typical Oman year.",
  yield: "Estimated as DC capacity × specific yield, spread over a typical Oman year.",
};
const KIND_NAMES = { simulation: "Simulation report", shading: "Shading report", report: "Report" };
const CORNERS = [["tl", "↖", "Top left"], ["tr", "↗", "Top right"], ["bl", "↙", "Bottom left"], ["br", "↘", "Bottom right"]];
const SLOT_SHORT = { offer_site_file_id: "Location", offer_shadow_file_id: "Shading", offer_structure_file_id: "3D left", offer_structure2_file_id: "3D right" };
const FIELD_OF = Object.fromEntries(Object.entries(SLOT_OF).map(([field, slot]) => [slot, field]));

/** The corner of a picture where the logo covers least. */
async function cornerOf(blob) {
  const { quietCorner } = await import("../offer/helioscope.js");
  const bmp = await createImageBitmap(blob);
  const c = document.createElement("canvas");
  c.width = Math.min(800, bmp.width); c.height = Math.round((bmp.height * c.width) / bmp.width);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return quietCorner(ctx);
}

export async function quick(main, { params, query }) {
  const all = await loadAll();
  let o;
  if (params.id) {
    o = await db.get("offers", params.id);
    if (!o) return notFound(main, "Offer");
    o = { ...QUICK_DEFAULTS, ...o };
    // older offers kept a total price and typed capacities
    if (!o.price_per_kwp && o.subtotal_omr && o.dc_kwp) o.price_per_kwp = Math.round((o.subtotal_omr / o.dc_kwp) * 1000) / 1000;
  } else {
    o = { ...QUICK_DEFAULTS, logo_corners: {} };
    // start from the most recent offer's equipment and commercial settings
    const last = byUpdated(await db.list("offers"))[0];
    if (last) for (const k of ["module_id", "inverter_id", "installation_type", "tariff_bz", "degradation_pct", "specific_yield", "price_per_kwp"]) if (last[k] !== undefined) o[k] = last[k];
    if (query.client) o.client_name = query.client;
  }
  setTitle(params.id ? `Offer · ${o.client_name}` : "New offer");
  const designTypes = [...new Set([...DESIGN_TYPES, ...(await db.getSetting("design_types", [])), o.installation_type].filter(Boolean))];
  const schedule = (o.schedule || DEFAULT_SCHEDULE).map((a) => ({ ...a }));
  const corners = { ...(o.logo_corners || {}) };
  let codeEdited = !!o.reference_code && o.reference_code !== suggestCode(o.client_name);

  // pictures: { field: { id, url } (stored) | { blob, width, height, name } (not saved yet) | null }
  const pics = {};
  for (const [key] of IMAGE_KEYS) {
    const f = await db.getFile(o[key]);
    pics[key] = f ? { id: f.id, url: fileUrl(f) } : null;
  }
  const report = { images: [], pages: [] };

  main.innerHTML = html`
<div class="head">
  <div><h1>${params.id ? o.client_name || "Offer" : "New offer"}</h1><div class="muted"><a href="#/offers">Offer decks</a> · fill in the essentials and add the Helioscope reports; the rest is worked out.</div></div>
  <div class="actions">${params.id ? html`<button class="btn danger small" id="delete" data-confirm="Delete this offer?">Delete</button>` : ""}
    <button class="btn" id="save">Save</button><button class="btn primary" id="deck">Save and download PowerPoint</button></div>
</div>
<form id="offer" class="quick" autocomplete="off">
  <div class="panel">
    <h2>Essentials</h2>
    <div class="fields">
      <label class="wide">Client name <input name="client_name" value="${o.client_name}" list="client-names" required></label>
      <label>Reference code <input name="reference_code" value="${o.reference_code || suggestCode(o.client_name)}"><span class="hint">In "HTC/&lt;code&gt;/TCO/01". Suggested from the client's initials</span></label>
      <label>Design type <select name="installation_type">${designTypes.map((t) => html`<option ${sel(t === o.installation_type)}>${t}</option>`)}<option value="__new">Add a type…</option></select></label>
      <label>Price (OMR per kWp) <input name="price_per_kwp" value="${g(o.price_per_kwp)}" inputmode="decimal" required><span class="hint" id="total"></span></label>
    </div>
    <datalist id="client-names">${byName(all.clients).map((c) => html`<option value="${c.name}">`)}</datalist>
  </div>

  <div class="panel">
    <h2>System</h2>
    <div class="fields">
      <label class="wide">PV module <select name="module_id">${moduleOptions(all.modules, o.module_id, { blank: "Not in the library (type the DC capacity)" })}</select></label>
      <label>Number of panels <input name="module_count" value="${g(o.module_count)}" inputmode="numeric"></label>
      <label>DC capacity (kWp) <input name="dc_kwp" value="${g(o.dc_kwp)}" inputmode="decimal"><span class="hint" id="dc-how"></span></label>
      <label class="wide">Inverter <select name="inverter_id">${inverterOptions(all.inverters, o.inverter_id, { blank: "Not in the library (type the AC capacity)" })}</select></label>
      <label>Number of inverters <input name="inverter_qty" value="${g(o.inverter_qty)}" inputmode="numeric"></label>
      <label>AC capacity (kW) <input name="ac_kw" value="${g(o.ac_kw)}" inputmode="decimal"><span class="hint" id="ac-how"></span></label>
      <label>Structure height (m) <input name="elevation_m" value="${g(o.elevation_m)}" inputmode="decimal"></label>
      <label>Tilt (°) <input name="tilt_deg" value="${g(o.tilt_deg)}" inputmode="decimal"></label>
      <label>Azimuth (°) <input name="azimuth_deg" value="${g(o.azimuth_deg)}" inputmode="decimal" placeholder="180 = south"></label>
    </div>
    ${!all.modules.length || !all.inverters.length ? html`<p class="small muted spaced-top">The equipment library is empty. <a href="#/library">Load the Jinko modules and Sungrow inverters</a> to pick them here.</p>` : ""}
  </div>

  <div class="panel">
    <h2>Helioscope reports</h2>
    <label>PDF reports <span class="hint">Choose the simulation and shading reports together. They fill in the equipment, counts, energy and shading loss (all editable), and the pictures for slides 14, 16 and 17</span>
      <input type="file" id="report" accept="application/pdf" multiple></label>
    <div id="report-found"></div>
  </div>

  <div class="panel">
    <h2>Pictures</h2>
    <p class="small muted">The arrows choose the corner the HTC logo sits in. It starts in the corner with the least going on.</p>
    <div class="pics" id="pics"></div>
    <div id="report-out"></div>
  </div>

  <div class="panel">
    <h2>Energy</h2>
    <div class="fields">
      <label>Annual generation (kWh) <input name="annual_gen_kwh" value="${g(o.annual_gen_kwh)}" inputmode="decimal"><span class="hint">Blank = DC × specific yield</span></label>
      <label>Specific yield (kWh/kWp) <input name="specific_yield" value="${g(o.specific_yield)}" inputmode="decimal" placeholder="${SPECIFIC_YIELD}"></label>
      <label>Shading losses (%) <input name="shading_loss_pct" value="${g(o.shading_loss_pct)}" inputmode="decimal"><span class="hint">Over ${SHADING_LIMIT_PCT}% is flagged on slide 16</span></label>
      <label>Tariff (bz/kWh) <input name="tariff_bz" value="${g(o.tariff_bz)}" inputmode="decimal"></label>
      <label>Yearly degradation (%) <input name="degradation_pct" value="${g(o.degradation_pct)}" inputmode="decimal"></label>
      <label class="wide">Monthly generation, Jan to Dec (kWh) <span class="hint">12 figures. Filled from the Helioscope chart; their total replaces the annual figure</span>
        <textarea name="monthly_kwh" rows="2">${Array.isArray(o.monthly_kwh) ? o.monthly_kwh.map((x) => Math.round(x)).join(" ") : ""}</textarea></label>
    </div>
    <div id="energy-chart" class="spaced-top"></div>
  </div>

  <div class="panel">
    <div class="panel-head"><h2>Project schedule</h2><button type="button" class="btn small" id="sched-reset">Reset to the template</button></div>
    <p class="small muted">Drag across a row to set when an activity runs, or type the start week and length. Weeks after the last activity are left off the deck.</p>
    <div class="gantt" id="gantt"></div>
  </div>
</form>
<h2 class="spaced-top">Preview</h2>
<div id="preview"></div>
<div class="crop" id="crop" hidden></div>`;

  const form = main.querySelector("#offer");
  const pos = (fd, k) => { const v = float(fd, k); return v !== null && v > 0 ? v : null; };

  /** The form as an offer record (pictures and corners are added on save). */
  function read() {
    const fd = new FormData(form);
    const monthlyRaw = str(fd, "monthly_kwh");
    const type = str(fd, "installation_type");
    return {
      ...o,
      client_name: str(fd, "client_name"), reference_code: str(fd, "reference_code").toUpperCase(),
      installation_type: type === "__new" ? o.installation_type : type,
      price_per_kwp: pos(fd, "price_per_kwp"), subtotal_omr: null,
      module_id: Number(fd.get("module_id")) || null, module_count: int(fd, "module_count"),
      inverter_id: Number(fd.get("inverter_id")) || null, inverter_qty: int(fd, "inverter_qty"),
      dc_kwp: pos(fd, "dc_kwp"), ac_kw: pos(fd, "ac_kw"),
      annual_gen_kwh: pos(fd, "annual_gen_kwh"), specific_yield: pos(fd, "specific_yield") ?? SPECIFIC_YIELD,
      monthly_kwh: monthlyRaw ? parseMonthly(monthlyRaw) : null, monthly_raw_bad: !!monthlyRaw && !parseMonthly(monthlyRaw),
      shading_loss_pct: float(fd, "shading_loss_pct"),
      tariff_bz: float(fd, "tariff_bz") ?? 32, degradation_pct: float(fd, "degradation_pct") ?? 0.65,
      elevation_m: pos(fd, "elevation_m"), tilt_deg: float(fd, "tilt_deg"), azimuth_deg: float(fd, "azimuth_deg"),
      schedule: schedule.map((a) => ({ ...a })), logo_corners: { ...corners },
    };
  }

  function setField(name, value) {
    const el = form.elements[name];
    if (el && value !== null && value !== undefined) el.value = typeof value === "number" ? g(value) : value;
  }

  function preview() {
    const cur = read();
    const p = toProject(cur, all);
    const { module, inverter, dc, ac } = capacities(cur, all);
    // capacities: worked out from the library item × count, typed in otherwise
    const dcIn = form.elements.dc_kwp, acIn = form.elements.ac_kw;
    dcIn.readOnly = !!(module && cur.module_count);
    acIn.readOnly = !!(inverter && cur.inverter_qty);
    if (dcIn.readOnly) dcIn.value = g(dc);
    if (acIn.readOnly) acIn.value = g(ac);
    main.querySelector("#dc-how").textContent = dcIn.readOnly ? `${cur.module_count} × ${g(module.wp)} Wp` : module ? "Enter the number of panels" : "";
    main.querySelector("#ac-how").textContent = acIn.readOnly ? `${cur.inverter_qty} × ${g(inverter.ac_kw)} kW` : inverter ? "Enter the number of inverters" : "";
    main.querySelector("#total").textContent = p.subtotal_omr ? `Total OMR ${fmtOmr(p.subtotal_omr)} before VAT (${num(cur.price_per_kwp, 3)} × ${num(dc)} kWp)` : "Total = price × DC kWp";
    if (!codeEdited) form.elements.reference_code.value = suggestCode(cur.client_name);

    const { values } = buildOfferValues(p);
    const months = Array.from({ length: 12 }, (_, i) => Number(String(values[`M${i + 1}`] || "").replace(/,/g, "")));
    main.querySelector("#energy-chart").innerHTML = months.every((m) => m > 0) ? monthlyBars(months).toString() : "";

    const missing = quickMissing(cur, all);
    const { source } = annualKwh(cur, dc);
    main.querySelector("#preview").innerHTML = html`
      ${missing.length ? html`<div class="flash warn">Still needs: ${missing.join(", ")}.</div>` : ""}
      ${cur.monthly_raw_bad ? html`<div class="flash warn">Monthly generation needs exactly 12 numbers; it's ignored until then.</div>` : ""}
      ${figures(p, source ? ENERGY_NOTE[source] : "")}`;
  }

  // ---- pictures
  function drawPics() {
    main.querySelector("#pics").innerHTML = html`${IMAGE_KEYS.map(([key, label, slide, hint]) => {
      const pic = pics[key];
      const src = pic ? pic.url || (pic.url = URL.createObjectURL(pic.blob)) : "";
      const slot = SLOT_OF[key], corner = corners[slot] || "tl";
      const logo = slot !== "site";
      return html`<div class="pic">
        <div class="pic-frame">${src ? html`<img src="${src}" alt="">${logo ? html`<img class="logo-badge ${corner}" src="data/htc_logo.jpg" alt="HTC logo">` : ""}` : html`<span class="muted small">No picture</span>`}</div>
        <b>${label} <span class="muted small">(${slide})</span></b><span class="hint small muted">${hint}</span>
        <div class="btns"><label class="btn small">Choose…<input type="file" accept="image/png,image/jpeg" data-pic="${key}" hidden></label>
          ${pic ? html`<button type="button" class="btn small" data-clear="${key}">Remove</button>` : ""}
          ${pic && logo ? html`<span class="corner-pick">${CORNERS.map(([c, arrow, name]) => html`<button type="button" class="btn small ${c === corner ? "on" : ""}" data-corner="${c}" data-slot="${slot}" title="Logo: ${name}">${arrow}</button>`)}</span>` : ""}</div>
      </div>`;
    })}`;
    for (const input of main.querySelectorAll("[data-pic]")) {
      input.addEventListener("change", async () => {
        const file = input.files[0];
        if (!file) return;
        try {
          const img = await readImage(file);
          corners[SLOT_OF[input.dataset.pic]] = await cornerOf(img.blob);
          setPic(input.dataset.pic, { ...img, name: file.name });
        } catch { toast(`${file.name} couldn't be read (PNG or JPG only).`, "error"); }
      });
    }
    for (const b of main.querySelectorAll("[data-clear]")) b.addEventListener("click", () => setPic(b.dataset.clear, null));
    for (const b of main.querySelectorAll("[data-corner]")) b.addEventListener("click", () => { corners[b.dataset.slot] = b.dataset.corner; drawPics(); });
  }
  function setPic(key, pic) {
    pics[key] = pic;
    drawPics();
  }
  const slotButtons = (attr, i) => html`${IMAGE_KEYS.map(([key]) => html`<button type="button" class="btn small" data-${attr}="${i}" data-slot="${key}">${SLOT_SHORT[key]}</button>`)}`;
  const usePic = (key, im) => {
    if (im.corner) corners[SLOT_OF[key]] = im.corner;
    setPic(key, { blob: im.blob, width: im.width, height: im.height, name: `${im.kind}-p${im.page}.jpg` });
  };

  // ---- Helioscope reports
  function drawReport() {
    const out = main.querySelector("#report-out");
    if (!report.pages.length) { out.innerHTML = ""; return; }
    out.innerHTML = html`
      <details class="spaced-top"><summary class="small">Other pictures and pages in the reports</summary>
      ${report.images.length ? html`<h3>Pictures</h3><p class="small muted">Click a slot under a picture to use it.</p>
      <div class="thumbs">${report.images.map((im, i) => html`<div class="thumb"><img src="${im.url}" alt=""><span class="small muted">${KIND_NAMES[im.kind]}, page ${im.page}</span><div class="btns">${slotButtons("img", i)}</div></div>`)}</div>` : ""}
      <h3>Pages</h3><p class="small muted">Crop a page for anything not listed above.</p>
      <div class="thumbs">${report.pages.map((pg, i) => html`<div class="thumb"><img src="${pg.url}" alt=""><span class="small muted">${KIND_NAMES[pg.kind]}, page ${pg.page}</span><div class="btns"><button type="button" class="btn small" data-crop="${i}">Crop…</button></div></div>`)}</div>
      </details>`;
    for (const b of out.querySelectorAll("[data-img]")) {
      b.addEventListener("click", () => { usePic(b.dataset.slot, report.images[Number(b.dataset.img)]); toast("Picture set."); });
    }
    for (const b of out.querySelectorAll("[data-crop]")) b.addEventListener("click", () => openCrop(report.pages[Number(b.dataset.crop)]));
  }

  main.querySelector("#report").addEventListener("change", async (e) => {
    const files = [...e.target.files];
    if (!files.length) return;
    const found = main.querySelector("#report-found");
    found.innerHTML = html`<div class="small muted spaced-top" id="report-progress">Opening the reports…</div>`;
    try {
      const { readReport, parseReport, monthsFromBars } = await import("../offer/helioscope.js");
      report.images = []; report.pages = [];
      let text = "", bars = null;
      for (const file of files) {
        const r = await readReport(file, (msg) => { const el = main.querySelector("#report-progress"); if (el) el.textContent = msg; });
        report.images.push(...r.images.map((im) => ({ ...im, kind: r.kind, url: URL.createObjectURL(im.blob) })));
        report.pages.push(...r.pages.map((pg) => ({ ...pg, kind: r.kind, url: URL.createObjectURL(pg.blob) })));
        text += r.text + "\n";
        bars ||= r.bars;
      }
      const f = parseReport(text, { modules: all.modules, inverters: all.inverters });
      const monthly = monthsFromBars(bars, f.annual_gen_kwh);
      // the reports' figures replace what's in the form (all can be edited afterwards)
      const filled = [];
      const put = (name, value, label) => { if (value !== undefined && value !== null) { setField(name, value); filled.push(label); } };
      put("module_id", f.module_id, "module");
      put("module_count", f.module_count, `${f.module_count} panels`);
      put("inverter_id", f.inverter_id, "inverter");
      put("inverter_qty", f.inverter_qty, `${f.inverter_qty} inverters`);
      if (!f.module_id) put("dc_kwp", f.dc_kwp, `${num(f.dc_kwp)} kWp DC`);
      if (!f.inverter_id) put("ac_kw", f.ac_kw, `${num(f.ac_kw)} kW AC`);
      put("annual_gen_kwh", f.annual_gen_kwh, `${num(f.annual_gen_kwh, 0)} kWh a year`);
      put("specific_yield", f.specific_yield, `${num(f.specific_yield, 1)} kWh/kWp`);
      if (monthly) put("monthly_kwh", monthly.map((x) => Math.round(x)).join(" "), "monthly generation");
      put("shading_loss_pct", f.shading_loss_pct, `${num(f.shading_loss_pct, 1)}% shading losses`);
      put("tilt_deg", f.tilt_deg, "tilt");
      put("azimuth_deg", f.azimuth_deg, "azimuth");
      if (/carport/i.test(f.racking || "")) put("installation_type", "Carpark", "design type");
      // the usual pictures go on their slides when those are empty
      const set = [];
      for (const slot of ["site", "shadow", "structure", "structure2"]) {
        const im = report.images.find((x) => x.slot === slot), key = FIELD_OF[slot];
        if (im && !pics[key]) { usePic(key, im); set.push(SLOT_SHORT[key].toLowerCase()); }
      }
      const notInLibrary = [f.module_model && !f.module_id && `module ${f.module_model}`, f.inverter_model && !f.inverter_id && `inverter ${f.inverter_model}`].filter(Boolean);
      found.innerHTML = html`
        <div class="flash ${filled.length ? "ok" : "warn"} spaced-top">${filled.length ? `Filled in from the reports: ${filled.join(", ")}.` : "No system figures found in these reports; fill them in by hand."}
          ${set.length ? ` Pictures: ${set.join(", ")}.` : ""}</div>
        ${notInLibrary.length ? html`<div class="flash warn">The ${notInLibrary.join(" and ")} named in the report isn't in the equipment library, so the capacity was typed in instead. <a href="#/library">Add it to the library</a> to get its spec slide.</div>` : ""}
        ${f.shading_loss_pct > SHADING_LIMIT_PCT ? html`<div class="flash warn">Shading losses in the report are ${num(f.shading_loss_pct, 1)}%, above ${SHADING_LIMIT_PCT}%.</div>` : ""}`;
      drawPics();
      drawReport();
      preview();
    } catch (err) {
      console.error(err);
      found.innerHTML = html`<div class="flash error spaced-top">Couldn't read that PDF: ${err.message || err}</div>`;
    }
  });

  // crop dialog: drag a rectangle on a page, then pick the slot
  function openCrop(pg) {
    const box = main.querySelector("#crop");
    box.hidden = false;
    box.innerHTML = html`<div class="crop-card">
      <div class="panel-head"><b>${KIND_NAMES[pg.kind]}, page ${pg.page}: drag over the part you want</b><button type="button" class="btn small" id="crop-close">Cancel</button></div>
      <div class="crop-stage"><img src="${pg.url}" alt="" draggable="false"><div class="crop-sel" hidden></div></div>
      <div class="btns spaced-top"><span class="small muted">Use as:</span>${slotButtons("use", 0)}</div></div>`;
    const stage = box.querySelector(".crop-stage"), img = stage.querySelector("img"), selBox = stage.querySelector(".crop-sel");
    let start = null, rect = null;
    const at = (e) => { const b = img.getBoundingClientRect(); return { x: Math.min(Math.max(e.clientX - b.left, 0), b.width), y: Math.min(Math.max(e.clientY - b.top, 0), b.height) }; };
    stage.addEventListener("pointerdown", (e) => { start = at(e); stage.setPointerCapture(e.pointerId); rect = null; selBox.hidden = true; });
    stage.addEventListener("pointermove", (e) => {
      if (!start) return;
      const p = at(e);
      rect = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) };
      Object.assign(selBox.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px` });
      selBox.hidden = false;
    });
    stage.addEventListener("pointerup", () => { start = null; });
    box.querySelector("#crop-close").addEventListener("click", () => { box.hidden = true; box.innerHTML = ""; });
    for (const b of box.querySelectorAll("[data-use]")) {
      b.addEventListener("click", async () => {
        const k = pg.width / img.getBoundingClientRect().width;
        const r = rect && rect.w > 8 && rect.h > 8 ? { x: rect.x * k, y: rect.y * k, w: rect.w * k, h: rect.h * k } : { x: 0, y: 0, w: pg.width, h: pg.height };
        const { crop } = await import("../offer/helioscope.js");
        usePic(b.dataset.slot, { ...(await crop(pg.blob, r)), kind: pg.kind, page: pg.page });
        box.hidden = true; box.innerHTML = "";
        toast("Picture set.");
      });
    }
  }

  // ---- schedule (Gantt)
  const gantt = main.querySelector("#gantt");
  const months = Array.from({ length: MAX_WEEKS / 4 }, (_, i) => i + 1);
  function drawGantt() {
    gantt.innerHTML = html`
      <div class="g-row g-head"><span>#</span><span>Activity</span><span>Start</span><span>Weeks</span>
        <div class="g-weeks">${months.map((m) => html`<b style="grid-column: span 4">Month ${m}</b>`)}</div></div>
      ${schedule.map((a, i) => html`<div class="g-row" data-row="${i}"><span>${a.n}</span>
        <input data-f="name" value="${a.name}" aria-label="Activity">
        <input data-f="start" value="${a.start}" inputmode="numeric" aria-label="Start week">
        <input data-f="weeks" value="${a.weeks}" inputmode="numeric" aria-label="Weeks">
        <div class="g-weeks" data-cells="${i}">${raw(cells(a))}</div></div>`)}`;
  }
  function cells(a) {
    let s = "";
    for (let w = 1; w <= MAX_WEEKS; w++) s += `<i data-w="${w}" class="${a.weeks > 0 && w >= a.start && w < a.start + a.weeks ? "on" : ""}${w % 4 === 0 ? " mend" : ""}" title="Week ${w}"></i>`;
    return s;
  }
  const redrawRow = (i) => {
    const row = gantt.querySelector(`[data-row="${i}"]`);
    row.querySelector("[data-cells]").innerHTML = cells(schedule[i]);
    row.querySelector('[data-f="start"]').value = schedule[i].start;
    row.querySelector('[data-f="weeks"]').value = schedule[i].weeks;
  };
  gantt.addEventListener("input", (e) => {
    const row = e.target.closest("[data-row]");
    if (!row || !e.target.dataset.f) return;
    const a = schedule[Number(row.dataset.row)], f = e.target.dataset.f;
    if (f === "name") a.name = e.target.value;
    else {
      const v = Math.round(Number(e.target.value));
      if (!Number.isFinite(v)) return;
      if (f === "start") a.start = Math.min(MAX_WEEKS, Math.max(1, v));
      else a.weeks = Math.min(MAX_WEEKS - a.start + 1, Math.max(0, v));
      row.querySelector("[data-cells]").innerHTML = cells(a);
    }
  });
  let drag = null;
  gantt.addEventListener("pointerdown", (e) => {
    const cell = e.target.closest("[data-w]");
    if (!cell) return;
    const i = Number(cell.closest("[data-row]").dataset.row);
    drag = { i, from: Number(cell.dataset.w) };
    schedule[i].start = drag.from; schedule[i].weeks = 1;
    redrawRow(i);
    e.preventDefault();
  });
  gantt.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const cell = document.elementFromPoint(e.clientX, e.clientY)?.closest?.(`[data-cells="${drag.i}"] [data-w]`);
    if (!cell) return;
    const w = Number(cell.dataset.w), a = schedule[drag.i];
    a.start = Math.min(drag.from, w); a.weeks = Math.abs(w - drag.from) + 1;
    redrawRow(drag.i);
  });
  window.addEventListener("pointerup", () => { drag = null; }, { once: false });
  main.querySelector("#sched-reset").addEventListener("click", () => {
    schedule.splice(0, schedule.length, ...DEFAULT_SCHEDULE.map((a) => ({ ...a })));
    drawGantt();
  });

  // ---- design types: add one on the spot
  form.elements.installation_type.addEventListener("change", async (e) => {
    if (e.target.value !== "__new") { o.installation_type = e.target.value; return; }
    const name = (window.prompt("New design type (e.g. Metal Sheet Roof):") || "").trim();
    if (!name) { e.target.value = o.installation_type; return; }
    const custom = await db.getSetting("design_types", []);
    if (!designTypes.includes(name)) { designTypes.push(name); await db.setSetting("design_types", [...custom, name]); }
    e.target.querySelector('[value="__new"]').insertAdjacentHTML("beforebegin", html`<option>${name}</option>`.toString());
    e.target.value = name;
    o.installation_type = name;
    preview();
  });
  form.elements.reference_code.addEventListener("input", (e) => { codeEdited = e.target.value.trim() !== ""; });

  async function save() {
    const cur = read();
    if (cur.monthly_raw_bad) { toast("Monthly generation needs exactly 12 numbers (Jan to Dec). Nothing was saved.", "error"); return null; }
    delete cur.monthly_raw_bad;
    if (!cur.reference_code) cur.reference_code = suggestCode(cur.client_name);
    const { dc, ac } = capacities(cur, all);
    cur.dc_kwp = dc; cur.ac_kw = ac;  // kept for the list and older code
    for (const [key] of IMAGE_KEYS) {
      const pic = pics[key];
      if (pic && !pic.id) {
        const fid = await db.putFile(pic.blob, pic.name || "picture.jpg", { width: pic.width, height: pic.height, kind: "offer" });
        pics[key] = { id: fid, url: pic.url };
      }
      const newId = pics[key]?.id || null;
      if (o[key] && o[key] !== newId) await db.delFile(o[key]);
      cur[key] = newId;
    }
    const id = await db.put("offers", cur);
    o = { ...cur, id };
    return o;
  }

  form.addEventListener("input", preview);
  form.addEventListener("change", preview);
  form.addEventListener("submit", (e) => e.preventDefault());
  main.querySelector("#save").addEventListener("click", (e) => busy(e.target, async () => {
    if (!(await save())) return;
    toast("Offer saved.");
    if (!params.id) go(`#/offers/quick/${o.id}`);
  }));
  main.querySelector("#deck").addEventListener("click", (e) => busy(e.target, async () => {
    const missing = quickMissing(read(), all);
    if (missing.length && !window.confirm(`Still needs: ${missing.join(", ")}. Make the deck anyway, with those parts blank?`)) return;
    if (!(await save())) return;
    const { blob, filename } = await generateOffer(toProject(o, all));
    download(blob, filename);
    if (!params.id) history.replaceState(null, "", `#/offers/quick/${o.id}`);
  }));
  main.querySelector("#delete")?.addEventListener("click", async () => {
    for (const [key] of IMAGE_KEYS) await db.delFile(o[key]);
    await db.del("offers", o.id);
    toast("Offer deleted.");
    go("#/offers");
  });

  drawPics();
  drawGantt();
  preview();
}
