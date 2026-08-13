/**
 * Robustness and recalculation tests against the built dashboard.
 *
 * The single most important property of this file is that NOTHING is hardcoded:
 * swap the data and every number must change. These tests load synthetic CSVs
 * through the real file input and assert on what the page actually renders.
 *
 *   node tools/test_robustness.js [html]
 */
const { chromium } = require("/opt/node22/lib/node_modules/playwright");
const path = require("path");
const fs = require("fs");
const os = require("os");

const HTML = path.resolve(process.argv[2] || "rpa-monitor.html");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "rpa-test-"));

let passed = 0, failed = 0;
function check(name, condition, detail){
  if(condition){ passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}${detail ? "\n          " + detail : ""}`); }
}

function csv(rows){
  const q = v => /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
  return ["Status,Vendor,Reason,PO,Date"].concat(rows.map(r => r.map(q).join(","))).join("\n");
}
function write(name, content){
  const p = path.join(TMP, name);
  fs.writeFileSync(p, content);
  return p;
}

/** Synthetic dataset with a controllable shape. */
function makeRows(){
  const rows = [];
  const base = new Date(2027, 0, 4, 9, 0, 0);           // Mon 4 Jan 2027 09:00
  for(let day = 0; day < 20; day++){
    for(let i = 0; i < 12; i++){
      const t = new Date(base.getTime() + day * 86400000 + i * 5 * 60000);
      const fail = (day === 19 && i >= 6);              // burst of failures at the end
      rows.push([fail ? "Failure" : "Success", "ACME",
        fail ? "There is a mismatch between the items in AX and the vendor email." : "N/A",
        `PO-${day}-${i}`, iso(t)]);
    }
  }
  return rows;
}
function iso(d){
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("dialog", d => d.dismiss());                  // alert() must not block

  await page.goto("file://" + HTML + "?selftest=1", { waitUntil: "load" });
  await page.waitForFunction(() => window.__SELFTEST__ !== undefined);

  // ---------------------------------------------------------------- anchors
  console.log("\nWORKBOOK PARITY (embedded dataset)");
  const s0 = await page.evaluate(() => window.__SELFTEST__);
  check("CurrentEnd = MAX(Date) = 2026-08-13T02:22:10",
    s0.window.currentEnd.slice(0, 19) === "2026-08-13T02:22:10", s0.window.currentEnd);
  check("CurrentStart = CurrentEnd - 2h",
    s0.window.currentStart.slice(0, 19) === "2026-08-13T00:22:10", s0.window.currentStart);
  check("BaselineStart = CurrentStart - 7d",
    s0.window.baselineStart.slice(0, 19) === "2026-08-06T00:22:10", s0.window.baselineStart);
  check("Red vendors = 1", s0.kpis.redVendors === 1, "got " + s0.kpis.redVendors);
  check("Yellow vendors = 0", s0.kpis.yellowVendors === 0, "got " + s0.kpis.yellowVendors);
  check("Streak-active vendors = 8 (live only)", s0.kpis.streakActiveVendors === 8, "got " + s0.kpis.streakActiveVendors);
  check("Rule 2 alerts = 282 (live only)", s0.rule2Alerts === 282, "got " + s0.rule2Alerts);
  check("Rule 2 alerts = 293 across all monitored brands",
    s0.kpis.monitoredRule2Alerts === 293, "got " + s0.kpis.monitoredRule2Alerts);
  check("Analysed transactions = 19,762", s0.kpis.analysedTransactions === 19762, "got " + s0.kpis.analysedTransactions);

  const splunk = s0.signals.SPLUNK;
  check("SPLUNK current volume 8 / failures 5",
    splunk.currentVolume === 8 && splunk.currentFailures === 5,
    `${splunk.currentVolume}/${splunk.currentFailures}`);
  check("SPLUNK current rate 62.5%", Math.abs(splunk.currentRate - 0.625) < 1e-12, String(splunk.currentRate));
  check("SPLUNK baseline rate 54.386%", Math.abs(splunk.baselineRate - 0.543859649122807) < 1e-12, String(splunk.baselineRate));
  check("SPLUNK Red via critical spike at score 2",
    splunk.light === "RED" && splunk.signals.critical && !splunk.signals.spike && splunk.alertScore === 2,
    JSON.stringify(splunk.signals) + " score " + splunk.alertScore);

  // Red at a low alert score is the documented behaviour; make sure the page
  // explains it rather than implying Red requires a high score.
  const splunkMsg = await page.evaluate(() =>
    (STATE.vendors.find(v => v.vendorKey === "SPLUNK").primaryAlert || {}).message || "");
  check("SPLUNK explanation quotes rate, counts and baseline",
    /62\.5%/.test(splunkMsg) && /5 failures from 8 transactions/.test(splunkMsg)
      && /54\.4%/.test(splunkMsg) && /cluster/.test(splunkMsg), splunkMsg);

  // -------------------------------------------------------------- liveness
  console.log("\nVENDOR SCOPE (live since 1 Aug 2026)");
  const live = new Set(s0.scope.liveKeys);
  check("24 live of 51 monitored",
    s0.scope.liveCount === 24 && s0.scope.monitoredCount === 51,
    `${s0.scope.liveCount}/${s0.scope.monitoredCount}`);
  check("27 retired brands excluded from the default view", s0.scope.retiredCount === 27,
    "got " + s0.scope.retiredCount);
  check("fallback not triggered on this dataset", s0.scope.fellBack === false);
  const RETIRED = ["ARROW ECS UK", "ARROW ECS GERMANY", "ARROW ECS ITALY", "ARROW ECS AUSTRIA",
                   "ARROW ECS SWITZERLAND", "ARROW ECS SAS",
                   "HEWLETT PACKARD ENTREPRISE SERVICES DE SOUTIEN FIXES"];
  check("the 7 dormant Arrow ECS / HPE brands are all out of scope",
    RETIRED.every(k => !live.has(k)), RETIRED.filter(k => live.has(k)).join(", "));
  check("live brands still include the ones transacting today",
    ["SPLUNK", "FORTINET", "CHECKPOINT"].every(k => live.has(k)));
  const liveRowCount = await page.evaluate(() => document.querySelectorAll("#liveTable tbody tr").length);
  check("Live Monitor shows exactly the live brands", liveRowCount === 24, "got " + liveRowCount);

  // -------------------------------------------------------------- dormancy
  console.log("\nDECISIONS D1 / D2");
  // The liveness filter and D1 were solving overlapping problems: every vendor
  // D1 used to escalate was retired, so within the live scope it now fires on
  // nobody. It stays configured for a live brand that genuinely goes silent.
  const liveDormant = Object.entries(s0.activity).filter(([k, a]) => a.dormant && live.has(k));
  check("D1: no live brand is dormant (the 7 that were are all retired)",
    liveDormant.length === 0 && s0.kpis.dormantVendors === 0,
    liveDormant.map(([k]) => k).join(", "));
  check("D1: still escalates retired brands when scope is widened",
    Object.values(s0.activity).filter(a => a.dormant).length === 7);
  check("D1: quiet hours still suppress normal gaps",
    Object.entries(s0.activity).some(([k, a]) => live.has(k) && a.light === "GREY" && a.hourClass === "QUIET"));
  const fortinet = s0.activity.FORTINET;
  check("D2: WATCH vendor past its relaxed threshold reaches RED",
    fortinet.hourClass === "WATCH" && fortinet.light === "RED"
      && fortinet.minutesSinceLast > fortinet.dynamicThresholdMin,
    `${fortinet.hourClass}/${fortinet.light} ${fortinet.minutesSinceLast}>${fortinet.dynamicThresholdMin}`);
  check("activity lights within scope are 1 red / 0 yellow / 2 green / 20 grey",
    s0.kpis.activityRed === 1 && s0.kpis.activityYellow === 0
      && s0.kpis.activityGreen === 2 && s0.kpis.activityGrey === 20,
    `${s0.kpis.activityRed}/${s0.kpis.activityYellow}/${s0.kpis.activityGreen}/${s0.kpis.activityGrey}`);

  // ----------------------------------------------------------------- today
  console.log("\nTODAY PAGE");
  const td = s0.todayPage;
  check("today is the anchor's calendar day", td.dayKey === "2026-08-13", td.dayKey);
  check("39 transactions, 19 failures today",
    td.transactions === 39 && td.failures === 19, `${td.transactions}/${td.failures}`);
  check("failure rate today 48.7%", Math.abs(td.failureRate - 19 / 39) < 1e-12, String(td.failureRate));
  check("2 Rule 2 breaches today", td.rule2Alerts === 2, "got " + td.rule2Alerts);
  check("5 brands transacted today", td.activeVendors === 5, "got " + td.activeVendors);
  check("like-for-like prior slices are same-time-of-day, not full days",
    JSON.stringify(td.priorSlices) === JSON.stringify([0, 24, 0, 0, 18, 4, 14]),
    JSON.stringify(td.priorSlices));
  check("today's alert list is populated", td.alerts > 0, "got " + td.alerts);
  const alertCards = await page.evaluate(() => ({
    cards: document.querySelectorAll("#todayAlerts .alert-item").length,
    titles: [...document.querySelectorAll("#todayAlerts .title")].map(e => e.textContent)
  }));
  check("alerts are grouped one card per brand, not per signal",
    alertCards.cards === new Set(alertCards.titles).size && alertCards.cards < td.alerts,
    `${alertCards.cards} cards for ${td.alerts} alerts across ${new Set(alertCards.titles).size} brands`);
  const todayText = await page.evaluate(() => document.querySelector("#panel-today").textContent);
  check("Today page shows no all-time transaction total", !/19,762/.test(todayText));
  check("Today page states the like-for-like band", /typically/.test(todayText));

  // ------------------------------------------------------------ operations
  console.log("\nOPERATIONS FILTERS");
  await page.click('.tab[data-tab="operations"]');
  await page.waitForTimeout(200);
  const opsCounts = async () => page.evaluate(() => ({
    vendorRows: document.querySelectorAll("#opsVendorTable tbody tr").length,
    rule2Rows: document.querySelectorAll("#opsRule2Table tbody tr").length,
    kpiText: document.querySelector("#opsKpis").textContent,
    sub: document.querySelector("#opsSub").textContent,
    brandOptions: document.querySelectorAll("#opsVendor option").length
  }));

  const base = await opsCounts();
  check("all-time defaults to the 24 live brands",
    base.vendorRows === 24 && base.brandOptions === 25, // +1 for "All brands"
    `${base.vendorRows} rows, ${base.brandOptions} options`);
  check("all-time Rule 2 history is the live-scoped 282",
    base.rule2Rows === 282, "got " + base.rule2Rows);

  await page.selectOption("#opsRetired", []).catch(() => {});
  await page.check("#opsRetired");
  await page.waitForTimeout(200);
  const withRetired = await opsCounts();
  check("include-retired restores all 51 brands",
    withRetired.brandOptions === 52, "got " + withRetired.brandOptions);
  check("include-retired changes the vendor table",
    withRetired.vendorRows > base.vendorRows,
    `${base.vendorRows} -> ${withRetired.vendorRows}`);
  check("include-retired changes the Rule 2 history",
    withRetired.rule2Rows === 293, "got " + withRetired.rule2Rows);
  await page.uncheck("#opsRetired");
  await page.waitForTimeout(200);

  await page.selectOption("#opsVendor", "SPLUNK");
  await page.waitForTimeout(200);
  const oneBrand = await opsCounts();
  check("selecting one brand narrows every panel",
    oneBrand.vendorRows === 1 && oneBrand.rule2Rows < base.rule2Rows,
    `${oneBrand.vendorRows} rows, ${oneBrand.rule2Rows} breaches`);
  check("brand name appears in the period summary", /SPLUNK/.test(oneBrand.sub), oneBrand.sub);

  await page.selectOption("#opsVendor", "ALL");
  await page.selectOption("#opsPeriod", "7d");
  await page.waitForTimeout(200);
  const week = await opsCounts();
  check("period filter reduces the Rule 2 history",
    week.rule2Rows > 0 && week.rule2Rows < base.rule2Rows, "got " + week.rule2Rows);

  await page.selectOption("#opsGranularity", "week");
  await page.waitForTimeout(200);
  const weeklyPoints = await page.evaluate(() =>
    document.querySelectorAll("#opsChartVolume svg .hit").length);
  await page.selectOption("#opsGranularity", "month");
  await page.waitForTimeout(200);
  const monthlyPoints = await page.evaluate(() =>
    document.querySelectorAll("#opsChartVolume svg .hit").length);
  check("granularity changes the chart buckets",
    monthlyPoints > 0 && monthlyPoints <= weeklyPoints,
    `week=${weeklyPoints} month=${monthlyPoints}`);

  await page.click("#opsReset");
  await page.waitForTimeout(200);
  const reset = await opsCounts();
  check("reset restores the default view",
    reset.vendorRows === base.vendorRows && reset.rule2Rows === base.rule2Rows,
    `${reset.vendorRows}/${reset.rule2Rows}`);

  // ------------------------------------------------------------ escaping
  console.log("\nOUTPUT ESCAPING");
  const injected = await page.evaluate(() => document.body.innerHTML.includes("<script>alert"));
  check("no raw <script> from source data reaches the DOM", !injected);
  const htmlVendorRendered = await page.evaluate(() =>
    !!document.body.textContent.match(/VendorBacklog<html>/i) ||
    !document.querySelector('[data-vendor*="VENDORBACKLOG"]'));
  check("HTML-in-Vendor rows are excluded from monitoring", htmlVendorRendered);

  // -------------------------------------------------- recalculation proof
  console.log("\nRECALCULATION ON REPLACEMENT DATA");
  const rows = makeRows();
  const file = write("synthetic.csv", csv(rows));
  await page.setInputFiles("#fileInput", file);
  await page.waitForFunction(
    () => STATE && STATE.kpis.analysedTransactions === 240, { timeout: 15000 });
  const s1 = await page.evaluate(() => { window.__SELFTEST__ = selfTestPayload(); return window.__SELFTEST__; });

  check("transaction count follows the new file", s1.kpis.analysedTransactions === 240,
    "got " + s1.kpis.analysedTransactions);
  check("anchor moved to the new MAX(Date)", s1.window.currentEnd.startsWith("2027-01-23"),
    s1.window.currentEnd);
  check("vendor list replaced entirely",
    Object.keys(s1.registry).length === 1 && "ACME" in s1.registry,
    Object.keys(s1.registry).join(","));
  check("previous dataset leaves nothing behind",
    !("SPLUNK" in s1.signals) && s1.rule2Alerts !== s0.rule2Alerts);
  // The 1 Aug 2026 cutoff is fixed, so a 2027 dataset is entirely "live" —
  // this is the path that must not blank the dashboard.
  check("liveness recomputed against the new data",
    s1.scope.liveCount === 1 && s1.scope.fellBack === false,
    `${s1.scope.liveCount} live, fellBack=${s1.scope.fellBack}`);
  check("Today recomputed for the new anchor day",
    s1.todayPage.dayKey === "2027-01-23", s1.todayPage.dayKey);
  check("failure burst detected in the new data",
    s1.signals.ACME.currentFailures === 6 && s1.signals.ACME.light === "RED",
    JSON.stringify(s1.signals.ACME.signals));
  check("reason mapping recomputed for the new text",
    s1.categories.length === 1 && s1.categories[0].category === "Data mismatch",
    JSON.stringify(s1.categories.map(c => c.category)));
  const asOf = await page.textContent("#asOf");
  check("'Data as of' reflects the new anchor", /2027/.test(asOf), asOf);

  // ------------------------------------------------------------ edge cases
  console.log("\nEDGE CASES");
  const cases = [
    ["single row", csv([["Success", "SOLO", "N/A", "P1", "2027-03-01T10:00:00"]]), 1],
    ["single vendor, all failures", csv(Array.from({ length: 8 }, (_, i) =>
      ["Failure", "ONEV", "Abbyy cannot extract the PDF", "P" + i,
       iso(new Date(2027, 2, 1, 10, i * 3))])), 8],
    ["all successes", csv(Array.from({ length: 30 }, (_, i) =>
      ["Success", "HAPPY", "N/A", "P" + i, iso(new Date(2027, 2, 1, 10, i * 7))])), 30],
    ["mixed-case status", csv([["SUCCESS", "MC", "N/A", "P1", "2027-03-01T10:00:00"],
      ["failure", "MC", "N/A", "P2", "2027-03-01T10:05:00"]]), 2],
    ["reason containing commas, quotes and HTML", csv([
      ["Failure", "TRICKY", 'Error: a, b "quoted" <script>alert(1)</script> & more', "P1", "2027-03-01T10:00:00"],
      ["Success", "TRICKY", "N/A", "P2", "2027-03-01T10:05:00"]]), 2],
    ["unparseable dates are quarantined", csv([
      ["Success", "DQ", "N/A", "P1", "not-a-date"],
      ["Success", "DQ", "N/A", "P2", "2027-03-01T10:00:00"]]), 1],
    ["blank vendor is quarantined", csv([
      ["Failure", "", "orphan row", "P1", "2027-03-01T10:00:00"],
      ["Success", "DQ2", "N/A", "P2", "2027-03-01T10:00:00"]]), 1],
    ["semicolon-delimited file", "Status;Vendor;Reason;PO;Date\nSuccess;SEMI;N/A;P1;2027-03-01T10:00:00", 1],
    ["duplicate rows are preserved, not merged", csv(Array.from({ length: 6 }, () =>
      ["Failure", "DUP", "identical", "SAME-PO", "2027-03-01T10:00:00"])), 6]
  ];

  for(const [name, content, expected] of cases){
    errors.length = 0;
    const p = write(name.replace(/[^a-z0-9]+/gi, "-") + ".csv", content);
    await page.setInputFiles("#fileInput", p);
    await page.waitForFunction(n => STATE && STATE.kpis.analysedTransactions === n,
      expected, { timeout: 10000 }).catch(() => {});
    const got = await page.evaluate(() => STATE ? STATE.kpis.analysedTransactions : -1);
    check(name, got === expected && errors.length === 0,
      `analysed ${got}, expected ${expected}` + (errors.length ? "; errors: " + errors.join("; ") : ""));
  }

  // The liveness cutoff is a fixed date. A dataset that predates it must fall
  // back to showing everything with a warning, never an empty dashboard.
  console.log("\nLIVENESS FALLBACK (dataset entirely before the cutoff)");
  errors.length = 0;
  await page.setInputFiles("#fileInput", write("old.csv", csv(
    Array.from({ length: 40 }, (_, i) =>
      ["Success", "OLDCO", "N/A", "P" + i, iso(new Date(2025, 4, 6, 9, i * 4))]))));
  await page.waitForFunction(() => STATE && STATE.kpis.analysedTransactions === 40, { timeout: 10000 });
  const sOld = await page.evaluate(() => selfTestPayload());
  check("fallback engages rather than blanking the view",
    sOld.scope.fellBack === true && sOld.scope.liveCount === 1,
    `fellBack=${sOld.scope.fellBack} live=${sOld.scope.liveCount}`);
  const stripText = await page.evaluate(() => document.querySelector("#scopeStrip").textContent);
  check("fallback is stated in the header", /No brand has transacted since/.test(stripText), stripText.trim());
  const liveRowsOld = await page.evaluate(() => document.querySelectorAll("#liveTable tbody tr").length);
  check("brands still render under fallback", liveRowsOld >= 1, "got " + liveRowsOld);
  check("no exception during fallback", errors.length === 0, errors.join("; "));

  // XSS specifically: the tricky-reason case must render escaped, not execute.
  await page.setInputFiles("#fileInput", write("xss.csv", csv([
    ["Failure", "XSS", '<img src=x onerror="window.__PWNED__=1">', "P1", "2027-03-01T10:00:00"],
    ["Success", "XSS", "N/A", "P2", "2027-03-01T10:05:00"]])));
  await page.waitForFunction(() => STATE && STATE.kpis.analysedTransactions === 2, { timeout: 10000 });
  await page.click('.tab[data-tab="vendor"]');
  await page.waitForTimeout(200);
  const pwned = await page.evaluate(() => window.__PWNED__ === 1);
  check("injected markup in Reason is escaped, not executed", !pwned);

  // Empty and header-only files must not throw.
  errors.length = 0;
  await page.setInputFiles("#fileInput", write("headeronly.csv", "Status,Vendor,Reason,PO,Date"));
  await page.waitForTimeout(400);
  check("header-only file is handled without throwing", errors.length === 0, errors.join("; "));

  errors.length = 0;
  await page.setInputFiles("#fileInput", write("missingcol.csv", "Foo,Bar\n1,2"));
  await page.waitForTimeout(400);
  check("file with wrong columns is rejected without throwing", errors.length === 0, errors.join("; "));

  await browser.close();
  fs.rmSync(TMP, { recursive: true, force: true });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
