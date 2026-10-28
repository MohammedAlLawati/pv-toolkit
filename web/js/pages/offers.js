// Offer decks: the techno-commercial PowerPoint, either as a quick offer (client, capacities,
// price, pictures or a Helioscope report) or from a full project, with a preview of the
// figures that go into it. The deck itself is filled in js/offer/ (see generateOffer).
import { download, fileUrl, float, g, go, html, num, readImage, shortDate, str, toast } from "../ui.js";
import * as db from "../store.js";
import { byName, byUpdated, dcKwp, loadAll } from "../data.js";
import { setTitle } from "../app.js";
import { generateOffer } from "../docgen/generate.js";
import { fmtOmr } from "../docgen/context.js";
import { MONTHS, buildOfferValues, offerMissing, parseMonthly } from "../offer/values.js";
import { IMAGE_KEYS, QUICK_DEFAULTS, SPECIFIC_YIELD, annualKwh, quickMissing, toProject } from "../offer/quick.js";
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
    <tbody>${offers.map((o) => html`<tr>
      <td><a href="#/offers/quick/${o.id}">${o.client_name || "(no name)"}</a></td>
      <td class="r num">${num(o.dc_kwp)}</td><td class="r num">${num(o.ac_kw)}</td>
      <td class="r num">${fmtOmr(o.subtotal_omr) || "—"}</td>
      <td class="muted small">${shortDate(o.updated_at)}</td>
      <td class="r"><button class="btn small" data-quick="${o.id}">PowerPoint</button></td></tr>`)}</tbody>
  </table></div>` : html`<div class="empty">No offers yet. <a href="#/offers/new">Make one</a> from the client name, capacity, price and pictures (or a Helioscope report).</div>`}
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

function monthlyBars(months) {
  const max = Math.max(...months, 1);
  return html`<div class="bars">${months.map((k, i) => html`
    <div class="bar" title="${MONTHS[i]}: ${num(k, 0)} kWh"><i style="height:${((k / max) * 100).toFixed(1)}%"></i><span>${MONTHS[i]}</span></div>`)}</div>`;
}

/** Summary row plus energy / returns / environment panels for a project-shaped record. */
function figures(p, energyNote) {
  const { values: v, months, flow, annual } = buildOfferValues(p);
  const cum25 = flow?.years[24]?.cumulative;
  return html`
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

const SLOT_NAMES = { offer_site_file_id: "Location", offer_shadow_file_id: "Shading", offer_structure_file_id: "Structure" };

const ENERGY_NOTE = {
  monthly: "Monthly figures as entered.",
  annual: "Monthly figures are the annual figure spread over a typical Oman year.",
  yield: "Estimated as DC capacity × specific yield, spread over a typical Oman year.",
};

