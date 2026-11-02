# docx-preview 0.4.1 (Apache-2.0)

`docx-preview.min.js` is the UMD build from the npm package `docx-preview@0.4.1`
(https://github.com/VolodymyrBaydalka/docxjs). It needs JSZip as a global (`vendor/jszip.min.js`).
Used by `js/forms/preview.js` to show generated forms in the page.

Patched so the NAMA forms preview like Word, where every value sits in a floating text box:

1. `He` (namespaces accepted in `mc:AlternateContent` choices) includes Word 2010 shapes
   (`wordprocessingShape`), so text boxes are read instead of dropped.
2. `parseGraphic` handles `wps:wsp` through a new `parseTextBoxShape`: the box's size, insets
   and vertical anchoring, with its `txbxContent` parsed as body content. A shape with no
   text that is a `mathMultiply` preset (the forms' tick marks) is drawn as a ✕.
3. Floating drawings (`wp:anchor`) are positioned absolutely from their paragraph (the page
   CSS makes paragraphs `position: relative`), stacked by `relativeHeight`; `behindDoc` goes
   behind the text. Page-relative ones carry `--pv-page-x` and are shifted by `preview.js`.
4. `renderDrawing` keeps the display / position set above instead of forcing inline-block.

To update: take the new UMD build, re-apply the four changes (search for `parseGraphic`,
`const He=`, `"wrapNone"==a` and `renderDrawing`), and check the four forms in the preview.
