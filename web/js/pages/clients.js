// Clients: one page per client. It defines who the client is and what they asked for; the
// engineering and paperwork are added later from the tools, which link back here.
import { html, num, str, toast, go, sel, chk, g, shortDate } from "../ui.js";
import * as db from "../store.js";
import { acKw, byName, byUpdated, dcKwp, loadAll } from "../data.js";
import { CAPACITY_UNITS, CLIENT_TYPES, CONNECTIVITY, NEW_CLIENT, PROCUREMENT, VOLTAGE_LEVELS,
         clientView, isShortMapsLink, mapsUrl, parseLocation, requiredCapacity } from "../clients/model.js";
import { DESIGN_TYPES } from "../offer/quick.js";
import { NEW_PROJECT } from "./projects.js";
import { setTitle } from "../app.js";

const PROCUREMENT_KEY = "procurement_options";
const DESIGN_TYPES_KEY = "design_types";   // shared with the offer deck's design types
const NEW = "__new";

// coordinates keep 6 decimals (about 10 cm), not the 6 significant figures g() gives
const coord = (v) => (Number.isFinite(v) ? String(Number(v.toFixed(6))) : "");
const capacityText = (c) => requiredCapacity(c)?.label || "";
const metersText = (c) => (c.meter_numbers || []).join(", ");

// ---- list ------------------------------------------------------------------------------

export async function list(main, { query }) {
  setTitle("Clients");
  const all = await loadAll();
  const q = (query.q || "").toLowerCase(), type = query.type || "";
  const rows = byName(all.clients.map(clientView)).filter((c) =>
    (!type || c.client_type === type) &&
    (!q || [c.name, c.signatory_name, c.id_no, metersText(c), c.notes].some((v) => (v || "").toLowerCase().includes(q))));
  main.innerHTML = html`
<div class="head">
  <div><h1>Clients</h1><div class="muted">Define each client once. Stringing, design, documents and offers all link back to the client.</div></div>
  <div class="actions"><a class="btn primary" href="#/clients/new">New client</a></div>
</div>
<form class="search" id="search">
  <input name="q" value="${query.q || ""}" placeholder="Search name, signatory, C.R., meter no.">
  <select name="type"><option value="">All types</option>${Object.entries(CLIENT_TYPES).map(([k, lab]) => html`<option value="${k}" ${sel(k === type)}>${lab}</option>`)}</select>
  <button class="btn">Filter</button>
</form>
<div class="panel">
  ${rows.length ? html`<div class="table-scroll"><table>
    <thead><tr><th>Client</th><th>Type</th><th class="r">Required capacity</th><th>Meter no.</th><th>Installation</th><th>Grid</th></tr></thead>
    <tbody>${rows.map((c) => html`<tr>
      <td><a href="#/clients/${c.id}">${c.name}</a>${c.client_type === "commercial" && c.procurement ? html`<div class="small muted">${c.procurement}</div>` : ""}</td>
      <td><span class="pill">${CLIENT_TYPES[c.client_type]}</span></td>
      <td class="r num">${capacityText(c) || "—"}</td>
      <td class="num">${metersText(c) || "—"}</td>
      <td class="small">${c.installation_types.join(", ") || "—"}</td>
      <td class="small">${[CONNECTIVITY[c.connectivity], c.voltage_level].filter(Boolean).join(" · ") || "—"}</td></tr>`)}</tbody>
  </table></div>` : html`<div class="empty">${q || type ? "No matches." : html`No clients yet. <a href="#/clients/new">Add the first one</a>.`}</div>`}
</div>`;
  main.querySelector("#search").addEventListener("submit", (e) => {
    e.preventDefault();
    go("#/clients?" + new URLSearchParams(new FormData(e.target)).toString());
  });
}

// ---- the client page -------------------------------------------------------------------

