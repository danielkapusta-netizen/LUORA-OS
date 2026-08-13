/**
 * Load rpa-monitor.html in a real browser and dump the computed state to JSON.
 *
 * This is the only honest way to validate the dashboard: the engines run in the
 * page, against the embedded payload, exactly as they will for a user. Any
 * console error or thrown exception fails the run.
 *
 *   node tools/run_selftest.js [html] [out]
 */
const { chromium } = require("/opt/node22/lib/node_modules/playwright");
const path = require("path");
const fs = require("fs");

(async () => {
  const html = path.resolve(process.argv[2] || "rpa-monitor.html");
  const out = path.resolve(process.argv[3] || "data/selftest.json");

  const browser = await chromium.launch();
  const page = await browser.newPage();

  const problems = [];
  page.on("console", m => { if (m.type() === "error") problems.push("console: " + m.text()); });
  page.on("pageerror", e => problems.push("pageerror: " + e.message));

  await page.goto("file://" + html + "?selftest=1", { waitUntil: "load" });
  await page.waitForFunction(() => window.__SELFTEST__ !== undefined, { timeout: 30000 });

  const state = await page.evaluate(() => window.__SELFTEST__);

  // Every tab must render without throwing — a chart or table that only breaks
  // on click is still broken.
  const tabs = ["overview", "live", "failure", "activity", "reason", "vendor"];
  for (const t of tabs) {
    await page.click(`.tab[data-tab="${t}"]`);
    await page.waitForTimeout(120);
  }
  await page.click("#btnQuality");
  await page.waitForTimeout(120);
  await page.click("#btnQualityClose");

  const counts = await page.evaluate(() => ({
    kpiCards: document.querySelectorAll("#kpiRow .kpi").length,
    liveRows: document.querySelectorAll("#liveTable tbody tr").length,
    signalRows: document.querySelectorAll("#signalTable tbody tr").length,
    activityRows: document.querySelectorAll("#activityTable tbody tr").length,
    categoryRows: document.querySelectorAll("#categoryTable tbody tr").length,
    unmappedRows: document.querySelectorAll("#unmappedTable tbody tr").length,
    rule2Rows: document.querySelectorAll("#rule2Table tbody tr").length,
    charts: document.querySelectorAll("svg.chart").length,
    asOf: document.querySelector("#asOf").textContent,
    freshness: document.querySelector("#freshText").textContent
  }));

  await browser.close();

  fs.writeFileSync(out, JSON.stringify(state, null, 1));
  console.log("wrote " + out);
  console.log("rendered:", JSON.stringify(counts, null, 1));
  if (problems.length) {
    console.error("\nPAGE PROBLEMS:\n" + problems.join("\n"));
    process.exit(1);
  }
  console.log("\nno console errors, no exceptions");
})();
