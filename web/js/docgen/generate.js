// Build the Word documents for a project in the browser.
import { getFile } from "../store.js";
import { renderDocx } from "./render.js";
import { DOCS, buildFlags, buildValues, docFilename, templateFor } from "./context.js";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const cache = new Map();

async function template(name) {
  if (!cache.has(name)) {
    const res = await fetch("templates/" + name);
    if (!res.ok) throw new Error(`Template ${name} is missing (${res.status}).`);
    cache.set(name, await res.arrayBuffer());
  }
  return cache.get(name);
}

/** A stored image file -> the shape renderDocx wants. */
async function image(fileId) {
  const rec = await getFile(fileId);
  if (!rec || !rec.blob) return null;
  let { width, height } = rec;
  if (!width || !height) {
    const bmp = await createImageBitmap(rec.blob);
    width = bmp.width; height = bmp.height;
  }
  const ext = rec.mime === "image/png" ? "png" : "jpg";
  return { bytes: new Uint8Array(await rec.blob.arrayBuffer()), ext, width, height };
}

/** `p` is a full project (see data.full). Returns { blob, filename, missing }. */
export async function generate(docKey, p) {
  if (!DOCS[docKey]) throw new Error("Unknown document " + docKey);
  const images = {
    consultant_stamp: p.consultant ? await image(p.consultant.stamp_file_id) : null,
    contractor_stamp: p.contractor ? await image(p.contractor.stamp_file_id) : null,
    layout: await image(p.layout_file_id),
  };
  const out = await renderDocx(await template(templateFor(docKey, p)),
                               { values: buildValues(p), flags: buildFlags(p), images });
  return { blob: new Blob([out.bytes], { type: DOCX_MIME }), filename: docFilename(docKey, p), missing: out.missing };
}

/** Several documents in one .zip. */
export async function generatePack(keys, p) {
  const zip = new globalThis.JSZip();
  for (const k of keys) {
    const { blob, filename } = await generate(k, p);
    zip.file(filename, blob);
  }
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  return { blob, filename: docFilename("initial", p, "zip").replace("NAMA_Initial_Form_", "Submission_") };
}

/** The deck's pictures, each with the corner its logo goes in (p.logo_corners). */
async function offerImages(p) {
  const corners = p.logo_corners || {};
  const out = {
    site: (await image(p.offer_site_file_id)) || (await image(p.layout_file_id)),
    shadow: await image(p.offer_shadow_file_id),
    structure: await image(p.offer_structure_file_id),
    structure2: await image(p.offer_structure2_file_id),
  };
  for (const [k, img] of Object.entries(out)) if (img && corners[k]) img.logoCorner = corners[k];
  out.client_logo = await image(p.client_logo_file_id);
  return out;
}

/**
 * A picture of a library module or inverter, from its datasheet: the picture cut out ahead of
 * time for the built-in datasheets (data/products, see tools/extract_product_images.py), else
 * the largest picture on the datasheet's first page. Null when there's none.
 */
async function productImage(item) {
  const sheet = item?.datasheet_id ? await getFile(item.datasheet_id) : null;
  if (!sheet?.blob) return null;
  try {
    const res = await fetch(`data/products/${encodeURIComponent(sheet.name.replace(/\.pdf$/i, ""))}.png`);
    const blob = res.ok ? await res.blob() : await (await import("../offer/helioscope.js")).largestPicture(sheet.blob);
    if (!blob) return null;
    const bmp = await createImageBitmap(blob);
    const out = { bytes: new Uint8Array(await blob.arrayBuffer()), ext: blob.type === "image/png" ? "png" : "jpg", width: bmp.width, height: bmp.height };
    bmp.close?.();
    return out;
  } catch (err) {
    console.warn(`No picture from ${sheet.name}:`, err);
    return null;
  }
}

/** The offer deck (PowerPoint) for a project. Returns { blob, filename, missing, estimated }. */
export async function generateOffer(p) {
  const { renderPptx } = await import("../offer/pptx.js");
  const { buildOfferValues, componentsOf } = await import("../offer/values.js");
  const { values, months, flow, estimated, subsystems } = buildOfferValues(p);
  const images = await offerImages(p);
  const components = componentsOf(p);
  for (const [i, c] of components.entries()) images[`comp${i + 1}`] = await productImage(c.item);
  const out = await renderPptx(await template("offer_deck.pptx"), {
    values, months, flow, subsystems, components: components.length,
    moduleModel: p.module?.model || "", inverterModel: p.inverter?.model || "",
    moduleModels: p.module_models || [], inverterModels: p.inverter_models || [],
    schedule: p.schedule || null,
    images,
  });
  return { blob: new Blob([out.bytes], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }),
           filename: docFilename("initial", p, "pptx").replace("NAMA_Initial_Form_", "Offer_"), missing: out.missing, estimated };
}
