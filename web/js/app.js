// Hash router: "#/projects/3/edit" -> pages/projects.js export `form` with params { id: 3 }.
//
// A page is an async function (main, ctx) that fills `main` and wires its own events.
// ctx = { params, query, route }. Numeric params are converted to numbers.
import { esc, releaseUrls, toast } from "./ui.js";
import { ensureDefaultProfile } from "./data.js";
import * as cloud from "./cloud.js";

// [path, page module, export name, nav item]
const ROUTES = [
  ["/", "dashboard", "dashboard", "home"],
  ["/clients", "clients", "list", "clients"],
  ["/clients/new", "clients", "form", "clients"],
  ["/clients/:id", "clients", "form", "clients"],
  ["/projects", "projects", "list", "projects"],
  ["/projects/new", "projects", "form", "projects"],
  ["/projects/:id", "projects", "view", "projects"],
  ["/projects/:id/edit", "projects", "form", "projects"],
  ["/projects/:id/sizing", "sizing", "sizing", "sizing"],
  ["/sizing", "sizing", "index", "sizing"],
  ["/projects/:id/yield", "yield", "project", "yield"],
  ["/projects/:id/yield/report", "yield", "report", "yield"],
  ["/yield", "yield", "index", "yield"],
  ["/rules", "rules", "rules", "rules"],
  ["/rules/:id", "rules", "rules", "rules"],
  ["/library", "library", "library", "library"],
  ["/library/:kind/new", "library", "form", "library"],
  ["/library/:kind/:id", "library", "form", "library"],
  ["/parties", "parties", "list", "parties"],
  ["/parties/new", "parties", "form", "parties"],
  ["/parties/:id", "parties", "form", "parties"],
  ["/settings", "settings", "settings", "settings"],
  ["/account", "account", "account", "account"],
  ["/welcome", "account", "welcome", "account"],
  ["/offers", "offers", "list", "offers"],
  ["/offers/new", "offers", "quick", "offers"],
  ["/offers/quick/:id", "offers", "quick", "offers"],
  ["/offers/:id", "offers", "view", "offers"],
  ["/documents", "documents", "documents", "documents"],
  ["/letters", "letters", "list", "documents"],
  ["/letters/*", "letters", "route", "documents"],
];

function match(path) {
  const parts = path.split("/").filter(Boolean);
  for (const [pattern, mod, fn, nav] of ROUTES) {
    const pp = pattern.split("/").filter(Boolean);
    const params = {};
    let ok = true;
    if (pp[pp.length - 1] === "*") {
      if (parts.length < pp.length || pp.slice(0, -1).some((x, i) => x !== parts[i])) continue;
      params.rest = parts.slice(pp.length - 1).join("/");
    } else {
      if (pp.length !== parts.length) continue;
      for (let i = 0; i < pp.length; i++) {
        if (pp[i].startsWith(":")) params[pp[i].slice(1)] = /^\d+$/.test(parts[i]) ? Number(parts[i]) : decodeURIComponent(parts[i]);
        else if (pp[i] !== parts[i]) { ok = false; break; }
      }
      if (!ok) continue;
    }
    return { mod, fn, nav, params, pattern };
  }
  return null;
}

let seq = 0;
async function route() {
  const mine = ++seq;
  const [path, qs] = (location.hash.slice(1) || "/").split("?");
  const query = Object.fromEntries(new URLSearchParams(qs || ""));
  const main = document.getElementById("view");
  const m = match(path);
  document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("on", !!m && a.dataset.nav === m.nav));
  document.querySelector(".shell").classList.toggle("gate", m?.fn === "welcome");
  if (!m) { main.innerHTML = `<div class="panel empty">Page not found. <a href="#/">Go to the dashboard</a>.</div>`; return; }
  try {
    const page = await import(`./pages/${m.mod}.js`);
    if (mine !== seq) return;
    releaseUrls();
    main.innerHTML = `<div class="loading">Loading…</div>`;
    await page[m.fn](main, { params: m.params, query, route: m.pattern });
    window.scrollTo(0, 0);
  } catch (err) {
    console.error(err);
    if (mine === seq) main.innerHTML = `<div class="flash error">Something went wrong: ${esc(err.message || err)}</div>`;
  }
}

/** Set the browser tab title from a page. */
export const setTitle = (t) => { document.title = t ? `${t} · PV Toolkit` : "PV Toolkit"; };

// Ask before destructive actions: <button data-confirm="...">
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-confirm]");
  if (el && !window.confirm(el.dataset.confirm)) { e.preventDefault(); e.stopImmediatePropagation(); }
}, true);

// The side menu folds to a narrow strip; the choice is remembered in this browser.
const shell = document.querySelector(".shell"), sideToggle = document.getElementById("side-toggle");
function setMenu(collapsed) {
  shell.classList.toggle("collapsed", collapsed);
  sideToggle.setAttribute("aria-expanded", String(!collapsed));
  sideToggle.title = collapsed ? "Show the menu" : "Hide the menu";
}
try { setMenu(localStorage.getItem("menu-collapsed") === "1"); } catch { /* storage off: start open */ }
sideToggle.addEventListener("click", () => {
  const collapsed = !shell.classList.contains("collapsed");
  setMenu(collapsed);
  try { localStorage.setItem("menu-collapsed", collapsed ? "1" : "0"); } catch { /* not remembered */ }
});

window.addEventListener("hashchange", route);
window.addEventListener("unhandledrejection", (e) => toast(String(e.reason?.message || e.reason), "error"));

(async () => {
  if (!window.indexedDB) {
    document.getElementById("view").innerHTML = `<div class="flash error">This browser can't store data (IndexedDB is off, e.g. in a private window).</div>`;
    return;
  }
  navigator.storage?.persist?.();
  // signed in: bring in changes from other devices first (but don't wait long for them)
  await cloud.start();
  await Promise.race([cloud.sync(), new Promise((r) => setTimeout(r, 4000))]);
  await ensureDefaultProfile();
  // first opening: sign in, or continue as a guest
  if (cloud.configured && !cloud.signedIn() && !cloud.isGuest() && !/^#\/(welcome|account)\b/.test(location.hash)) {
    try { sessionStorage.setItem("pv-toolkit-after-welcome", location.hash || "#/"); } catch { /* back to the dashboard */ }
    location.replace("#/welcome");  // hashchange routes it
    return;
  }
  route();
})();

// The menu: "User info" at the top when signed in ("Sign in" otherwise), and a sync meter at the bottom.
const note = document.querySelector(".side .local"), navAccount = document.getElementById("nav-account");
cloud.onStatus((s) => {
  if (!cloud.configured) return;
  navAccount.hidden = false;
  navAccount.textContent = s.email ? "User info" : "Sign in";
  note.innerHTML = s.email
    ? `<div class="side-sync ${s.error ? "bad" : s.busy || s.pending ? "busy" : "ok"}"><div class="meter"><i style="width:${(cloud.syncShare(s) * 100).toFixed(1)}%"></i></div>
       <a href="#/account">${esc(cloud.syncText(s))}</a></div>`
    : `Your data is kept in this browser only. <a href="#/account">Sign in</a> to save it to the cloud.`;
});
// Changes from another device: show them, unless a form is open here.
addEventListener("cloud-pulled", () => {
  const typing = document.activeElement?.matches?.("input, textarea, select");
  if (!typing && !/\/(new|edit)\b|\/quick\b|\/sizing\b|\/yield\b/.test(location.hash)) route();
});
