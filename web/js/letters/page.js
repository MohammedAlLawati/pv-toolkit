// Letters page: fill in the client and accounts, download the letter as Word.
// The letterhead images are the user's own upload, kept in this browser (IndexedDB);
// they are never part of the site.
import { buildLetter } from "./builder.js";

const $ = (id) => document.getElementById(id);
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
  "September", "October", "November", "December"];
const HEADS = { top: "letterhead_top", bottom: "letterhead_bottom" };

// ---- letterhead storage ------------------------------------------------------------------

const DB = "pv-toolkit-letters";

function db() {
  return new Promise((ok, fail) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("files");
    req.onsuccess = () => ok(req.result);
    req.onerror = () => fail(req.error);
  });
}

async function fileOp(mode, fn) {
  const d = await db();
  return new Promise((ok, fail) => {
    const tx = d.transaction("files", mode);
    const req = fn(tx.objectStore("files"));
    tx.oncomplete = () => ok(req.result);
    tx.onerror = () => fail(tx.error);
  });
}

const getFile = (key) => fileOp("readonly", (s) => s.get(key)).catch(() => null);
const putFile = (key, blob) => fileOp("readwrite", (s) => s.put(blob, key));
const deleteFile = (key) => fileOp("readwrite", (s) => s.delete(key));

async function showHead(which) {
  const img = which === "top" ? $("prevTop") : $("prevBottom");
  const blob = await getFile(HEADS[which]);
  if (img.src) URL.revokeObjectURL(img.src);
  img.hidden = !blob;
  img.src = blob ? URL.createObjectURL(blob) : "";
}

// ---- form --------------------------------------------------------------------------------

function audience() {
  return $("template").value === "nedc_residential" ? "residential" : "commercial";
}

function showAudienceFields() {
  const a = audience();
  for (const el of document.querySelectorAll("[data-for]")) el.hidden = el.dataset.for !== a;
}

function addRow(values = {}) {
  const tr = document.createElement("tr");
  tr.innerHTML = `<td></td><td><input dir="auto" name="account_no"></td><td><input dir="auto" name="location"></td>`;
  tr.querySelector('[name="account_no"]').value = values.account_no || "";
  tr.querySelector('[name="location"]').value = values.location || "";
  $("rows").append(tr);
  [...$("rows").children].forEach((r, i) => { r.firstElementChild.textContent = i + 1; });
}

function letterDate(lang) {
  const v = $("date").value;
  if (!v) return "";
  const [y, m, d] = v.split("-");
  return lang === "ar" ? `${d}/${m}/${y}` : `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

function collect() {
  const values = {};
  for (const input of $("form").querySelectorAll("label:not([hidden]) > input")) {
    if (input.value.trim()) values[input.name] = input.value.trim();
  }
  values.points = [...$("rows").children].map((tr) => ({
    account_no: tr.querySelector('[name="account_no"]').value.trim(),
    location: tr.querySelector('[name="location"]').value.trim(),
  }));
  return values;
}

// Browsers can refuse a download name in Arabic script, so a non-Latin name falls back to the date.
function fileName(values, lang) {
  let who = (values.ClientName || "").replace(/[^\w .,&()-]+/g, "").trim().slice(0, 60);
  if (!who) who = values.ClientName ? $("date").value : "blank";
  return `NEDC capacity request - ${who}${lang === "ar" ? " (AR)" : ""}.docx`;
}

async function download(blank) {
  const lang = $("lang").value;
  const values = blank ? {} : { ...collect(), Date: letterDate(lang) };
  const status = $("status");
  for (const b of [$("build"), $("blank")]) b.disabled = true;
  status.className = "status muted";
  status.textContent = "Building…";
  try {
    const [top, bottom] = await Promise.all([getFile(HEADS.top), getFile(HEADS.bottom)]);
    const blob = await buildLetter($("template").value, lang, values, { letterhead: { top, bottom } });
    const a = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(blob), download: fileName(values, lang),
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    status.textContent = top || bottom ? "" : "Downloaded on plain paper: upload the letterhead below to add it.";
  } catch (e) {
    status.className = "status error";
    status.textContent = `Couldn't build the letter: ${e.message}`;
  } finally {
    for (const b of [$("build"), $("blank")]) b.disabled = false;
  }
}

// ---- wire up -----------------------------------------------------------------------------

$("date").value = new Date().toISOString().slice(0, 10);
for (let i = 0; i < 3; i++) addRow();
showAudienceFields();
showHead("top");
showHead("bottom");

$("template").addEventListener("change", showAudienceFields);
$("addRow").addEventListener("click", () => addRow());
$("form").addEventListener("submit", (e) => { e.preventDefault(); download(false); });
$("blank").addEventListener("click", () => download(true));
for (const [which, id] of [["top", "headTop"], ["bottom", "headBottom"]]) {
  $(id).addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    await putFile(HEADS[which], f);
    e.target.value = "";
    showHead(which);
  });
}
$("clearHeads").addEventListener("click", async () => {
  await Promise.all([deleteFile(HEADS.top), deleteFile(HEADS.bottom)]);
  showHead("top");
  showHead("bottom");
});
