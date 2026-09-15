/* ==================================================================
   COA registry — lookup + chromatogram rendering
   No dependencies. Everything configurable lives in config.js.
   ================================================================== */

(function () {
  "use strict";

  var CFG = window.COA_CONFIG || {};
  var INDEX = null;          // { records: [...] } once loaded
  var mode = "code";         // "code" | "company"

  var $ = function (sel, root) { return (root || document).querySelector(sel); };

  /* ----------------------------------------------------------------
     Theme-aware colour access
     ---------------------------------------------------------------- */

  function cssVar(name) {
    return getComputedStyle(document.documentElement)
      .getPropertyValue(name).trim();
  }

  /* ----------------------------------------------------------------
     Chromatogram

     Peaks are gaussians on a retention-time axis. The hero trace is
     illustrative of the method; the trace on a result card is built
     from that record's own reported RT and purity, so the main peak
     and the impurity envelope reflect the numbers on the COA.
     ---------------------------------------------------------------- */

  function peaksForRecord(rec) {
    var rt = typeof rec.rt === "number" ? rec.rt : 5.4;
    var purity = typeof rec.purity === "number" ? rec.purity : 99;
    var impurity = Math.max(0.1, 100 - purity);
    var peaks = [{ rt: rt, area: purity, w: 0.085 }];

    // Distribute the remaining area over a few small, plausible peaks
    var offsets = [-1.42, -0.61, 0.74, 1.93];
    var shares = [0.34, 0.26, 0.25, 0.15];
    offsets.forEach(function (off, i) {
      var t = rt + off;
      if (t > 0.5 && t < 9.6) {
        peaks.push({ rt: t, area: impurity * shares[i] * 7, w: 0.07 });
      }
    });
    return { peaks: peaks, mainRt: rt, purity: purity };
  }

  var HERO_PEAKS = {
    peaks: [
      { rt: 0.72, area: 3.4, w: 0.06 },
      { rt: 1.95, area: 2.1, w: 0.07 },
      { rt: 3.31, area: 4.6, w: 0.07 },
      { rt: 6.42, area: 99, w: 0.09 },
      { rt: 7.58, area: 3.0, w: 0.07 },
      { rt: 8.44, area: 1.7, w: 0.06 }
    ],
    mainRt: 6.42,
    purity: 99.14
  };

  function drawTrace(canvas, spec, opts) {
    opts = opts || {};
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = canvas.clientWidth;
    var h = opts.height || 180;
    if (!w) return;

    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.height = h + "px";

    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    var ink3 = cssVar("--ink-3");
    var rule = cssVar("--rule");
    var signal = cssVar("--signal");
    var padL = opts.compact ? 6 : 34;
    var padR = 10;
    var padT = opts.compact ? 10 : 16;
    var padB = opts.compact ? 16 : 26;
    var plotW = w - padL - padR;
    var plotH = h - padT - padB;
    var xMax = 10;

    if (plotW <= 4 || plotH <= 4) return;

    var xOf = function (t) { return padL + (t / xMax) * plotW; };

    // Signal at retention time t (arbitrary mAU, normalised below)
    var signalAt = function (t) {
      var y = 0;
      for (var i = 0; i < spec.peaks.length; i++) {
        var p = spec.peaks[i];
        y += p.area * Math.exp(-Math.pow(t - p.rt, 2) / (2 * p.w * p.w));
      }
      return y + 0.35 + Math.sin(t * 1.7) * 0.12; // faint baseline drift
    };

    var peak = 0;
    var samples = Math.max(240, Math.round(plotW));
    var vals = [];
    for (var s = 0; s <= samples; s++) {
      var t = (s / samples) * xMax;
      var v = signalAt(t);
      vals.push(v);
      if (v > peak) peak = v;
    }
    var yOf = function (v) { return padT + plotH - (v / (peak * 1.06)) * plotH; };

    // Gridlines and RT axis
    ctx.strokeStyle = rule;
    ctx.lineWidth = 1;
    ctx.font = "500 9px " + (cssVar("--mono") || "monospace");
    ctx.fillStyle = ink3;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    for (var g = 0; g <= xMax; g += 2) {
      var gx = Math.round(xOf(g)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(gx, padT);
      ctx.lineTo(gx, padT + plotH);
      ctx.stroke();
      // The last tick's slot belongs to the "min" unit label
      if (!opts.compact && g < xMax) {
        ctx.fillText(String(g), gx, padT + plotH + 7);
      }
    }

    if (!opts.compact) {
      ctx.save();
      ctx.textAlign = "left";
      ctx.fillText("mAU", 4, padT - 2);
      ctx.textAlign = "right";
      ctx.fillText("min", w - 2, padT + plotH + 7);
      ctx.restore();
    }

    // Baseline
    ctx.strokeStyle = rule;
    ctx.beginPath();
    ctx.moveTo(padL, Math.round(padT + plotH) + 0.5);
    ctx.lineTo(padL + plotW, Math.round(padT + plotH) + 0.5);
    ctx.stroke();

    // Trace path
    var path = new Path2D();
    for (var i = 0; i <= samples; i++) {
      var px = padL + (i / samples) * plotW;
      var py = yOf(vals[i]);
      if (i === 0) path.moveTo(px, py); else path.lineTo(px, py);
    }

    // Area under the curve
    var fill = new Path2D(path);
    fill.lineTo(padL + plotW, padT + plotH);
    fill.lineTo(padL, padT + plotH);
    fill.closePath();
    var grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
    grad.addColorStop(0, cssVar("--signal-soft"));
    grad.addColorStop(1, "transparent");
    ctx.fillStyle = grad;
    ctx.fill(fill);

    ctx.strokeStyle = signal;
    ctx.lineWidth = opts.compact ? 1.1 : 1.35;
    ctx.lineJoin = "round";
    ctx.stroke(path);

    // Main peak annotation
    if (!opts.compact) {
      var mx = xOf(spec.mainRt);
      var my = yOf(signalAt(spec.mainRt));
      ctx.setLineDash([2, 3]);
      ctx.strokeStyle = cssVar("--signal-line");
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(mx, my - 6);
      ctx.lineTo(mx, padT + plotH);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = signal;
      ctx.textBaseline = "bottom";
      ctx.textAlign = mx > w - 70 ? "right" : "left";
      var pad = ctx.textAlign === "right" ? -6 : 6;
      ctx.font = "500 10px " + (cssVar("--mono") || "monospace");
      ctx.fillText(spec.purity.toFixed(2) + "%", mx + pad, my - 8);
      ctx.fillStyle = ink3;
      ctx.font = "500 9px " + (cssVar("--mono") || "monospace");
      ctx.fillText("RT " + spec.mainRt.toFixed(2), mx + pad, my + 4);
    }
  }

  var traces = []; // [{ canvas, spec, opts }]

  function registerTrace(canvas, spec, opts) {
    var entry = { canvas: canvas, spec: spec, opts: opts };
    traces.push(entry);
    drawTrace(canvas, spec, opts);
    return entry;
  }

  function redrawAll() {
    traces.forEach(function (t) { drawTrace(t.canvas, t.spec, t.opts); });
  }

  /* ----------------------------------------------------------------
     Lookup
     ---------------------------------------------------------------- */

  function normalizeCode(v) {
    return String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  function pdfUrlFor(rec) {
    if (!CFG.pdfBase) return null;
    var file = rec.file || rec.code + ".pdf";
    return CFG.pdfBase + file;
  }

  function findByCode(code) {
    if (!INDEX) return null;
    var digitsOnly = /^\d+$/.test(code);
    for (var i = 0; i < INDEX.records.length; i++) {
      var r = INDEX.records[i];
      if (normalizeCode(r.code) === code) return r;
      if (digitsOnly && normalizeCode(r.accession) === code) return r;
    }
    return null;
  }

  function findByCompany(name) {
    if (!INDEX) return null;
    var q = String(name || "").trim().toLowerCase();
    if (q.length < 2) return [];
    return INDEX.records.filter(function (r) {
      return String(r.company || "").toLowerCase().indexOf(q) > -1;
    });
  }

  /* ----------------------------------------------------------------
     Rendering
     ---------------------------------------------------------------- */

  var out = null;

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmtDate(iso) {
    if (!iso) return null;
    var d = new Date(iso + "T00:00:00");
    if (isNaN(d)) return iso;
    return d.toLocaleDateString("en-US", {
      year: "numeric", month: "short", day: "2-digit"
    });
  }

  function cell(label, value) {
    if (value == null || value === "") return "";
    return '<div class="cert-cell"><dt>' + esc(label) + "</dt>" +
           "<dd>" + esc(value) + "</dd></div>";
  }

  function renderCertificate(rec) {
    var url = pdfUrlFor(rec);
    var purity = typeof rec.purity === "number" ? rec.purity : null;

    var pills = "";
    if (rec.identity) {
      pills += '<span class="pill pill-confirmed">Identity ' + esc(rec.identity) + "</span>";
    }
    if (rec.example) {
      pills += '<span class="pill pill-example">Example record</span>';
    }

    var cells =
      cell("Search code", rec.code) +
      cell("Accession", rec.accession) +
      cell("Company", rec.company) +
      cell("Lot / Batch", rec.lot) +
      cell("Sample received", fmtDate(rec.received)) +
      cell("Report issued", fmtDate(rec.reported)) +
      cell("Observed m/z", rec.mz) +
      cell("Theoretical mass", rec.massTheoretical);

    var assay = "";
    if (purity !== null) {
      var clamped = Math.max(0, Math.min(100, purity));
      // Meter reads 95–100%, where peptide purity decisions are actually made
      var floor = 95;
      var pct = Math.max(0, (clamped - floor) / (100 - floor)) * 100;
      var tick = ((98 - floor) / (100 - floor)) * 100;
      assay =
        '<div class="assay">' +
          '<div class="assay-purity">' +
            '<p class="eyebrow">Purity by HPLC-UV, area %</p>' +
            '<div class="assay-figure" style="margin-top:8px">' +
              "<b>" + purity.toFixed(2) + "</b><span>% area</span>" +
            "</div>" +
            '<div class="meter">' +
              '<div class="meter-fill" style="width:' + pct.toFixed(1) + '%"></div>' +
              '<div class="meter-tick" style="left:' + tick.toFixed(1) + '%"></div>' +
            "</div>" +
            '<div class="meter-scale"><span>95.00</span>' +
              "<span>98.00 threshold</span><span>100.00</span></div>" +
          "</div>" +
          '<div class="assay-trace">' +
            '<canvas class="trace" data-record-trace aria-label="Chromatogram, main peak at ' +
              (rec.rt || "") + ' minutes"></canvas>' +
          "</div>" +
        "</div>";
    }

    var actions;
    if (url) {
      actions =
        '<a class="btn btn-primary" href="' + esc(url) + '" target="_blank" rel="noopener">View COA</a>' +
        '<a class="btn btn-ghost" href="' + esc(url) + '" download>Download PDF</a>';
    } else {
      actions =
        '<span class="btn btn-primary" aria-disabled="true">View COA</span>' +
        '<span class="hint">PDF location not set yet — add your bucket URL to <span class="mono">config.js</span></span>';
    }

    out.innerHTML =
      '<div class="panel cert">' +
        '<div class="cert-top">' +
          '<div class="cert-title">' +
            "<h3>" + esc(rec.compound || "Certificate of Analysis") + "</h3>" +
            '<div class="cert-sub">' + esc(rec.methods || "HPLC-UV · LC-MS") +
              (rec.rt ? " · RT " + rec.rt.toFixed(2) + " min" : "") + "</div>" +
          "</div>" +
          '<div class="pills">' + pills + "</div>" +
        "</div>" +
        '<dl class="cert-grid">' + cells + "</dl>" +
        assay +
        '<div class="cert-actions">' + actions + "</div>" +
      "</div>";

    var canvas = $("[data-record-trace]", out);
    if (canvas) {
      traces = traces.filter(function (t) { return t.canvas.isConnected; });
      registerTrace(canvas, peaksForRecord(rec), { height: 108, compact: true });
    }
  }

  function renderDirect(code) {
    renderCertificate({
      code: code,
      compound: "Certificate of Analysis",
      methods: "HPLC-UV · LC-MS",
      company: null,
      file: code + ".pdf"
    });
  }

  function renderHits(list, query) {
    var rows = list.map(function (r) {
      return '<button class="hit" type="button" data-code="' + esc(r.code) + '">' +
        '<span class="hit-compound">' + esc(r.compound || "—") + "</span>" +
        '<span class="hit-meta">' + esc(r.lot ? "Lot " + r.lot : "") +
          (r.reported ? "  ·  " + fmtDate(r.reported) : "") + "</span>" +
        '<span class="hit-purity">' +
          (typeof r.purity === "number" ? r.purity.toFixed(2) + "%" : "—") + "</span>" +
        '<span class="hit-code">' + esc(r.code) + "</span>" +
      "</button>";
    }).join("");

    out.innerHTML =
      '<div class="panel cert">' +
        '<div class="cert-top">' +
          '<div class="cert-title">' +
            "<h3>" + esc(list[0].company) + "</h3>" +
            '<div class="cert-sub">' + list.length +
              (list.length === 1 ? " certificate" : " certificates") +
              " matching “" + esc(query) + "”</div>" +
          "</div>" +
        "</div>" +
        '<div class="hits">' + rows + "</div>" +
      "</div>";

    Array.prototype.forEach.call(out.querySelectorAll(".hit"), function (btn) {
      btn.addEventListener("click", function () {
        var rec = findByCode(normalizeCode(btn.getAttribute("data-code")));
        if (rec) { renderCertificate(rec); setDeepLink(rec.code); focusResult(); }
      });
    });
  }

  // tone: "alert" (default) for nothing-found, "ok" for neutral states
  function renderNotice(title, body, tone) {
    out.innerHTML =
      '<div class="notice' + (tone === "ok" ? " notice-ok" : "") + '">' +
      "<strong>" + esc(title) + "</strong>" +
      "<p>" + body + "</p></div>";
  }

  function focusResult() {
    var band = $("#result");
    if (band) band.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function setDeepLink(code) {
    try {
      var u = new URL(window.location.href);
      u.searchParams.set("coa", code);
      history.replaceState(null, "", u);
    } catch (e) { /* sandboxed frame — deep link simply not updated */ }
  }

  /* ----------------------------------------------------------------
     Submit handling
     ---------------------------------------------------------------- */

  function handleSubmit(e) {
    if (e) e.preventDefault();
    var input = $("#q");
    var raw = input.value;

    if (mode === "company") {
      var hits = findByCompany(raw);
      if (hits === null) {
        renderNotice("Company search unavailable",
          "Company-name search reads the public index, which did not load. " +
          "Search by your Search Code instead — it works without the index.");
        return;
      }
      if (!raw.trim()) {
        renderNotice("Enter a company name",
          "Type the company name exactly as it appears on the certificate. Partial names match.");
        return;
      }
      if (!hits.length) {
        renderNotice("No certificates for that company",
          "Nothing in the public index matches <span class=\"mono\">" + esc(raw.trim()) +
          "</span>. Check the spelling, or search by Search Code instead.");
        return;
      }
      renderHits(hits, raw.trim());
      focusResult();
      return;
    }

    var code = normalizeCode(raw);
    if (!code) {
      renderNotice("Enter a search code",
        "Your Search Code is in the top-right table of your certificate: " +
        "four letters followed by the accession number.");
      return;
    }

    var rec = findByCode(code);
    if (rec) {
      renderCertificate(rec);
      setDeepLink(rec.code);
      focusResult();
      return;
    }

    var direct = (CFG.mode === "direct") || (CFG.mode === "auto" && !INDEX);
    if (direct && CFG.pdfBase) {
      verifyDirect(code);
      return;
    }

    renderNotice("No certificate found",
      "Nothing matches <span class=\"mono\">" + esc(code) + "</span>. " +
      "Copy the Search Code exactly as printed on your certificate — four letters " +
      "from the company name followed by the accession number, no spaces. " +
      "If it still does not resolve, email " +
      '<a href="mailto:' + esc(CFG.email || "") + '">' + esc(CFG.email || "the lab") + "</a>.");
  }

  function verifyDirect(code) {
    var url = CFG.pdfBase + code + ".pdf";
    renderNotice("Checking the archive…",
      "Looking up <span class=\"mono\">" + esc(code) + "</span>.", "ok");
    fetch(url, { method: "HEAD" }).then(function (res) {
      if (res.ok) { renderDirect(code); }
      else {
        renderNotice("No certificate found",
          "Nothing is filed under <span class=\"mono\">" + esc(code) + "</span>. " +
          "Check the code against your certificate and try again.");
      }
      focusResult();
    }).catch(function () {
      // CORS or network — the file may well exist, so offer it rather than deny it
      renderDirect(code);
      focusResult();
    });
  }

  /* ----------------------------------------------------------------
     Boot
     ---------------------------------------------------------------- */

  function fillConfig() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-cfg]"), function (el) {
      var path = el.getAttribute("data-cfg").split(".");
      var v = CFG;
      for (var i = 0; i < path.length && v != null; i++) v = v[path[i]];
      if (v != null && v !== "") el.textContent = v;
    });

    var addr = $("#address");
    if (addr && CFG.address) addr.innerHTML = CFG.address.map(esc).join("<br>");

    var mail = $("#mailto");
    if (mail && CFG.email) mail.href = "mailto:" + CFG.email;

    var q = $("#quality");
    if (q && CFG.quality) {
      q.innerHTML = CFG.quality.map(function (s) {
        return '<span class="chip">' + esc(s) + "</span>";
      }).join("");
    }
  }

  /* Live index readout in the masthead strip and the lookup panel bar.
     n === null means the index did not load, so lookups go direct. */
  function setIndexStatus(n) {
    var dot = $("#index-dot");
    var text = $("#index-status-text");
    var panel = $("#index-count");

    if (n === null) {
      if (text) text.textContent = "Direct lookup";
      if (dot) {
        dot.classList.add("is-off");
        if (dot.parentNode) dot.parentNode.classList.add("is-off");
      }
      if (panel) panel.textContent = "Direct lookup";
      return;
    }

    if (text) {
      text.textContent = n.toLocaleString() +
        (n === 1 ? " certificate live" : " certificates live");
    }
    if (panel) {
      panel.textContent = "Index · " + n.toLocaleString() +
        (n === 1 ? " record" : " records");
    }
  }

  /* Two-tier masthead: condenses on scroll, tracks the section you are in,
     and collapses the nav into a panel on narrow screens. */
  function setupMasthead() {
    var head = $("#masthead");
    var toggle = $("#nav-toggle");
    var nav = $("#nav");
    if (!head || !nav) return;

    /* Collapsing the utility strip removes ~32px of document height, which
       moves the scroll position. With a single threshold, any rest position
       near it oscillates forever: collapse shortens the page, scrollY drops
       back under the threshold, the strip re-expands, and round it goes.
       So the on and off thresholds are set further apart than the height
       the strip occupies. */
    var stuck = false;
    var onScroll = function () {
      var y = window.scrollY || window.pageYOffset || 0;
      if (!stuck && y > 96) {
        stuck = true;
        head.classList.add("is-stuck");
      } else if (stuck && y < 48) {
        stuck = false;
        head.classList.remove("is-stuck");
      }
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    /* The wordmark means "back to the top of the page", not "jump to the
       hero's anchor offset" — which would land inside the band above. */
    var mark = document.querySelector(".wordmark");
    if (mark) {
      mark.addEventListener("click", function (ev) {
        ev.preventDefault();
        var smooth = !(window.matchMedia &&
          window.matchMedia("(prefers-reduced-motion: reduce)").matches);
        window.scrollTo({ top: 0, behavior: smooth ? "smooth" : "auto" });
      });
    }

    var closePanel = function () {
      nav.classList.remove("is-open");
      if (toggle) {
        toggle.setAttribute("aria-expanded", "false");
        toggle.setAttribute("aria-label", "Open navigation");
      }
    };

    if (toggle) {
      toggle.addEventListener("click", function () {
        var open = nav.classList.toggle("is-open");
        toggle.setAttribute("aria-expanded", String(open));
        toggle.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
      });
    }

    var links = Array.prototype.slice.call(nav.querySelectorAll("a"));
    links.forEach(function (a) { a.addEventListener("click", closePanel); });
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") closePanel();
    });

    if (!("IntersectionObserver" in window)) return;

    var sections = links.map(function (a) {
      var href = a.getAttribute("href") || "";
      return href.charAt(0) === "#" ? document.querySelector(href) : null;
    });

    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var i = sections.indexOf(en.target);
        links.forEach(function (l, j) {
          if (j === i) l.setAttribute("aria-current", "true");
          else l.removeAttribute("aria-current");
        });
      });
    }, { rootMargin: "-45% 0px -50% 0px" });

    sections.forEach(function (s) { if (s) spy.observe(s); });
  }

  function setMode(next) {
    mode = next;
    var input = $("#q");
    Array.prototype.forEach.call(document.querySelectorAll(".segmented button"), function (b) {
      b.setAttribute("aria-selected", String(b.getAttribute("data-mode") === next));
    });
    if (next === "company") {
      input.placeholder = "Example Research Supply";
      input.setAttribute("aria-label", "Company name");
      input.style.letterSpacing = "normal";
    } else {
      input.placeholder = "ABCD2603170030";
      input.setAttribute("aria-label", "Search code or accession number");
      input.style.letterSpacing = "";
    }
    input.value = "";
    input.focus();
  }

  function start() {
    out = $("#result-out");
    fillConfig();
    setupMasthead();

    var heroCanvas = $("#hero-trace");
    if (heroCanvas) registerTrace(heroCanvas, HERO_PEAKS, { height: 196 });

    // Driven by click and Enter rather than a native form submit, so the
    // lookup also works where form submission is blocked (sandboxed frames,
    // embedded previews).
    $("#lookup-form").addEventListener("submit", handleSubmit);
    $("#lookup-btn").addEventListener("click", handleSubmit);
    $("#q").addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") { ev.preventDefault(); handleSubmit(); }
    });
    Array.prototype.forEach.call(document.querySelectorAll(".segmented button"), function (b) {
      b.addEventListener("click", function () { setMode(b.getAttribute("data-mode")); });
    });

    // Redraw traces on resize and on theme change
    var t;
    window.addEventListener("resize", function () {
      clearTimeout(t);
      t = setTimeout(redrawAll, 120);
    });
    if (window.matchMedia) {
      var mq = window.matchMedia("(prefers-color-scheme: dark)");
      if (mq.addEventListener) mq.addEventListener("change", redrawAll);
    }
    new MutationObserver(redrawAll).observe(document.documentElement, {
      attributes: true, attributeFilter: ["data-theme"]
    });

    // Load the index, then honour any ?coa= deep link
    var wanted = null;
    try { wanted = new URL(window.location.href).searchParams.get("coa"); } catch (e) {}

    if (CFG.mode === "direct") { setIndexStatus(null); afterIndex(wanted); return; }

    fetch(CFG.indexUrl || "coa-index.json", { cache: "no-cache" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (json) {
        if (json && Array.isArray(json.records)) {
          INDEX = json;
          var n = json.records.length;
          setIndexStatus(n);
          var fig = $("#fig-certificates");
          if (fig && !(CFG.figures || {}).certificates) fig.textContent = n.toLocaleString();
        } else {
          setIndexStatus(null);
        }
      })
      .catch(function () { setIndexStatus(null); })
      .then(function () { afterIndex(wanted); });
  }

  function afterIndex(wanted) {
    if (wanted) {
      $("#q").value = wanted;
      handleSubmit();
      return;
    }
    // Open in a working state: show the first record so the page
    // demonstrates what a resolved certificate looks like.
    if (INDEX && INDEX.records.length) {
      renderCertificate(INDEX.records[0]);
    } else {
      renderNotice("Ready",
        "Enter a Search Code above to retrieve a certificate.", "ok");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
