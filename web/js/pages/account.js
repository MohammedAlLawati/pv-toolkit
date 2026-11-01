// Account: sign in (email link) or, when signed in, the user's details, cloud usage and sync state.
// Also the welcome screen shown on first opening: sign in, or continue as a guest (browser only).
import { html, raw, toast } from "../ui.js";
import { setTitle } from "../app.js";
import * as cloud from "../cloud.js";

const MB = (b) => `${(b / 1048576).toFixed(b < 10485760 ? 1 : 0)} MB`;
// Supabase free plan
const LIMITS = { database: 500 * 1048576, files: 1024 * 1048576 };

export async function account(main) {
  setTitle(cloud.signedIn() ? "User info" : "Sign in");
  if (!cloud.configured) {
    main.innerHTML = html`<div class="panel empty">Cloud saving isn't set up for this site: everything stays in this browser.</div>`;
    return;
  }
  main.innerHTML = html`
<div class="head"><div><h1 id="acc-title"></h1><div class="muted" id="acc-sub"></div></div></div>
<div id="acc-body"></div>`;
  let shownFor = undefined, wasBusy = false;
  const stop = cloud.onStatus((s) => {
    if (!main.querySelector("#acc-body")) { stop?.(); return; }
    if (!s.ready) { main.querySelector("#acc-body").innerHTML = html`<div class="loading">Connecting…</div>`.toString(); return; }
    // redraw the whole page only when the user changes; otherwise just the sync box
    if (shownFor !== s.email) {
      shownFor = s.email;
      setTitle(s.email ? "User info" : "Sign in");
      main.querySelector("#acc-title").textContent = s.email ? "User info" : "Sign in";
      main.querySelector("#acc-sub").textContent = s.email ? "Your account and what's saved in the cloud." : "Save your work to the cloud and use it on any computer.";
      if (s.email) drawUser(main.querySelector("#acc-body"), s);
      else drawSignIn(main.querySelector("#acc-body"));
    }
    const box = main.querySelector("#acc-sync");
    if (box) box.innerHTML = syncBox(s);
    // a sync just finished: the cloud usage may have changed
    if (wasBusy && !s.busy) main.querySelector("#acc-usage-refresh")?.click();
    wasBusy = s.busy;
  });
}

function syncBox(s) {
  const share = cloud.syncShare(s), cls = s.error ? "error" : s.busy || s.pending ? "warn" : "ok";
  return html`<div class="sync-box ${cls}">
    <div class="sync-line"><b>${s.error ? "Not synced" : s.busy ? "Syncing…" : s.pending ? "Changes waiting to be sent" : "Everything is saved to the cloud"}</b>
      <span>${cloud.syncText(s)}</span></div>
    <div class="meter"><i style="width: ${(share * 100).toFixed(1)}%"></i></div>
  </div>`.toString();
}