export async function quick(main, { params, query }) {
  const all = await loadAll();
  let o;
  if (params.id) {
    o = await db.get("offers", params.id);
    if (!o) return notFound(main, "Offer");
  } else {
    o = { ...QUICK_DEFAULTS };
    // start from the most recent offer's equipment and commercial settings
    const last = byUpdated(await db.list("offers"))[0];
    if (last) for (const k of ["module_id", "inverter_id", "installation_type", "tariff_bz", "degradation_pct", "specific_yield"]) o[k] = last[k];
    if (query.client) o.client_name = query.client;
  }
  setTitle(params.id ? `Offer · ${o.client_name}` : "New offer");

  // pictures: { key: { id } (stored) | { blob, width, height, name } (not saved yet) | null }
  const pics = {};
  for (const [key] of IMAGE_KEYS) {
    const f = await db.getFile(o[key]);
    pics[key] = f ? { id: f.id, url: fileUrl(f) } : null;
  }
  const report = { found: null, images: [], pages: [] };

  main.innerHTML = html`
<div class="head">
  <div><h1>${params.id ? o.client_name || "Offer" : "New offer"}</h1><div class="muted"><a href="#/offers">Offer decks</a> · fill in the essentials, the rest is worked out.</div></div>
  <div class="actions">${params.id ? html`<button class="btn danger small" id="delete" data-confirm="Delete this offer?">Delete</button>` : ""}
    <button class="btn" id="save">Save</button><button class="btn primary" id="deck">Save and download PowerPoint</button></div>
</div>
<form id="offer" class="quick" autocomplete="off">
  <div class="panel">
    <h2>Essentials</h2>
    <div class="fields">
      <label class="wide">Client name <input name="client_name" value="${o.client_name}" list="client-names" required></label>
      <label>DC capacity (kWp) <input name="dc_kwp" value="${g(o.dc_kwp)}" inputmode="decimal" required></label>
      <label>AC capacity (kW) <input name="ac_kw" value="${g(o.ac_kw)}" inputmode="decimal" required></label>
      <label>Price before VAT (OMR) <input name="subtotal_omr" value="${g(o.subtotal_omr)}" inputmode="decimal" required></label>
      <label>Reference code <input name="reference_code" value="${o.reference_code}" placeholder="Client initials"><span class="hint">In "HTC/&lt;code&gt;/TCO/01"</span></label>
    </div>
    <datalist id="client-names">${byName(all.clients).map((c) => html`<option value="${c.name}">`)}</datalist>
  </div>

  <div class="panel">
    <div class="panel-head"><h2>Helioscope report <span class="muted small">(optional)</span></h2></div>
    <label>PDF report <span class="hint">Fills in the capacities, generation and equipment it names, and lets you pick pictures out of it</span>
      <input type="file" id="report" accept="application/pdf"></label>
    <div id="report-out"></div>
  </div>

  <div class="panel">
    <h2>Pictures</h2>
    <div class="pics" id="pics"></div>
  </div>

  <div class="panel">
    <h2>Energy</h2>
    <div class="fields">
      <label>Annual generation (kWh) <input name="annual_gen_kwh" value="${g(o.annual_gen_kwh)}" inputmode="decimal"><span class="hint">Blank = DC × specific yield</span></label>
      <label>Specific yield (kWh/kWp) <input name="specific_yield" value="${g(o.specific_yield)}" inputmode="decimal" placeholder="${SPECIFIC_YIELD}"></label>
      <label>Tariff (bz/kWh) <input name="tariff_bz" value="${g(o.tariff_bz)}" inputmode="decimal"></label>
      <label>Yearly degradation (%) <input name="degradation_pct" value="${g(o.degradation_pct)}" inputmode="decimal"></label>
      <label class="wide">Monthly generation, Jan to Dec (kWh) <span class="hint">Optional: 12 figures from PVsyst or Helioscope. Their total replaces the annual figure</span>
        <textarea name="monthly_kwh" rows="2">${Array.isArray(o.monthly_kwh) ? o.monthly_kwh.map((x) => g(x)).join(" ") : ""}</textarea></label>
    </div>
  </div>

  <div class="panel">
    <h2>Equipment and site <span class="muted small">(optional)</span></h2>
    <div class="fields">
      <label class="wide">PV module <select name="module_id">${moduleOptions(all.modules, o.module_id, { blank: "Not chosen (spec slide left blank)" })}</select>
        <span class="hint" id="module-count"></span></label>
      <label class="wide">Inverter <select name="inverter_id">${inverterOptions(all.inverters, o.inverter_id, { blank: "Not chosen (spec slide left blank)" })}</select>
        <span class="hint" id="inverter-qty"></span></label>
      <label>Installation type <input name="installation_type" value="${o.installation_type}" list="install-types"></label>
      <label>Structure height (m) <input name="elevation_m" value="${g(o.elevation_m)}" inputmode="decimal"></label>
      <label>Tilt (°) <input name="tilt_deg" value="${g(o.tilt_deg)}" inputmode="decimal"></label>
      <label>Azimuth (°) <input name="azimuth_deg" value="${g(o.azimuth_deg)}" inputmode="decimal" placeholder="180 = south"></label>
    </div>
    <datalist id="install-types"><option value="Elevated Flat Roof"><option value="Flush-mount Flat Roof"><option value="Metal Sheet Roof"><option value="Car Park Structure"><option value="Ground Mount"></datalist>
  </div>
</form>
<h2 class="spaced-top">Preview</h2>
<div id="preview"></div>
<div class="crop" id="crop" hidden></div>`;

  const form = main.querySelector("#offer");
  const pos = (fd, k) => { const v = float(fd, k); return v !== null && v > 0 ? v : null; };

  /** The form as an offer record (does not touch pictures). */
  function read() {
    const fd = new FormData(form);
    const monthlyRaw = str(fd, "monthly_kwh");
    return {
      ...o,
      client_name: str(fd, "client_name"), reference_code: str(fd, "reference_code").toUpperCase(),
      dc_kwp: pos(fd, "dc_kwp"), ac_kw: pos(fd, "ac_kw"), subtotal_omr: pos(fd, "subtotal_omr"),
      annual_gen_kwh: pos(fd, "annual_gen_kwh"), specific_yield: pos(fd, "specific_yield") ?? SPECIFIC_YIELD,
      monthly_kwh: monthlyRaw ? parseMonthly(monthlyRaw) : null, monthly_raw_bad: !!monthlyRaw && !parseMonthly(monthlyRaw),
      tariff_bz: float(fd, "tariff_bz") ?? 32, degradation_pct: float(fd, "degradation_pct") ?? 0.65,
      module_id: Number(fd.get("module_id")) || null, inverter_id: Number(fd.get("inverter_id")) || null,
      installation_type: str(fd, "installation_type"), elevation_m: pos(fd, "elevation_m"),
      tilt_deg: float(fd, "tilt_deg"), azimuth_deg: float(fd, "azimuth_deg"),
    };
  }

  function preview() {
    const cur = read();
    const p = toProject(cur, all);
    const { source } = annualKwh(cur);
    main.querySelector("#module-count").textContent = p.module_count ? `${p.module_count} modules for ${num(cur.dc_kwp)} kWp` : "";
    main.querySelector("#inverter-qty").textContent = p.inverter_qty ? `${p.inverter_qty} inverter${p.inverter_qty === 1 ? "" : "s"} for ${num(cur.ac_kw)} kW` : "";
    const missing = quickMissing(cur);
    main.querySelector("#preview").innerHTML = html`
      ${missing.length ? html`<div class="flash warn">Still needs: ${missing.join(", ")}.</div>` : ""}
      ${cur.monthly_raw_bad ? html`<div class="flash warn">Monthly generation needs exactly 12 numbers; it's ignored until then.</div>` : ""}
      ${figures(p, source ? ENERGY_NOTE[source] : "")}`;
  }

  function setField(name, value) {
    const el = form.elements[name];
    if (el && value !== null && value !== undefined) el.value = typeof value === "number" ? g(value) : value;
  }

  // pictures
  function drawPics() {
    main.querySelector("#pics").innerHTML = html`${IMAGE_KEYS.map(([key, label, hint]) => {
      const pic = pics[key];
      const src = pic ? pic.url || (pic.url = URL.createObjectURL(pic.blob)) : "";
      return html`<div class="pic">
        <div class="pic-frame">${src ? html`<img src="${src}" alt="">` : html`<span class="muted small">No picture</span>`}</div>
        <b>${label}</b><span class="hint small muted">${hint}</span>
        <div class="btns"><label class="btn small">Choose…<input type="file" accept="image/png,image/jpeg" data-pic="${key}" hidden></label>
          ${pic ? html`<button type="button" class="btn small" data-clear="${key}">Remove</button>` : ""}</div>
      </div>`;
    })}`;
    for (const input of main.querySelectorAll("[data-pic]")) {
      input.addEventListener("change", async () => {
        const file = input.files[0];
        if (!file) return;
        try { setPic(input.dataset.pic, { ...(await readImage(file)), name: file.name }); }
        catch { toast(`${file.name} couldn't be read (PNG or JPG only).`, "error"); }
      });
    }
    for (const b of main.querySelectorAll("[data-clear]")) b.addEventListener("click", () => setPic(b.dataset.clear, null));
  }
  function setPic(key, pic) {
    pics[key] = pic;
    drawPics();
  }
  const slotButtons = (attr, i) => html`${IMAGE_KEYS.map(([key]) => html`<button type="button" class="btn small" data-${attr}="${i}" data-slot="${key}">${SLOT_NAMES[key]}</button>`)}`;

  // Helioscope report
  function drawReport() {
    const out = main.querySelector("#report-out");
    const f = report.found;
    if (!f) { out.innerHTML = ""; return; }
    const said = [f.dc_kwp && `${num(f.dc_kwp)} kWp DC`, f.ac_kw && `${num(f.ac_kw)} kW AC`, f.annual_gen_kwh && `${num(f.annual_gen_kwh, 0)} kWh a year`,
      f.module_id && "the module", f.inverter_id && "the inverter"].filter(Boolean);
    out.innerHTML = html`
      <div class="flash ${said.length ? "ok" : "warn"} spaced-top">${said.length ? `Filled in from the report: ${said.join(", ")}.` : "No system figures found in the report's text; fill them in by hand."}</div>
      ${report.images.length ? html`<h3>Pictures in the report</h3><p class="small muted">Click a slot under a picture to use it.</p>
      <div class="thumbs">${report.images.map((im, i) => html`<div class="thumb"><img src="${im.url}" alt=""><span class="small muted">Page ${im.page} · ${im.width}×${im.height}</span><div class="btns">${slotButtons("img", i)}</div></div>`)}</div>` : ""}
      <h3>Pages</h3><p class="small muted">Crop a page to take the layout or shading view from it.</p>
      <div class="thumbs">${report.pages.map((pg, i) => html`<div class="thumb"><img src="${pg.url}" alt=""><span class="small muted">Page ${pg.page}</span><div class="btns"><button type="button" class="btn small" data-crop="${i}">Crop…</button></div></div>`)}</div>`;
    for (const b of out.querySelectorAll("[data-img]")) {
      b.addEventListener("click", () => { const im = report.images[Number(b.dataset.img)]; setPic(b.dataset.slot, { ...im, url: null, name: `report-p${im.page}.jpg` }); toast("Picture set."); });
    }
    for (const b of out.querySelectorAll("[data-crop]")) b.addEventListener("click", () => openCrop(report.pages[Number(b.dataset.crop)]));
  }

  main.querySelector("#report").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const out = main.querySelector("#report-out");
    out.innerHTML = html`<div class="small muted spaced-top" id="report-progress">Opening the report…</div>`;
    try {
      const { readReport, parseReport } = await import("../offer/helioscope.js");
      const r = await readReport(file, (msg) => { const el = main.querySelector("#report-progress"); if (el) el.textContent = msg; });
      report.images = r.images.map((im) => ({ ...im, url: URL.createObjectURL(im.blob) }));
      report.pages = r.pages.map((pg) => ({ ...pg, url: URL.createObjectURL(pg.blob) }));
      report.found = parseReport(r.text, { modules: all.modules, inverters: all.inverters });
      const f = report.found;
      for (const k of ["dc_kwp", "ac_kw", "annual_gen_kwh", "specific_yield", "module_id", "inverter_id"]) setField(k, f[k]);
      drawReport();
      preview();
    } catch (err) {
      console.error(err);
      out.innerHTML = html`<div class="flash error spaced-top">Couldn't read that PDF: ${err.message || err}</div>`;
    }
  });

  // crop dialog: drag a rectangle on a page, then pick the slot
  function openCrop(pg) {
    const box = main.querySelector("#crop");
    box.hidden = false;
    box.innerHTML = html`<div class="crop-card">
      <div class="panel-head"><b>Page ${pg.page}: drag over the part you want</b><button type="button" class="btn small" id="crop-close">Cancel</button></div>
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
        setPic(b.dataset.slot, { ...(await crop(pg.blob, r)), name: `report-p${pg.page}-crop.jpg` });
        box.hidden = true; box.innerHTML = "";
        toast("Picture set.");
      });
    }
  }

  async function save() {
    const cur = read();
    if (cur.monthly_raw_bad) { toast("Monthly generation needs exactly 12 numbers (Jan to Dec). Nothing was saved.", "error"); return null; }
    delete cur.monthly_raw_bad;
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
    const missing = quickMissing(read());
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
  preview();
}
