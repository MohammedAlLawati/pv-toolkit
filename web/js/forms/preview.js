// Show a generated .docx in the page with docx-preview (vendor/docx-preview, patched to draw
// the forms' text boxes where Word puts them; see vendor/docx-preview/README.md).

let loading = null;
function load() {
  if (window.docx?.renderAsync) return Promise.resolve();
  loading ||= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "vendor/docx-preview/docx-preview.min.js";
    s.onload = resolve;
    s.onerror = () => { loading = null; reject(new Error("The preview library didn't load.")); };
    document.head.appendChild(s);
  });
  return loading;
}

/** Render `blob` (a .docx) into `el`, scaled to fit its width. */
export async function renderPreview(blob, el) {
  await load();
  const box = document.createElement("div");
  box.className = "docx-preview";
  await window.docx.renderAsync(blob, box, null, {
    inWrapper: true, ignoreLastRenderedPageBreak: true, experimental: false, useBase64URL: true,
  });
  el.replaceChildren(box);
  // Drawings positioned from the page edge: docx-preview places them from the paragraph,
  // so move them left by the paragraph's distance from the page.
  for (const d of box.querySelectorAll("div[style*='--pv-page-x']")) {
    const page = d.closest("section"), p = d.closest("p");
    if (page && p) d.style.left = `calc(${d.style.left} - ${p.getBoundingClientRect().left - page.getBoundingClientRect().left}px)`;
  }
  fit(el);
}

/** Scale the pages down to the container's width (they render at full A4 size). */
export function fit(el) {
  const box = el.querySelector(".docx-preview");
  const wrapper = box?.querySelector(".docx-wrapper");
  if (!wrapper) return;
  wrapper.style.transform = "";
  const scale = Math.min(1, el.clientWidth / wrapper.scrollWidth);
  wrapper.style.transformOrigin = "top left";
  wrapper.style.transform = `scale(${scale})`;
  box.style.height = `${wrapper.scrollHeight * scale}px`;
}
