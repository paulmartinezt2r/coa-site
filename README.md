# COA Registry — single-page lab site

A static, one-page site for publishing and retrieving certificates of analysis.
No backend, no database, no build step. A client types their search code, the page
resolves it to a PDF, and the certificate renders with its purity, identity, and
chromatogram summary.

```
coa-site/
├── index.html          the page
├── config.js           ← the only file you edit day to day
├── coa-index.json      the searchable record list
├── assets/
│   ├── styles.css
│   └── app.js
└── tools/
    └── Build-CoaIndex.ps1   regenerates coa-index.json from your S3 bucket
```

---

## The recommended setup

**Site on GitHub Pages, PDFs in S3.** Free hosting for the page, cheap storage
for the files, and the repo stays small because thousands of PDFs never enter git.

| Piece | Lives in | Why |
|---|---|---|
| `index.html`, CSS, JS | GitHub Pages | Free, custom domain, zero ops |
| `coa-index.json` | GitHub Pages | Same origin as the page — no CORS to configure |
| COA PDFs | S3 (or CloudFront) | Keeps the repo light; PDFs are just links |

Adding a certificate is then: **upload the PDF, run one script, push.** If you skip
the index entirely (see *Direct mode* below), it is just: **upload the PDF.**

---

## 1. Put the site on GitHub Pages

```bash
cd coa-site
git init
git add .
git commit -m "COA registry site"
git branch -M main
git remote add origin https://github.com/YOUR-USER/YOUR-REPO.git
git push -u origin main
```

Then in the repo: **Settings → Pages → Source: Deploy from a branch → `main` / `/ (root)`**.

It publishes at `https://YOUR-USER.github.io/YOUR-REPO/`. For a custom domain, add it
under Settings → Pages and point a `CNAME` record at `YOUR-USER.github.io`.

> If the repo is private, GitHub Pages requires a paid plan. A public repo is
> normally what you want here anyway — the whole point is a public record.

---

## 2. Set up the S3 bucket

Create a bucket (e.g. `my-lab-coas`) and a `coas/` prefix inside it. The PDFs must
be publicly readable, so under **Permissions**:

1. Turn **off** "Block all public access" for the bucket.
2. Add this bucket policy — it grants read on `coas/*` only, nothing else:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "PublicReadCoas",
    "Effect": "Allow",
    "Principal": "*",
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::my-lab-coas/coas/*"
  }]
}
```

Then set `pdfBase` in `config.js`:

```js
pdfBase: "https://my-lab-coas.s3.us-east-1.amazonaws.com/coas/",
```

**Upload a COA** — name the file exactly the search code, and set the headers so it
opens in the browser instead of downloading:

```bash
aws s3 cp ABCD2603170030.pdf s3://my-lab-coas/coas/ABCD2603170030.pdf --content-type application/pdf --content-disposition inline
```

Only put certificates in this bucket. Everything under `coas/` is world-readable by
design, and so is `coa-index.json`.

### Optional: CloudFront

Put CloudFront in front of the bucket for a tidy URL (`https://coas.my-lab.com/...`),
caching, and the ability to re-lock the bucket to origin-access-only. Then
`pdfBase: "https://coas.my-lab.com/"`. Nothing else changes.

---

## 3. Keep the index current

`coa-index.json` is what makes company-name search and the metadata on the result
card work. Regenerate it from the bucket:

```powershell
cd coa-site\tools
.\Build-CoaIndex.ps1 -Bucket my-lab-coas -Prefix coas/ -DropExamples
```

The script lists every PDF, turns each filename into a search code, and **preserves
metadata already in the file** — so anything you typed in by hand survives a rebuild.
New PDFs arrive as stubs with just the code and accession number, which is enough for
lookup to work.

To populate compound, purity, and dates at scale, export a CSV from your LIMS and
merge it in:

```powershell
.\Build-CoaIndex.ps1 -Bucket my-lab-coas -Prefix coas/ -MetadataCsv .\lims-export.csv
```

CSV columns recognised (header row required, only `code` is mandatory):

```
code,accession,company,compound,lot,received,reported,purity,identity,rt,mz,massTheoretical,methods
```

Then commit:

```bash
git add coa-index.json && git commit -m "Update COA index" && git push
```

### Direct mode — no index at all

Set `mode: "direct"` in `config.js` and the page turns the search code straight into
`pdfBase + CODE + ".pdf"`. Uploading the PDF is then the *only* step — nothing to
commit, nothing to regenerate. The trade-off: no company-name search, and the result
card shows just the code and the download buttons.

Direct mode does a `HEAD` request to tell "not found" apart from "found", which needs
CORS on the bucket:

```json
[{
  "AllowedHeaders": ["*"],
  "AllowedMethods": ["GET", "HEAD"],
  "AllowedOrigins": ["https://your-site-domain.com"],
  "ExposeHeaders": []
}]
```

Without CORS the check fails open — the page offers the PDF rather than denying it.

`mode: "auto"` (the default) uses the index when it loads and falls back to direct
when it does not.

---

## Before you go live

- [ ] `config.js` — lab name, address, email, location, established year
- [ ] `config.js` — `pdfBase` pointing at your bucket
- [ ] `config.js` — `figures`: publish only numbers you can stand behind. Leave
      `certificates: null` and the tile shows the live count from the index instead.
- [ ] `config.js` — `quality`: **state only what you actually hold.** "Aligned to
      ISO 9001 principles" and "accredited to ISO 9001" are very different claims,
      and the second one needs a certificate number behind it.
- [ ] `coa-index.json` — delete the six example records (or run the script with
      `-DropExamples`). They are flagged `"example": true` and render with a red
      *Example record* pill so they cannot be mistaken for real results.
- [ ] `index.html` — point `#form-link` at your submission form PDF
- [ ] Footer disclaimer — have someone confirm the research-use-only wording matches
      how you actually operate

## Nice to know

- **Deep links.** `?coa=ABCD2603170030` opens the page with that certificate already
  resolved. Paste it into the email that delivers the COA and the client's customers
  can verify the batch in one click.
- **Accession numbers.** The search code convention is the first four characters of
  the company name plus the accession number. The index script parses the trailing
  digit run as the accession automatically.
- **Chromatograms.** The trace on each result card is drawn from that record's own
  reported retention time and purity — the main peak sits at the stated RT and the
  impurity envelope reflects the stated purity. It is an at-a-glance summary, not a
  reproduction of the raw detector file. The PDF remains the record of authority,
  which is what the line above the result says.
- **Themes.** The page follows the visitor's light/dark preference.
- **No testimonials section.** Deliberately left out rather than filled with
  placeholder quotes — drop in real ones when you have them.
