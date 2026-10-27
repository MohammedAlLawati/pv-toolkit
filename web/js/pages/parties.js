import { chk, fileUrl, go, html, readImage, sel, str, toast } from "../ui.js";
import * as db from "../store.js";
import { byName } from "../data.js";
import { setTitle } from "../app.js";

export async function list(main) {
  setTitle("Contractors & consultants");
  const rows = byName(await db.list("parties"));
  main.innerHTML = html`
<div class="head">
  <div><h1>Contractors &amp; consultants</h1><div class="muted">These lists fill the dropdowns on each project and the consultant / contractor blocks of the NAMA initial form.</div></div>
  <div class="actions"><a class="btn" href="#/parties/new?kind=consultant">Add consultant</a><a class="btn" href="#/parties/new?kind=contractor">Add contractor</a></div>
</div>
${[["Consultants", "consultant"], ["Contractors", "contractor"]].map(([title, kind]) => {
  const items = rows.filter((x) => x.kind === kind);
  return html`<div class="panel"><h2>${title}</h2>
  ${items.length ? html`<table><thead><tr><th>Name</th><th>Phone</th><th>Project engineer</th><th>Stamp</th><th></th></tr></thead><tbody>
  ${items.map((x) => html`<tr><td><a href="#/parties/${x.id}">${x.name}</a></td><td>${x.phone}</td><td>${x.engineer}</td>
    <td>${x.stamp_file_id ? html`<span class="pill ok">uploaded</span>` : html`<span class="muted small">none</span>`}</td>
    <td>${x.is_default ? html`<span class="pill">default</span>` : ""}</td></tr>`)}
  </tbody></table>` : html`<div class="empty">None yet.</div>`}</div>`;
})}`;
}

export async function form(main, { params, query }) {
  const party = params.id ? await db.get("parties", params.id) : null;
  if (params.id && !party) { main.innerHTML = `<div class="panel empty">Not found.</div>`; return; }
  const kind = party ? party.kind : query.kind === "consultant" ? "consultant" : "contractor";
  const stamp = party ? await db.getFile(party.stamp_file_id) : null;
  const v = (k) => (party ? party[k] ?? "" : "");
  setTitle(party ? party.name : `New ${kind}`);
  main.innerHTML = html`
<div class="head"><div><h1>${party ? party.name : `New ${kind}`}</h1></div></div>
<form id="party-form" class="panel">
  <div class="fields">
    <label>Type <select name="kind"><option value="contractor" ${sel(kind === "contractor")}>Contractor</option><option value="consultant" ${sel(kind === "consultant")}>Consultant</option></select></label>
    <label class="wide">Company name <input name="name" value="${v("name")}" required></label>
    <label>Phone <input name="phone" value="${v("phone")}"></label>
    <label>E-mail <input name="email" type="email" value="${v("email")}"></label>
    <label>Project engineer <input name="engineer" value="${v("engineer")}"></label>
    <label class="wide">Address <span class="hint">Used on the execution agreement</span><textarea name="address">${v("address")}</textarea></label>
    <label class="wide">Stamp / signature image (PNG with transparent background works best)
      <input type="file" name="stamp" accept="image/png,image/jpeg">
      <span class="hint">Placed in the Signature &amp; Stamp box on the NAMA initial form. Kept in this browser only. Leave empty to sign and stamp by hand.</span></label>
    ${stamp ? html`<div class="wide"><img class="stamp-preview" src="${fileUrl(stamp)}" alt="Current stamp">
      <label class="check"><input type="checkbox" name="remove_stamp"> Remove stamp</label></div>` : ""}
    <label class="check wide"><input type="checkbox" name="is_default" ${chk(party?.is_default)}> Pre-select on new projects</label>
  </div>
  <div class="bar"><a class="btn" href="#/parties">Cancel</a><button class="btn primary">Save</button></div>
</form>
${party ? html`<button class="btn danger small" id="delete" data-confirm="Delete ${party.name}?">Delete</button>` : ""}`;

  main.querySelector("#party-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const rec = { ...(party || {}) };
    rec.kind = str(fd, "kind") === "consultant" ? "consultant" : "contractor";
    for (const k of ["name", "phone", "email", "engineer", "address"]) rec[k] = str(fd, k);
    if (!rec.name) { toast("The company name is required.", "error"); return; }
    rec.is_default = fd.get("is_default") === "on";
    if (fd.get("remove_stamp") === "on" && rec.stamp_file_id) { await db.delFile(rec.stamp_file_id); rec.stamp_file_id = null; }
    const upload = fd.get("stamp");
    if (upload && upload.size) {
      try {
        const img = await readImage(upload, 1200);
        const fid = await db.putFile(img.blob, upload.name, { width: img.width, height: img.height, kind: "stamp" });
        if (rec.stamp_file_id) await db.delFile(rec.stamp_file_id);
        rec.stamp_file_id = fid;
      } catch { toast("The stamp image couldn't be read (PNG or JPG only); it wasn't saved.", "error"); }
    }
    if (rec.is_default) {
      for (const other of await db.list("parties")) {
        if (other.kind === rec.kind && other.is_default && other.id !== rec.id) await db.put("parties", { ...other, is_default: false });
      }
    }
    await db.put("parties", rec);
    toast("Saved.");
    go("#/parties");
  });
  main.querySelector("#delete")?.addEventListener("click", async () => {
    for (const p of await db.list("projects")) {
      const ch = {};
      if (p.consultant_id === party.id) ch.consultant_id = null;
      if (p.contractor_id === party.id) ch.contractor_id = null;
      if (Object.keys(ch).length) await db.put("projects", { ...p, ...ch });
    }
    await db.delFile(party.stamp_file_id);
    await db.del("parties", party.id);
    toast("Deleted.");
    go("#/parties");
  });
}
