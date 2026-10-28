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

/** The offer deck (PowerPoint) for a project. Returns { blob, filename, missing, estimated }. */
export async function generateOffer(p) {
  const { renderPptx } = await import("../offer/pptx.js");
  const { buildOfferValues } = await import("../offer/values.js");
  const { values, months, flow, estimated } = buildOfferValues(p);
  const out = await renderPptx(await template("offer_deck.pptx"), {
    values, months, flow,
    moduleModel: p.module?.model || "", inverterModel: p.inverter?.model || "",
    images: {
      site: (await image(p.offer_site_file_id)) || (await image(p.layout_file_id)),
      shadow: await image(p.offer_shadow_file_id),
      structure: await image(p.offer_structure_file_id),
    },
  });
  return { blob: new Blob([out.bytes], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }),
           filename: docFilename("initial", p, "pptx").replace("NAMA_Initial_Form_", "Offer_"), missing: out.missing, estimated };
}