export async function form(main, { params }) {
  const all = await loadAll();
  const stored = params.id ? all.client.get(params.id) : null;
  if (params.id && !stored) { main.innerHTML = `<div class="panel empty">Client not found. <a href="#/clients">All clients</a></div>`; return; }
  const c = stored ? clientView(stored) : { ...NEW_CLIENT };
  setTitle(stored ? c.name : "New client");

  const procurement = [...new Set([...PROCUREMENT, ...(await db.getSetting(PROCUREMENT_KEY, [])), c.procurement].filter(Boolean))];
  const installTypes = [...new Set([...DESIGN_TYPES, ...(await db.getSetting(DESIGN_TYPES_KEY, [])), ...c.installation_types].filter(Boolean))];
  const meters = c.meter_numbers.length ? c.meter_numbers : [""];

  main.innerHTML = html`
<div class="head">
  <div><h1>${stored ? c.name : "New client"}</h1><div class="muted">${stored ? html`<a href="#/clients">Clients</a> · ${CLIENT_TYPES[c.client_type]}` : "Only what defines the client. System design, paperwork and offers come later, from the tools."}</div></div>
  ${stored ? html`<div class="actions"><a class="btn primary" href="#/stringing?client=${c.id}">Stringing calculation</a></div>` : ""}
</div>
<form id="client-form" novalidate>
  <div class="panel">
    <h2>Type of client</h2>
    <div class="seg-pick" role="radiogroup">
      ${Object.entries(CLIENT_TYPES).map(([k, lab]) => html`<label><input type="radio" name="client_type" value="${k}" ${chk(k === c.client_type)}><span>${lab}</span></label>`)}
    </div>
  </div>

  <div class="panel">
    <h2>Client details</h2>
    <div class="fields">
      <label class="wide"><span id="name-label">Name</span> <input name="name" value="${c.name}" required autocomplete="off"></label>
      <label data-for="commercial">Authorised signatory name <input name="signatory_name" value="${c.signatory_name}"></label>
      <label data-for="commercial">Commercial registration (C.R.) no. <input name="id_no" value="${c.id_no}" inputmode="numeric"></label>
      <div class="wide">
        <label><span id="meter-label">Electricity meter number</span></label>
        <div id="meters" class="meters">${meters.map((m) => meterRow(m))}</div>
        <button type="button" class="btn small" id="add-meter" data-for="commercial other">+ Add a meter</button>
        <span class="hint small muted">Keep leading zeros, e.g. 08023459.</span>
      </div>
    </div>
  </div>

  <div class="panel">
    <h2>Location</h2>
    <div class="fields">
      <label class="wide">Google Maps link <input name="location_url" value="${c.location_url}" placeholder="Paste the link from Google Maps (Share › Copy link, or the address bar)" autocomplete="off">
        <span class="hint" id="loc-hint"></span></label>
      <label>Latitude <input name="latitude" value="${coord(c.latitude)}" inputmode="decimal" placeholder="23.5880"></label>
      <label>Longitude <input name="longitude" value="${coord(c.longitude)}" inputmode="decimal" placeholder="58.3829"></label>
      <div class="loc-open"><a id="loc-open" class="btn small" target="_blank" rel="noopener" hidden>Open in Google Maps</a></div>
    </div>
  </div>

  <div class="panel">
    <h2>Requirement</h2>
    <div class="fields">
      <label data-for="commercial">How the work comes in
        <select name="procurement"><option value="">Choose…</option>${procurement.map((x) => html`<option ${sel(x === c.procurement)}>${x}</option>`)}<option value="${NEW}">Add an option…</option></select></label>
      <label>Required capacity <span class="hint">As the client asked for it</span>
        <span class="with-add"><input name="required_capacity_kw" value="${g(c.required_capacity_kw)}" inputmode="decimal" placeholder="e.g. 150">
          <select name="required_capacity_unit" class="unit">${Object.entries(CAPACITY_UNITS).map(([k, lab]) => html`<option value="${k}" ${sel(k === c.required_capacity_unit)}>${lab}</option>`)}</select></span></label>
      <div class="wide">
        <label>Type of installation <span class="hint">Tick every type the site has</span></label>
        <div class="chips" id="install-types">${installTypes.map((t) => chip(t, c.installation_types.includes(t)))}</div>
        <button type="button" class="btn small" id="add-type">+ Add a type</button>
      </div>
      <div class="pick-row wide">
        <div><label>Connectivity</label><div class="seg-pick small" role="radiogroup">
          ${Object.entries(CONNECTIVITY).map(([k, lab]) => html`<label><input type="radio" name="connectivity" value="${k}" ${chk(k === c.connectivity)}><span>${lab}</span></label>`)}</div></div>
        <div><label>Voltage level</label><div class="seg-pick small" role="radiogroup">
          ${Object.keys(VOLTAGE_LEVELS).map((k) => html`<label title="${VOLTAGE_LEVELS[k]}"><input type="radio" name="voltage_level" value="${k}" ${chk(k === c.voltage_level)}><span>${k}</span></label>`)}</div></div>
      </div>
    </div>
  </div>

  <div class="panel"><label>Notes <textarea name="notes" placeholder="Anything else worth knowing about this client">${c.notes}</textarea></label></div>

  <div class="bar">
    <a class="btn" href="${stored ? `#/clients/${c.id}` : "#/clients"}">Cancel</a>
    <button class="btn primary">Save client</button>
  </div>
</form>
${stored ? workPanel(c, all) : ""}
${stored ? html`<button class="btn danger small" id="delete" data-confirm="Delete this client and their design records? This cannot be undone.">Delete client</button>` : ""}`;

  const f = main.querySelector("#client-form");
  const $ = (n) => f.querySelector(`[name="${n}"]`);
  const type = () => f.querySelector('[name="client_type"]:checked')?.value || "residential";

  function showType() {
    const t = type();
    f.querySelectorAll("[data-for]").forEach((el) => { el.hidden = !el.dataset.for.split(" ").includes(t); });
    main.querySelector("#name-label").textContent = { residential: "Homeowner's name", commercial: "Company name", other: "Client name" }[t];
    main.querySelector("#meter-label").textContent = t === "residential" ? "Electricity meter number" : "Electricity meter numbers";
    // a home has one meter: extra rows are hidden, not lost, until the type changes back
    f.querySelectorAll("#meters .meter-row").forEach((row, i) => { row.hidden = t === "residential" && i > 0; });
  }
  f.addEventListener("change", (e) => { if (e.target.name === "client_type") showType(); });
  showType();

  // meters
  const meterBox = main.querySelector("#meters");
  main.querySelector("#add-meter").addEventListener("click", () => {
    meterBox.insertAdjacentHTML("beforeend", String(meterRow("")));
    meterBox.lastElementChild.querySelector("input").focus();
  });
  meterBox.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-remove-meter]");
    if (!btn) return;
    const rows = meterBox.querySelectorAll(".meter-row");
    if (rows.length > 1) btn.closest(".meter-row").remove(); else rows[0].querySelector("input").value = "";
  });

  // location: the link fills the coordinates; typed coordinates are kept as they are
  const hint = main.querySelector("#loc-hint"), open = main.querySelector("#loc-open");
  function showOpen() {
    const lat = parseFloat($("latitude").value), lon = parseFloat($("longitude").value);
    const url = mapsUrl(lat, lon);
    open.hidden = !url;
    if (url) open.href = url;
  }
  function readLink() {
    const text = $("location_url").value.trim();
    const pt = parseLocation(text);
    if (pt) {
      $("latitude").value = coord(pt.lat);
      $("longitude").value = coord(pt.lon);
      hint.textContent = `Coordinates read from the link: ${pt.lat.toFixed(6)}, ${pt.lon.toFixed(6)}`;
      hint.className = "hint ok-text";
    } else if (!text) {
      hint.textContent = "The coordinates are stored with the link, so the yield simulation can use them.";
      hint.className = "hint";
    } else {
      hint.textContent = isShortMapsLink(text)
        ? "Short links don't contain the coordinates. Open the link, then copy the full address from the browser bar, or type the coordinates below."
        : "No coordinates found in this link. Type them below, or right-click the spot in Google Maps and click the numbers to copy them.";
      hint.className = "hint warn-text";
    }
    showOpen();
  }
  $("location_url").addEventListener("input", readLink);
  $("latitude").addEventListener("input", showOpen);
  $("longitude").addEventListener("input", showOpen);
  if (c.location_url) readLink(); else { hint.textContent = "The coordinates are stored with the link, so the yield simulation can use them."; showOpen(); }

  // procurement: new options are kept for later clients
  $("procurement").addEventListener("change", async (e) => {
    if (e.target.value !== NEW) return;
    const name = (window.prompt("New option (e.g. Framework agreement):") || "").trim();
    if (!name) { e.target.value = c.procurement || ""; return; }
    if (![...e.target.options].some((o) => o.value === name)) {
      await db.setSetting(PROCUREMENT_KEY, [...new Set([...(await db.getSetting(PROCUREMENT_KEY, [])), name])]);
      e.target.add(new Option(name, name), e.target.options.length - 1);
    }
    e.target.value = name;
  });

  // installation types: shared with the offer deck's design types
  main.querySelector("#add-type").addEventListener("click", async () => {
    const name = (window.prompt("New installation type (e.g. Metal Sheet Roof):") || "").trim();
    if (!name) return;
    const box = main.querySelector("#install-types");
    const existing = [...box.querySelectorAll("input")].find((i) => i.value.toLowerCase() === name.toLowerCase());
    if (existing) { existing.checked = true; return; }
    await db.setSetting(DESIGN_TYPES_KEY, [...new Set([...(await db.getSetting(DESIGN_TYPES_KEY, [])), name])]);
    box.insertAdjacentHTML("beforeend", String(chip(name, true)));
  });

  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(f);
    const t = type();
    const rec = { ...(stored || {}) };   // keeps fields set elsewhere (e.g. the saved stringing result)
    rec.client_type = t in CLIENT_TYPES ? t : "residential";
    rec.name = str(fd, "name");
    if (!rec.name) { toast(`The ${main.querySelector("#name-label").textContent.toLowerCase()} is required.`, "error"); $("name").focus(); return; }
    const meterList = [...f.querySelectorAll("#meters .meter-row input")].map((i) => i.value.trim()).filter(Boolean);
    rec.meter_numbers = t === "residential" ? meterList.slice(0, 1) : meterList;
    if (t === "commercial") {
      rec.signatory_name = str(fd, "signatory_name");
      rec.id_no = str(fd, "id_no");
      rec.procurement = str(fd, "procurement") === NEW ? "" : str(fd, "procurement");
    }
    rec.location_url = str(fd, "location_url");
    const lat = parseFloat(str(fd, "latitude")), lon = parseFloat(str(fd, "longitude"));
    const okPt = Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
    if ((str(fd, "latitude") || str(fd, "longitude")) && !okPt) { toast("The latitude and longitude don't look right. Nothing was saved.", "error"); return; }
    rec.latitude = okPt ? lat : null;
    rec.longitude = okPt ? lon : null;
    const cap = parseFloat(str(fd, "required_capacity_kw").replace(/,/g, ""));
    if (str(fd, "required_capacity_kw") && !(cap > 0)) { toast("The required capacity should be a number above zero. Nothing was saved.", "error"); return; }
    rec.required_capacity_kw = cap > 0 ? cap : null;
    rec.required_capacity_unit = str(fd, "required_capacity_unit") === "ac" ? "ac" : "dc";
    rec.installation_types = fd.getAll("installation_types").map(String);
    rec.connectivity = str(fd, "connectivity") in CONNECTIVITY ? str(fd, "connectivity") : "on-grid";
    rec.voltage_level = str(fd, "voltage_level") in VOLTAGE_LEVELS ? str(fd, "voltage_level") : "LV";
    rec.notes = str(fd, "notes");
    const id = await db.put("clients", rec);
    toast("Client saved.");
    go(`#/clients/${id}`);
  });

  if (!stored) return;

  main.querySelector("#new-design")?.addEventListener("click", async () => {
    const def = (kind) => all.parties.find((x) => x.kind === kind && x.is_default)?.id || null;
    const n = all.projects.filter((p) => p.client_id === c.id).length;
    const { premises_type, ...base } = NEW_PROJECT;   // the client's type decides the premises
    const id = await db.put("projects", { ...base, client_id: c.id, contractor_id: def("contractor"), consultant_id: def("consultant"),
      name: n ? `${c.name} – Solar PV ${n + 1}` : `${c.name} – Solar PV`, installation_type: c.installation_types[0] || NEW_PROJECT.installation_type });
    go(`#/projects/${id}`);
  });
  main.querySelector("#delete").addEventListener("click", async () => {
    for (const p of all.projects.filter((x) => x.client_id === c.id)) {
      for (const k of ["layout_file_id", "offer_site_file_id", "offer_shadow_file_id", "offer_structure_file_id"]) await db.delFile(p[k]);
      await db.delFile(`weather_${p.id}`);
      await db.del("projects", p.id);
    }
    await db.del("clients", c.id);
    toast("Client deleted.");
    go("#/clients");
  });
}

