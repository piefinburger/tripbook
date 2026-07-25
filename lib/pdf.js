import puppeteer from "puppeteer-core";
import { q } from "./db";
import { putObject } from "./s3";
import { sign } from "./auth";

// Renders /book/render/{exportId} to a print PDF and uploads to S3.
// Runs in-process; book_exports.status makes failures visible and re-runnable.

// Concurrency guard: only one Chrome instance at a time on the 2 GB Lightsail
// instance. Simultaneous renders would OOM the box.
let renderLock = false;

export async function renderExportPdf(exportId) {
  if (renderLock) {
    await q("UPDATE book_exports SET status='error', error=$1 WHERE id=$2",
      ["Another export is already rendering. Please try again in a minute.", exportId]);
    return;
  }
  renderLock = true;
  await q("UPDATE book_exports SET status='rendering', error=NULL WHERE id=$1", [exportId]);
  let browser;
  try {
    // One-time internal token so the render page can be fetched by headless
    // Chromium without a user session cookie.
    const renderToken = sign({ render: exportId, exp: Date.now() + 10 * 60e3 });
    browser = await puppeteer.launch({
      executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--force-color-profile=srgb",
        // Reduce memory footprint on the 2 GB Lightsail instance
        "--disable-gpu",
        "--disable-extensions",
        "--disable-background-networking",
        "--disable-default-apps",
        "--no-first-run",
        "--disable-sync",
      ]
    });
    const page = await browser.newPage();
    // Cover both navigation and non-navigation ops (page.pdf has its own 30s default)
    page.setDefaultNavigationTimeout(300000);
    page.setDefaultTimeout(300000);
    await page.goto(
      `http://localhost:3000/book/render/${exportId}?t=${encodeURIComponent(renderToken)}`,
      // networkidle2 (≤2 open connections) instead of networkidle0 so S3
      // presigned-URL redirects don't keep the idle counter above zero forever.
      { waitUntil: "networkidle2", timeout: 300000 });
    // 8.5in square book at 300 DPI equivalent (CSS in the render page sets page size)
    const pdf = await page.pdf({
      width: "8.5in", height: "8.5in", printBackground: true,
      margin: { top: 0, bottom: 0, left: 0, right: 0 },
      timeout: 300000,
    });
    const [ex] = await q("SELECT trip_id FROM book_exports WHERE id=$1", [exportId]);
    const key = `exports/${ex.trip_id}/tripbook-${exportId}.pdf`;
    await putObject(key, pdf, "application/pdf");
    await q("UPDATE book_exports SET status='done', pdf_s3_key=$1 WHERE id=$2", [key, exportId]);
  } catch (e) {
    await q("UPDATE book_exports SET status='error', error=$1 WHERE id=$2",
      [String(e.message || e).slice(0, 2000), exportId]);
  } finally {
    renderLock = false;
    if (browser) await browser.close().catch(() => {});
  }
}
