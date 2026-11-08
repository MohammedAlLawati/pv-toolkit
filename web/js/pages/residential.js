// Residential offers: the homeowner's offer as a Word document (the Execution Agreement
// template), separate from the Offer decks page. Same kind of inputs as a quick offer (client,
// module and panels, inverter, price per kWp, generation, tariff), one system, one inverter
// model. The figures are worked out live; Preview shows the filled document.
import { download, fileUrl, g, go, html, num, sel, shortDate, toast } from "../ui.js";
import * as db from "../store.js";
import { byName, byUpdated, loadAll } from "../data.js";
import { setTitle } from "../app.js";
import { generate } from "../docgen/generate.js";
import { fmtOmr } from "../docgen/context.js";
import { DCAC_GREEN, DCAC_MAX, DCAC_MIN, DESIGN_TYPES, SPECIFIC_YIELD } from "../offer/quick.js";
import { inverterOptions, moduleOptions, partyOptions } from "../options.js";
import { requiredCapacity } from "../clients/model.js";
import { fit, renderPreview } from "../forms/preview.js";
import { DEFAULT_DEGRADATION, DEFAULT_TARIFF_NOTE, DOC_KEY, RESIDENTIAL_DEFAULTS, VAT_PCT, filename, missing,
         panelsFor, ratioIssue, suggestions, toProject, totals } from "../residential/offer.js";

const STORE = "residential";
const FLASH_OF = { ok: "ok", high: "warn", bad: "error" };

async function build(o, all) {
  const { blob } = await generate(DOC_KEY, toProject(o, all, all.parties));
  return { blob, filename: filename(o) };
}

async function busy(btn, fn) {
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = "Working…";
  try { await fn(); } catch (err) { console.error(err); toast("Couldn't make the offer: " + err.message, "error"); }
  finally { btn.disabled = false; btn.textContent = label; }
}

// ---- list --------------------------------------------------------------------------------

export async function list(main) {
  setTitle("Residential offers");
  const all = await loadAll();
  const offers = byUpdated(await db.list(STORE));
  main.innerHTML = html`
<div class="head">
  <div><h1>Residential offers</h1><div class="muted">The homeowner's offer as a Word document: system, price, payback, warranties and payment terms on two pages.</div></div>
  <div class="actions"><a class="btn primary" href="#/residential/new">New residential offer</a></div>
</div>
<div class="panel">
  <h2>Offers</h2>
  ${offers.length ? html`<div class="table-scroll"><table>
    <thead><tr><th>Client</th><th class="r">DC kWp</th><th class="r">AC kW</th><th class="r">Price before VAT (OMR)</th><th>Updated</th><th></th></tr></thead>
    <tbody>${offers.map((o) => { const t = totals(o, all); return html`<tr>
      <td><a href="#/residential/${o.id}">${o.client_name || "(no name)"}</a></td>
      <td class="r num">${num(t.dc)}</td><td class="r num">${num(t.ac)}</td>
      <td class="r num">${fmtOmr(t.subtotal) || "—"}</td>
      <td class="muted small">${shortDate(o.updated_at)}</td>
      <td class="r"><button class="btn small" data-word="${o.id}">Word</button></td></tr>`; })}</tbody>
  </table></div>` : html`<div class="empty">No residential offers yet. <a href="#/residential/new">Make one</a> from the client, the panels, the inverter and the price per kWp.</div>`}
</div>`;
  const byId = new Map(offers.map((o) => [o.id, o]));
  for (const b of main.querySelectorAll("[data-word]")) {
    b.addEventListener("click", () => busy(b, async () => {
      const { blob, filename: name } = await build(byId.get(Number(b.dataset.word)), all);
      download(blob, name);
    }));
  }
}

// ---- one offer ---------------------------------------------------------------------------

const clientMeter = (c) => (Array.isArray(c?.meter_numbers) ? c.meter_numbers[0] || "" : "");