function meterRow(value) {
  return html`<div class="meter-row"><input name="meter" value="${value}" inputmode="numeric" placeholder="Meter number" autocomplete="off"><button type="button" class="btn small" data-remove-meter title="Remove this meter">✕</button></div>`;
}

function chip(name, on) {
  return html`<label class="chip"><input type="checkbox" name="installation_types" value="${name}" ${chk(on)}><span>${name}</span></label>`;
}

/** What has been done for this client in the tools, with a way into each. */
function workPanel(c, all) {
  const designs = byUpdated(all.projects.filter((p) => p.client_id === c.id)).map(all.full);
  const s = c.stringing;
  return html`
<div class="panel work">
  <h2>Work for this client</h2>
  <div class="work-grid">
    <div class="work-item">
      <h3>Stringing</h3>
      ${s ? html`<div class="small">${[s.dc_kwp ? `${num(s.dc_kwp)} kWp DC` : "", s.ac_kw ? `${num(s.ac_kw)} kW AC` : "", s.ratio ? `DC/AC ${num(s.ratio)}` : ""].filter(Boolean).join(" · ") || "Saved calculation"}</div>
        ${s.saved_at ? html`<div class="small muted">Saved ${shortDate(s.saved_at)}</div>` : ""}`
        : html`<div class="small muted">${requiredCapacity(c) ? `Starts from the required ${requiredCapacity(c).label}.` : "No calculation saved yet."}</div>`}
      <a class="btn small" href="#/stringing?client=${c.id}">${s ? "Open the calculation" : "Do a stringing calculation"}</a>
    </div>
    <div class="work-item">
      <h3>Offer deck</h3>
      <div class="small muted">The techno-commercial PowerPoint, from the Helioscope reports.</div>
      <a class="btn small" href="#/offers/new?client=${encodeURIComponent(c.name)}">New offer for this client</a>
    </div>
    <div class="work-item">
      <h3>Documents</h3>
      <div class="small muted">NAMA forms, execution agreement and NEDC letters, filled from this client.</div>
      <span class="btns"><a class="btn small" href="#/forms/new?client_id=${c.id}">New form</a><a class="btn small" href="#/letters/new?client_id=${c.id}">Write a letter</a></span>
    </div>
  </div>
  <h3 class="spaced">Design records <span class="muted small">(system design, yield and document pack)</span></h3>
  ${designs.length ? html`<table>
    <thead><tr><th>Design</th><th class="r">DC kWp</th><th class="r">AC kW</th><th>Status</th><th>Updated</th></tr></thead>
    <tbody>${designs.map((p) => html`<tr><td><a href="#/projects/${p.id}">${p.name}</a></td><td class="r num">${num(dcKwp(p))}</td><td class="r num">${num(acKw(p))}</td>
      <td><span class="pill">${p.status}</span></td><td class="small muted">${shortDate(p.updated_at)}</td></tr>`)}</tbody>
  </table>` : html`<div class="small muted">None yet. Start one when you're ready to pick equipment, run the yield simulation or print the NAMA pack.</div>`}
  <p class="spaced-top"><button class="btn small" id="new-design">${designs.length ? "Add another design record" : "Start a design record"}</button></p>
</div>`;
}
