/* ------------------------------------------------------------------
   COA SITE CONFIGURATION
   This is the only file you need to edit for day-to-day changes.
   ------------------------------------------------------------------ */

window.COA_CONFIG = {

  /* --- Identity -------------------------------------------------- */

  // CHANGE ME: your lab's name. Appears in the header and footer.
  labName: "Meridian Analytical",
  labShort: "Meridian",

  // CHANGE ME
  established: "2023",
  location: "Franklin, Tennessee",
  address: [
    "Meridian Analytical",
    "133 Example Court, Suite 106",
    "Franklin, TN 37067"
  ],
  email: "results@example-lab.com",
  phone: "",

  /* --- Where the COA PDFs live ------------------------------------
     Base URL that COA filenames are appended to. Include the
     trailing slash. Leave as "" to disable the View/Download
     buttons (useful while you are still setting the bucket up).

     S3 example:
       "https://my-lab-coas.s3.us-east-1.amazonaws.com/coas/"
     CloudFront example:
       "https://coas.my-lab.com/"
     Same-repo example (PDFs committed next to the site):
       "coas/"
  ----------------------------------------------------------------- */
  pdfBase: "",

  /* --- How lookups resolve ---------------------------------------
     "index"  — read coa-index.json (enables company-name search and
                full metadata on the result card). Recommended.
     "direct" — no index; the search code is turned straight into
                pdfBase + CODE + ".pdf". Zero maintenance, but no
                company search and no metadata.
     "auto"   — use the index if it loads, otherwise fall back to
                direct. This is the safe default.
  ----------------------------------------------------------------- */
  mode: "auto",
  indexUrl: "coa-index.json",

  /* --- Public record figures --------------------------------------
     CHANGE ME: only publish numbers you can stand behind. Set any
     value to null to hide that tile.
  ----------------------------------------------------------------- */
  figures: {
    certificates: null,      // e.g. 12480 — leave null to show the live index count instead
    turnaround: "4–6",       // business days
    methodsPerCoa: "HPLC + LC-MS"
  },

  /* --- Quality statements -----------------------------------------
     CHANGE ME: state only what you actually hold or follow. Wording
     matters here — "aligned to X principles" is not the same claim
     as "accredited to X", and the second one needs a certificate
     number behind it.
  ----------------------------------------------------------------- */
  quality: [
    "Quality management aligned to ISO 9001 principles",
    "Good Laboratory Practice (GLP) principles"
  ],

  /* --- Instrument readout (hero panel) ---------------------------- */
  method: {
    detection: "UV 214 nm · ESI(+) MS",
    column: "C18, 2.6 µm, 100 × 4.6 mm",
    mobilePhase: "0.1% TFA in H₂O / ACN, gradient",
    flow: "1.0 mL/min, 30 °C",
    injection: "10 µL"
  }
};