export async function form(main, { params, query }) {
  const all = await loadAll();
  let o;
  if (params.id) {
    o = await db.get(STORE, params.id);
    if (!o) { main.innerHTML = html`<div class="panel empty">Offer not found. <a href="#/residential">Back to residential offers</a>.</div>`; return; }
    o = { ...RESIDENTIAL_DEFAULTS, ...o };
  } else {
    o = { ...RESIDENTIAL_DEFAULTS };
    // start from the most recent offer's equipment and commercial settings
    const last = byUpdated(await db.list(STORE))[0];
    if (last) for (const k of ["module_id", "inverter_id", "price_per_kwp", "tariff_bz", "specific_yield", "installation_type", "tariff_note"]) {
      if (last[k] !== undefined && last[k] !== null) o[k] = last[k];
    }
    o.contractor_id = last?.contractor_id ?? all.parties.find((x) => x.kind === "contractor" && x.is_default)?.id ?? null;
    const c = query.client_id ? all.client.get(Number(query.client_id)) : null;
    if (c) Object.assign(o, { client_id: c.id, client_name: c.name, account_no: clientMeter(c), wilaya: c.wilaya || "", mobile: c.mobile || "" });
  }
  setTitle(params.id ? `Residential offer · ${o.client_name}` : "New residential offer");
  const designTypes = [...new Set([...DESIGN_TYPES, ...(await db.getSetting("design_types", [])), o.installation_type].filter(Boolean))];
  const clients = byName(all.clients.filter((c) => c.client_type !== "commercial"));
  const contractors = byName(all.parties.filter((x) => x.kind === "contractor"));

  main.innerHTML = html`
<div class="head">
  <div><h1>${params.id ? o.client_name || "Residential offer" : "New residential offer"}</h1><div class="muted"><a href="#/residential">Residential offers</a> · fills the residential Execution Agreement (Word).</div></div>
  <div class="actions">${params.id ? html`<button class="btn danger small" id="delete" data-confirm="Delete this offer?">Delete</button>` : ""}
    <button class="btn" id="preview-btn" type="button">Preview</button>
    <button class="btn" id="save" type="button">Save</button>
    <button class="btn primary" id="word" type="button">Save and download Word</button></div>
</div>
<form id="res" autocomplete="off">
  <div class="panel">
    <h2>Client</h2>
    <div class="fields">
      <label>From a client <select name="client_id"><option value="">— Type the details below —</option>${clients.map((c) => html`<option value="${c.id}" ${sel(c.id === o.client_id)}>${c.name}</option>`)}</select><span class="hint"><a href="#/clients/new">Add a client</a></span></label>
      <label class="wide">Homeowner's name <input name="client_name" value="${o.client_name}" dir="auto" required></label>
      <label>Meter account number <input name="account_no" value="${o.account_no}"></label>
      <label>Wilayat <input name="wilaya" value="${o.wilaya}" dir="auto"></label>
      <label>Contact number <input name="mobile" value="${o.mobile}" inputmode="tel"></label>
    </div>
    <div id="client-note" class="small muted"></div>
  </div>

  <div class="panel">
    <h2>System</h2>
    ${!all.modules.length || !all.inverters.length ? html`<p class="small muted">The equipment library is empty. <a href="#/library">Load the Jinko modules and Sungrow inverters</a> to pick them here.</p>` : ""}
    <div class="fields">
      <label>Type of rooftop installation <select name="installation_type">${designTypes.map((t) => html`<option ${sel(t === o.installation_type)}>${t}</option>`)}</select></label>
      <label>Structure height (m) <input name="elevation_m" value="${g(o.elevation_m)}" inputmode="decimal"><span class="hint">Printed after the type, e.g. "(2m high)". Blank leaves it out</span></label>
    </div>
    <div class="fields spaced-top">
      <label class="wide">PV module <select name="module_id">${moduleOptions(all.modules, o.module_id)}</select></label>
      <label>Number of panels <input name="modules" value="${g(o.modules)}" inputmode="numeric"><span class="hint" id="panels-hint"></span></label>
    </div>
    <div class="fields spaced-top">
      <label class="wide">Inverter <select name="inverter_id">${inverterOptions(all.inverters, o.inverter_id)}</select></label>
      <label>Number of inverters <input name="inverter_qty" value="${g(o.inverter_qty)}" inputmode="numeric"></label>
    </div>
    <div id="ratio"></div>
    <div id="suggest"></div>
    <div id="system-summary" class="spaced-top"></div>
  </div>

  <div class="panel">
    <h2>Energy and price</h2>
    <div class="fields">
      <label>Price (OMR per kWp) <input name="price_per_kwp" value="${g(o.price_per_kwp)}" inputmode="decimal" required><span class="hint" id="total"></span></label>
      <label>Annual generation, year 1 (kWh) <input name="annual_gen_kwh" value="${g(o.annual_gen_kwh)}" inputmode="decimal"><span class="hint" id="gen-hint">Blank = DC kWp × specific yield</span></label>
      <label>Specific yield (kWh/kWp) <input name="specific_yield" value="${g(o.specific_yield)}" inputmode="decimal" placeholder="${SPECIFIC_YIELD}"></label>
      <label>Yearly degradation (%) <input name="degradation_pct" value="${g(o.degradation_pct)}" inputmode="decimal"><span class="hint" id="deg-hint"></span></label>
      <label>Tariff (bz/kWh) <input name="tariff_bz" value="${g(o.tariff_bz)}" inputmode="decimal"><span class="hint">Values the energy produced</span></label>
      <label class="wide">Tariff note <input name="tariff_note" value="${o.tariff_note}" placeholder="${DEFAULT_TARIFF_NOTE}"><span class="hint">After "assumed to be at a rate of … bz/kWh,". Blank = the template's wording</span></label>
    </div>
    <div id="money" class="spaced-top"></div>
  </div>

  <div class="panel">
    <h2>Contractor and picture</h2>
    <div class="fields">
      <label>Contractor <select name="contractor_id">${partyOptions(contractors, o.contractor_id)}</select><span class="hint"><a href="#/parties/new?kind=contractor">Add one</a></span></label>
    </div>
    <h3 class="spaced-top">Picture from the shading report</h3>
    <p class="small muted">The document has one picture, in the Design Summary box. Load the Helioscope shading report and pick one of its pictures.</p>
    <div class="fields">
      <label>Shading report (PDF) <input type="file" name="shading_report" accept="application/pdf"><span class="hint" id="report-status">Shading heatmap and the two 3D views</span></label>
      <div id="layout-img"></div>
    </div>
    <div id="report-pics" class="report-pics"></div>
    <p class="small muted">Name, address, phone and e-mail come from the contractor's entry. Warranties, payment milestones and the schedule are as in the template.</p>
  </div>
</form>
<div id="needs"></div>
<div class="panel">
  <div class="panel-head"><h2>Preview</h2><span class="small muted" id="preview-note"></span></div>
  <div id="preview" class="preview-area"><div class="empty">Press Preview to see the filled offer.</div></div>
</div>`;

  const f = main.querySelector("#res");
  // the one picture: chosen from the shading report's pictures. A picked picture is stored at once
  // (so Preview shows it) and replaces the saved one on save.
  let pendingId = null, removeLayout = false;
  const layoutId = () => (removeLayout ? null : pendingId ?? o.layout_file_id ?? null);
  const showLayout = async () => {
    const rec = layoutId() ? await db.getFile(layoutId()) : null;
    main.querySelector("#layout-img").innerHTML = rec ? String(html`<span class="small">In the document:</span>
      <img class="stamp-preview" src="${fileUrl(rec)}" alt=""> <button type="button" class="btn small" id="layout-remove">Remove</button>`)
      : String(html`<span class="small muted">No picture yet: the Design Summary box stays empty.</span>`);
    main.querySelector("#layout-remove")?.addEventListener("click", async () => {
      if (pendingId) { await db.delFile(pendingId); pendingId = null; }
      removeLayout = true;
      await showLayout();
    });
  };
  await showLayout();
  let reportImages = [];
  f.elements.shading_report.addEventListener("change", async () => {
    const file = f.elements.shading_report.files[0];
    const status = main.querySelector("#report-status"), box = main.querySelector("#report-pics");
    for (const im of reportImages) URL.revokeObjectURL(im.url);
    reportImages = []; box.innerHTML = "";
    if (!file) return;
    status.textContent = "Opening…";
    try {
      const { readReport } = await import("../offer/helioscope.js");
      const r = await readReport(file, (msg) => { status.textContent = msg; });
      status.innerHTML = r.kind === "shading" ? html`<span class="ok-text">${file.name}</span>`.toString()
        : html`<span class="missing-text">${file.name} doesn't look like a shading report; its pictures are shown anyway</span>`.toString();
      // the heatmap first, then the 3D views, then anything else
      const rank = { shadow: 0, structure: 1, structure2: 2 };
      reportImages = [...r.images].sort((a, b) => (rank[a.slot] ?? 9) - (rank[b.slot] ?? 9))
        .map((im) => ({ ...im, url: URL.createObjectURL(im.blob) }));
      box.innerHTML = reportImages.length ? html`<span class="small muted">Click the picture to use:</span>
        ${reportImages.map((im, i) => html`<button type="button" class="btn pic-pick" data-img="${i}" title="Page ${im.page}"><img src="${im.url}" alt=""></button>`)}`.toString()
        : html`<div class="flash warn">No pictures found in ${file.name}.</div>`.toString();
      if (reportImages.length && !layoutId()) await usePicture(reportImages[0]);
    } catch (err) {
      console.error(err);
      status.innerHTML = html`<span class="missing-text">Couldn't read ${file.name}: ${err.message || err}</span>`.toString();
    }
  });
  async function usePicture(im) {
    if (pendingId) await db.delFile(pendingId);
    pendingId = await db.putFile(im.blob, `shading-report-p${im.page}.png`, { width: im.width, height: im.height, kind: "layout" });
    removeLayout = false;
    for (const b of main.querySelectorAll("[data-img]")) b.classList.toggle("on", reportImages[Number(b.dataset.img)] === im);
    await showLayout();
  }
  main.querySelector("#report-pics").addEventListener("click", (e) => {
    const b = e.target.closest("[data-img]");
    if (b) usePicture(reportImages[Number(b.dataset.img)]).then(() => toast("Picture set."));
  });  const numOf = (name) => {
    const s = String(f.elements[name].value || "").replace(/,/g, "").trim();
    if (s === "") return null;
    const v = Number(s);
    return Number.isFinite(v) ? v : null;
  };
  const idOf = (name) => (/^\d+$/.test(f.elements[name].value) ? Number(f.elements[name].value) : null);
  const text = (name) => String(f.elements[name].value || "").trim();

  function read() {
    return {
      ...o,
      client_id: idOf("client_id"), client_name: text("client_name"), account_no: text("account_no"),
      wilaya: text("wilaya"), mobile: text("mobile"),
      installation_type: f.elements.installation_type.value, elevation_m: numOf("elevation_m"),
      module_id: idOf("module_id"), modules: numOf("modules"),
      inverter_id: idOf("inverter_id"), inverter_qty: numOf("inverter_qty"),
      price_per_kwp: numOf("price_per_kwp"), annual_gen_kwh: numOf("annual_gen_kwh"),
      specific_yield: numOf("specific_yield") ?? SPECIFIC_YIELD, degradation_pct: numOf("degradation_pct"),
      tariff_bz: numOf("tariff_bz") ?? 32, tariff_note: text("tariff_note"),
      contractor_id: idOf("contractor_id"),
    };
  }

  let picks = [];
  // only what changed is redrawn: a button replaced between press and release never gets the click
  const put = (sel, markup) => { const el = main.querySelector(sel); markup = String(markup); if (el.dataset.markup !== markup) { el.innerHTML = markup; el.dataset.markup = markup; } };
  function refresh() {
    const cur = read();
    const t = totals(cur, all);
    const client = cur.client_id ? all.client.get(cur.client_id) : null;
    const req = requiredCapacity(client);
    const reqPanels = req && req.unit === "dc" && t.module ? panelsFor(req.kw, t.module.wp) : null;
    main.querySelector("#client-note").textContent = req ? `This client asked for ${req.label}.` : "";
    main.querySelector("#panels-hint").textContent = t.dc ? `${num(cur.modules, 0)} × ${g(t.module.wp)} Wp = ${num(t.dc, 2)} kWp`
      : reqPanels ? `${reqPanels} panels make the ${req.label} asked for` : "";

    put("#ratio", t.dc && t.ac ? html`<div class="flash ${FLASH_OF[t.band]} spaced-top">${num(t.dc, 2)} kWp DC on ${num(t.ac, 1)} kW AC: DC/AC ratio <b>${num(t.ratio, 2)}</b>${
      t.band === "ok" ? `, within ${DCAC_MIN}–${DCAC_GREEN}.` : t.band === "high" ? `, above ${DCAC_GREEN} but within the ${DCAC_MAX} limit.` : `, outside ${DCAC_MIN}–${DCAC_MAX}. Pick one of the suggestions below.`}</div>` : "");

    picks = t.dc ? suggestions(t.dc, all.inverters) : [];
    put("#suggest", (!t.dc ? html`<p class="small muted spaced-top">Inverter suggestions appear once the module and number of panels are in.</p>`
      : !all.inverters.length ? html``
      : picks.length ? html`<div class="suggest spaced-top"><span class="small muted">Suggested inverters, fewest first:</span>
          ${picks.map((c, k) => html`<button type="button" class="btn small ratio-${c.ratio > DCAC_GREEN + 1e-9 ? "high" : "ok"} ${c.inverter_id === cur.inverter_id && c.qty === cur.inverter_qty ? "on" : ""}" data-pick="${k}">${c.label}<small>${num(c.ac, 1)} kW · DC/AC ${num(c.ratio, 2)}</small></button>`)}</div>`
      : html`<p class="small missing-text spaced-top">No single inverter model in the library gives a DC/AC ratio within ${DCAC_MIN}–${DCAC_MAX}.</p>`));

    put("#system-summary", html`<div class="summary">
      <div><span>DC capacity</span><b>${t.dc ? `${num(t.dc, 2)} kWp` : "—"}</b><small class="muted">${cur.modules ? `${num(cur.modules, 0)} PV modules` : ""}</small></div>
      <div><span>AC capacity</span><b>${t.ac ? `${num(t.ac, 2)} kW` : "—"}</b><small class="muted">${cur.inverter_qty && t.inverter ? `${num(cur.inverter_qty, 0)} × ${t.inverter.model}` : ""}</small></div>
      <div><span>DC/AC ratio</span><b class="ratio-text-${t.band}">${t.ratio ? num(t.ratio, 2) : "—"}</b><small class="muted">limits ${DCAC_MIN}–${DCAC_MAX}</small></div>
      <div><span>Generation, year 1</span><b>${t.kwh ? `${num(t.kwh / 1000, 2)} MWh` : "—"}</b><small class="muted">${t.kwh ? `${num(t.kwh, 0)} kWh${t.kwhSource === "yield" ? " (estimate)" : ""}` : ""}</small></div>
    </div>`);

    main.querySelector("#total").textContent = t.subtotal ? `OMR ${fmtOmr(t.subtotal)} before VAT (${num(cur.price_per_kwp, 3)} × ${num(t.dc)} kWp)` : "Total = price × DC kWp";
    main.querySelector("#gen-hint").textContent = t.kwhSource === "yield" ? `Blank = ${num(t.dc, 2)} kWp × ${num(cur.specific_yield, 0)} = ${num(t.kwh, 0)} kWh` : "Blank = DC kWp × specific yield";
    main.querySelector("#deg-hint").textContent = t.degradation.source === "module" ? `Blank = ${num(t.degradation.pct, 2)}%, from the ${t.module.model} datasheet`
      : t.degradation.source === "default" ? `Blank = ${DEFAULT_DEGRADATION}%` : "";
    put("#money", html`<div class="summary">
      <div><span>Price before VAT</span><b>${t.subtotal ? `OMR ${fmtOmr(t.subtotal)}` : "—"}</b><small class="muted">${t.vat ? `VAT ${VAT_PCT}%: OMR ${fmtOmr(t.vat)}` : ""}</small></div>
      <div><span>Total with VAT</span><b>${t.total ? `OMR ${fmtOmr(t.total)}` : "—"}</b><small class="muted"></small></div>
      <div><span>Clean energy a year</span><b>${t.cleanValue ? `OMR ${fmtOmr(t.cleanValue)}` : "—"}</b><small class="muted">at ${num(t.tariff, 1)} bz/kWh</small></div>
      <div><span>Simple payback</span><b>${t.payback ? `${num(t.payback, 1)} years` : "—"}</b><small class="muted">total with VAT ÷ yearly value</small></div>
    </div>`);

    const needs = missing(cur, all), issue = ratioIssue(cur, all);
    put("#needs", needs.length || issue
      ? html`<div class="flash warn">${needs.length ? html`Still needs: ${needs.join(", ")}. Those parts of the document are left blank.` : ""}${issue ? html`<div>${issue}</div>` : ""}</div>` : "");
  }

  // a client picked from the list fills its details (anything typed afterwards stays)
  f.elements.client_id.addEventListener("change", () => {
    const c = all.client.get(idOf("client_id"));
    if (!c) return refresh();
    f.elements.client_name.value = c.name || "";
    f.elements.account_no.value = clientMeter(c);
    if (c.wilaya) f.elements.wilaya.value = c.wilaya;
    if (c.mobile) f.elements.mobile.value = c.mobile;
    const req = requiredCapacity(c), m = all.module.get(idOf("module_id"));
    if (req?.unit === "dc" && m && !text("modules")) f.elements.modules.value = panelsFor(req.kw, m.wp);
    refresh();
  });
  f.elements.module_id.addEventListener("change", () => {
    const c = all.client.get(idOf("client_id")), req = requiredCapacity(c), m = all.module.get(idOf("module_id"));
    if (req?.unit === "dc" && m && !text("modules")) f.elements.modules.value = panelsFor(req.kw, m.wp);
  });
  f.addEventListener("input", refresh);
  f.addEventListener("change", refresh);
  main.querySelector("#suggest").addEventListener("click", (e) => {
    const b = e.target.closest("[data-pick]");
    if (!b) return;
    const c = picks[Number(b.dataset.pick)];
    f.elements.inverter_id.value = String(c.inverter_id);
    f.elements.inverter_qty.value = String(c.qty);
    refresh();
  });
  refresh();

  const save = async () => {
    const rec = read();
    if (!rec.client_name) { f.elements.client_name.focus(); throw new Error("Enter the homeowner's name first."); }
    rec.layout_file_id = layoutId();
    if (o.layout_file_id && o.layout_file_id !== rec.layout_file_id) await db.delFile(o.layout_file_id);
    pendingId = null; removeLayout = false;
    const id = await db.put(STORE, rec);
    o = { ...rec, id };
    await showLayout();
    return id;
  };
  main.querySelector("#save").addEventListener("click", (e) => busy(e.target, async () => {
    const isNew = !o.id;
    const id = await save();
    toast("Offer saved.");
    if (isNew) go(`#/residential/${id}`);
  }));
  main.querySelector("#word").addEventListener("click", (e) => busy(e.target, async () => {
    const isNew = !o.id;
    const id = await save();
    const { blob, filename: name } = await build(o, all);
    download(blob, name);
    if (isNew) go(`#/residential/${id}`);
  }));
  const area = main.querySelector("#preview");
  const showPreview = async () => {
    const { blob } = await build({ ...read(), layout_file_id: layoutId() }, all);
    await renderPreview(blob, area);
    main.querySelector("#preview-note").textContent = "The Word file is the final version; the preview can differ slightly.";
  };
  main.querySelector("#preview-btn").addEventListener("click", (e) => busy(e.target, async () => {
    await showPreview();
    area.scrollIntoView({ behavior: "smooth", block: "start" });
  }));
  const onResize = () => (document.body.contains(area) ? fit(area) : window.removeEventListener("resize", onResize));
  window.addEventListener("resize", onResize);
  main.querySelector("#delete")?.addEventListener("click", async () => {
    await db.delFile(o.layout_file_id);
    await db.del(STORE, o.id);
    toast("Offer deleted.");
    go("#/residential");
  });
}
