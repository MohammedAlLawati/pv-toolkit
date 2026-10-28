import { download, fileUrl, go, html, readImage, toast } from "../ui.js";
import * as db from "../store.js";
import { setTitle } from "../app.js";

const SLOTS = [["letterhead_top", "Letterhead top (header)"], ["letterhead_bottom", "Letterhead bottom (footer)"]];

export async function settings(main) {
  setTitle("Letterhead & backup");
  const files = Object.fromEntries(await Promise.all(SLOTS.map(async ([id]) => [id, await db.getFile(id)])));
  const est = await navigator.storage?.estimate?.().catch(() => null);
  const persisted = await navigator.storage?.persisted?.().catch(() => false);
  main.innerHTML = html`
<div class="head"><div><h1>Letterhead &amp; backup</h1><div class="muted">Everything you enter is kept in this browser on this device. Nothing is sent anywhere.</div></div></div>

<div class="panel">
  <h2>Company letterhead</h2>
  <p class="small muted">Printed at the top and bottom of every letter. Upload the header and footer as PNG images, as wide as the page. They stay in this browser and are not part of the published app.</p>
  ${SLOTS.map(([id, label]) => html`
  <div class="doc">
    <div><b>${label}</b>${files[id] ? html`<div class="letterhead-thumbs"><img src="${fileUrl(files[id])}" alt="${label}"></div>` : html`<div class="missing">Not uploaded: letters print on plain paper.</div>`}</div>
    <div class="btns">
      <label class="btn small">Upload<input type="file" accept="image/png,image/jpeg" data-slot="${id}" hidden></label>
      ${files[id] ? html`<button class="btn small danger" data-remove="${id}">Remove</button>` : ""}
    </div>
  </div>`)}
</div>

<div class="panel">
  <h2>Backup</h2>
  <p class="small muted">Download a backup file now and then, and keep it somewhere safe (e.g. Google Drive). Clearing the browser's site data, or using another computer, starts empty until you restore a backup.</p>
  <div class="file-row">
    <button class="btn primary" id="export">Download backup</button>
    <label class="btn">Restore from backup…<input type="file" accept="application/json,.json" id="import" hidden></label>
  </div>
  <p class="small muted spaced-top">Restoring replaces everything in this browser with the backup's contents.
  ${est ? ` Storage used: ${(est.usage / 1048576).toFixed(1)} MB.` : ""} ${persisted ? "The browser has agreed to keep this data." : "The browser may clear this data if the disk runs low; keep backups."}</p>
</div>`;

  main.querySelectorAll("[data-slot]").forEach((inp) => inp.addEventListener("change", async () => {
    const file = inp.files[0];
    if (!file) return;
    try {
      const img = await readImage(file, 3000);
      await db.putFileAs(inp.dataset.slot, img.blob, file.name, { width: img.width, height: img.height, kind: "letterhead" });
      toast("Letterhead saved.");
    } catch { toast("That image couldn't be read (PNG or JPG only).", "error"); }
    go("#/settings");
  }));
  main.querySelectorAll("[data-remove]").forEach((btn) => btn.addEventListener("click", async () => {
    await db.delFile(btn.dataset.remove);
    go("#/settings");
  }));
  main.querySelector("#export").addEventListener("click", async () => {
    const blob = await db.exportAll();
    download(blob, `pv-toolkit-backup-${new Date().toISOString().slice(0, 10)}.json`);
  });
  main.querySelector("#import").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!confirm("Replace everything in this browser with this backup?")) { e.target.value = ""; return; }
    try {
      await db.importAll(await file.text());
      toast("Backup restored.");
      go("#/");
    } catch (err) { toast(err.message, "error"); }
  });
}
