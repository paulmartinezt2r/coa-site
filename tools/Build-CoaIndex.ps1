<#
.SYNOPSIS
    Regenerates coa-index.json from the PDFs sitting in your S3 bucket.

.DESCRIPTION
    Lists every .pdf under the given bucket/prefix, turns each filename into a
    search code, and writes coa-index.json next to index.html.

    Metadata already present in coa-index.json is preserved, so anything you
    typed in by hand survives a rebuild. New PDFs come in as stubs with just
    the code and accession number filled in — enough for lookup to work.

    Optionally merges a CSV export from your LIMS (-MetadataCsv), which is the
    low-effort way to keep compound, purity, and dates populated at scale.

.EXAMPLE
    .\Build-CoaIndex.ps1 -Bucket my-lab-coas -Prefix coas/

.EXAMPLE
    .\Build-CoaIndex.ps1 -Bucket my-lab-coas -Prefix coas/ -MetadataCsv .\lims-export.csv

.NOTES
    Requires the AWS CLI, already authenticated (aws configure).
    CSV columns recognised (header row required, only 'code' is mandatory):
    code, accession, company, compound, lot, received, reported, purity,
    identity, rt, mz, massTheoretical, methods, file
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Bucket,
    [string]$Prefix = "coas/",
    [string]$MetadataCsv,
    [string]$OutFile = (Join-Path $PSScriptRoot "..\coa-index.json"),
    [switch]$DropExamples
)

$ErrorActionPreference = "Stop"

# --- 1. Existing metadata -------------------------------------------------

$existing = @{}
$resolvedOut = [System.IO.Path]::GetFullPath($OutFile)

if (Test-Path $resolvedOut) {
    $old = Get-Content $resolvedOut -Raw | ConvertFrom-Json
    foreach ($r in $old.records) {
        if ($DropExamples -and $r.example) { continue }
        $existing[$r.code.ToUpper()] = $r
    }
    Write-Host "Carried forward $($existing.Count) existing record(s)." -ForegroundColor DarkGray
}

# --- 2. CSV metadata (optional) -------------------------------------------

$csv = @{}
if ($MetadataCsv) {
    if (-not (Test-Path $MetadataCsv)) { throw "CSV not found: $MetadataCsv" }
    foreach ($row in Import-Csv $MetadataCsv) {
        if ($row.code) { $csv[$row.code.Trim().ToUpper()] = $row }
    }
    Write-Host "Loaded $($csv.Count) row(s) from $MetadataCsv." -ForegroundColor DarkGray
}

# --- 3. List the bucket ----------------------------------------------------

Write-Host "Listing s3://$Bucket/$Prefix ..." -ForegroundColor Cyan

$raw = aws s3api list-objects-v2 --bucket $Bucket --prefix $Prefix --output json
if (-not $?) { throw "aws s3api failed. Check credentials and bucket name." }

$listing = $raw | ConvertFrom-Json
$keys = @()
if ($listing.Contents) {
    $keys = $listing.Contents | Where-Object { $_.Key -match '\.pdf$' } | Select-Object -ExpandProperty Key
}

if (-not $keys -or $keys.Count -eq 0) {
    Write-Warning "No PDFs found under s3://$Bucket/$Prefix — nothing to index."
    return
}

Write-Host "Found $($keys.Count) PDF(s)." -ForegroundColor Cyan

# --- 4. Build records ------------------------------------------------------

$records = New-Object System.Collections.ArrayList

foreach ($key in ($keys | Sort-Object)) {
    $file = [System.IO.Path]::GetFileName($key)
    $code = [System.IO.Path]::GetFileNameWithoutExtension($file).ToUpper()

    # Accession = the task number: the last run of 4+ digits, optionally followed
    # by a suffix such as -COA (VPL-219777-COA -> 219777)
    $accession = $null
    if ($code -match '(\d{4,})(?:-[A-Z]+)?$') { $accession = $Matches[1] }

    $rec = [ordered]@{ code = $code }
    if ($accession) { $rec.accession = $accession }

    # Layer on what we already knew, then the CSV (CSV wins)
    foreach ($source in @($existing[$code], $csv[$code])) {
        if ($null -eq $source) { continue }
        foreach ($p in $source.PSObject.Properties) {
            if ($p.Name -eq 'code' -or $p.Name -eq 'example') { continue }
            if ($null -ne $p.Value -and "$($p.Value)".Trim() -ne "") {
                $rec[$p.Name] = $p.Value
            }
        }
    }

    # Numeric fields must not serialise as strings
    foreach ($n in @('purity', 'rt')) {
        if ($rec.Contains($n) -and $rec[$n] -ne $null) {
            $parsed = 0.0
            if ([double]::TryParse("$($rec[$n])", [ref]$parsed)) { $rec[$n] = $parsed }
        }
    }

    # Record the real key when it differs from <code>.pdf, so the site can
    # still resolve it
    $prefixTrim = $Prefix.TrimEnd('/')
    $relative = if ($prefixTrim) { $key -replace ("^" + [regex]::Escape($prefixTrim) + "/"), "" } else { $key }
    if ($relative -ne "$code.pdf") { $rec.file = $relative }

    [void]$records.Add([pscustomobject]$rec)
}

# --- 5. Write it out -------------------------------------------------------

$payload = [ordered]@{
    updated = (Get-Date -Format "yyyy-MM-dd")
    source  = "s3://$Bucket/$Prefix"
    records = $records
}

$json = [pscustomobject]$payload | ConvertTo-Json -Depth 6

# No BOM — a BOM breaks JSON.parse in some browsers
[System.IO.File]::WriteAllText($resolvedOut, $json, (New-Object System.Text.UTF8Encoding($false)))

Write-Host "Wrote $($records.Count) record(s) to $resolvedOut" -ForegroundColor Green
Write-Host "Commit and push to publish:" -ForegroundColor DarkGray
Write-Host "  git add coa-index.json; git commit -m 'Update COA index'; git push" -ForegroundColor DarkGray