function drawUser(box, s) {
  box.innerHTML = html`
<div class="panel">
  <h2>Signed in</h2>
  <div class="summary two">
    <div><span>Email</span><b>${s.email}</b><small class="muted">Sign-in by emailed link</small></div>
    <div><span>Account</span><b>Personal</b><small class="muted">Only you can see this data</small></div>
  </div>
  <div class="btns"><button class="btn" id="acc-out">Sign out</button></div>
</div>
<div class="panel">
  <div class="panel-head"><h2>Sync</h2><button class="btn small" id="acc-sync-now">Sync now</button></div>
  <p class="small muted">Every change is sent to the cloud a moment after you save it, and changes from your other computers are fetched when the app opens, every minute, and when you come back to the window.</p>
  <div id="acc-sync"></div>
</div>
<div class="panel">
  <div class="panel-head"><h2>Cloud storage used</h2><button class="btn small" id="acc-usage-refresh">Refresh</button></div>
  <div id="acc-usage"><div class="loading">Checking…</div></div>
</div>`.toString();
  box.querySelector("#acc-out").onclick = async () => {
    if (!confirm("Sign out? Your data stays in this browser but stops syncing until you sign in again.")) return;
    await cloud.signOut();
  };
  box.querySelector("#acc-sync-now").onclick = () => cloud.sync();
  const drawUsage = async () => {
    const out = box.querySelector("#acc-usage");
    try {
      const [u, est] = await Promise.all([cloud.usage(), navigator.storage?.estimate?.().catch(() => null)]);
      const bar = (used, limit) => html`<div class="meter"><i style="width: ${Math.min(100, (used / limit) * 100).toFixed(1)}%"></i></div>`;
      out.innerHTML = html`
      <div class="usage">
        <div><span>Files (datasheets, logos, reports)</span><b>${MB(u.bytes)}</b><small class="muted">${u.files} files · of the free plan's ${MB(LIMITS.files)}</small>${bar(u.bytes, LIMITS.files)}</div>
        <div><span>Records (clients, projects, offers, library)</span><b>${u.records}</b><small class="muted">A few KB each · the free plan holds ${MB(LIMITS.database)}</small></div>
        <div><span>In this browser</span><b>${est ? MB(est.usage) : "—"}</b><small class="muted">The local working copy</small></div>
      </div>`.toString();
    } catch (err) {
      out.innerHTML = html`<div class="flash error">Couldn't read the cloud usage: ${err.message || err}</div>`.toString();
    }
  };
  box.querySelector("#acc-usage-refresh").onclick = drawUsage;
  drawUsage();
}

function signInForm(sentTo) {
  return html`
  <form id="acc-in" class="signin">
    <label>Email<input type="email" name="email" required autocomplete="email" placeholder="you@company.com" value="${sentTo || ""}"></label>
    <button class="btn primary">Email me a sign-in link</button>
  </form>
  ${sentTo ? html`<div class="flash ok spaced-top">Sign-in link sent to <b>${sentTo}</b>. Open it in this browser to finish signing in.</div>` : ""}`.toString();
}

function wireSignIn(box, redraw) {
  box.querySelector("#acc-in").onsubmit = async (e) => {
    e.preventDefault();
    const email = e.target.email.value.trim();
    const btn = e.target.querySelector("button");
    btn.disabled = true;
    try {
      await cloud.signIn(email);
      cloud.setGuest(false);
      redraw(email);
    } catch (err) {
      btn.disabled = false;
      toast(err.message || String(err), "error");
    }
  };
}

function drawSignIn(box) {
  const redraw = (sentTo) => {
    box.innerHTML = html`
<div class="panel">
  <h2>Sign in</h2>
  <p class="small muted">We email you a link: no password needed. Once signed in, everything in this browser is saved to the cloud and comes back on any computer where you sign in.</p>
  ${raw(signInForm(sentTo))}
</div>`.toString();
    wireSignIn(box, redraw);
  };
  redraw(null);
}

/** First opening: sign in, or carry on in this browser only. */
export async function welcome(main) {
  setTitle("Welcome");
  document.querySelector(".shell")?.classList.add("gate");
  const next = sessionStorage.getItem("pv-toolkit-after-welcome") || "#/";
  const leave = () => {
    document.querySelector(".shell")?.classList.remove("gate");
    location.hash = next;
  };
  const draw = (sentTo) => {
    main.innerHTML = html`
<div class="welcome panel">
  <img src="icon.svg" alt="" width="44" height="44">
  <h1>PV Toolkit</h1>
  <p class="muted">Sign in to save your work to the cloud and use it on any computer, or continue as a guest to keep everything in this browser only.</p>
  ${raw(signInForm(sentTo))}
  <div class="or"><span>or</span></div>
  <button class="btn" id="guest">Continue as guest</button>
  <p class="small muted">As a guest, nothing leaves this browser; use Letterhead &amp; backup to keep a backup file. You can sign in later from the top of the menu.</p>
</div>`.toString();
    wireSignIn(main, draw);
    main.querySelector("#guest").onclick = () => { cloud.setGuest(true); leave(); };
  };
  draw(null);
  // signed in from the emailed link in another tab, or here
  const stop = cloud.onStatus((s) => { if (s.email && main.querySelector(".welcome")) { stop?.(); leave(); } });
}
