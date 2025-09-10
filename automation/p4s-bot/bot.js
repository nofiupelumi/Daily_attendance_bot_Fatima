#!/usr/bin/env node
import { Command } from 'commander';
import { chromium } from 'playwright';
import dotenv from 'dotenv';

dotenv.config();

const program = new Command();
program
  .option('--action <action>', 'Action to run: login | logout | daily-log | clock-in | clock-out | dry-run', 'dry-run')
  .parse(process.argv);

const opts = program.opts();

const BASE_URL = process.env.P4S_BASE_URL || 'https://portal4security.com';
const EMAIL = process.env.P4S_EMAIL;
const PASSWORD = process.env.P4S_PASSWORD;
const LAT = parseFloat(process.env.P4S_LAT || '6.5244'); // Lagos
const LON = parseFloat(process.env.P4S_LON || '3.3792');
const DESKTOP_UA = process.env.P4S_UA ||
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

// Helpers
function lagosTimeHM() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Lagos',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const hh = parts.find(p => p.type === 'hour')?.value || '00';
  const mm = parts.find(p => p.type === 'minute')?.value || '00';
  return `${hh}:${mm}`;
}

// Daily log defaults and inputs
const DAILY_LOG_CHOICES = [
  'Meeting and Laravel LMS Course development',
  'NRI website review',
  'sevearal meetings and Formatting of proposal document',
  'Following up with Lms pending task with NRI',
  'Several Meeting and General development update',
];

const DAILY_LOG_TIME = process.env.DAILY_LOG_TIME || lagosTimeHM();
const DAILY_LOG_ACTIVITY = process.env.DAILY_LOG_ACTIVITY || 'Routine duties';
const DAILY_LOG_COMMENT = process.env.DAILY_LOG_COMMENT || 'AI update & Code improvement';
const DAILY_LOG_REPORT = process.env.DAILY_LOG_REPORT || DAILY_LOG_CHOICES[Math.floor(Math.random() * DAILY_LOG_CHOICES.length)];
const OFFICER_NAME = process.env.OFFICER_NAME || '';

function assertEnv() {
  if (!EMAIL || !PASSWORD) {
    throw new Error('Missing P4S_EMAIL or P4S_PASSWORD env vars');
  }
}

async function login(page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('#email', EMAIL);
  await page.fill('#password', PASSWORD);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }),
    page.click('button[type="submit"]')
  ]);

  // Accept multiple valid post-login destinations
  const url = page.url();
  const ok = [
    `${BASE_URL}/welcome`,
    `${BASE_URL}/add-facility`,
    BASE_URL + '/',
  ].some(prefix => url === prefix || url.startsWith(prefix));

  if (!ok) {
    const err = await page.locator('.alert.alert-danger, .invalid-feedback').first().textContent().catch(() => '');
    throw new Error(`Login may have failed. Current URL: ${url} ${err ? `| Error: ${err}` : ''}`);
  }
}

async function logout(page) {
  // App defines GET or POST /logout via AuthController::__invoke
  await page.goto(`${BASE_URL}/logout`, { waitUntil: 'networkidle' });
}

async function submitAttendanceForm(page) {
  // Ensure hidden lat/long are set (not required by validation, but good to include)
  await page.evaluate(({ lat, lon }) => {
    const latEl = document.getElementById('lat'); if (latEl) latEl.value = String(lat);
    const lonEl = document.getElementById('long'); if (lonEl) lonEl.value = String(lon);
  }, { lat: LAT, lon: LON });

  // Try up to 3 times to align the HH:MM with the server-rendered readonly input
  for (let i = 0; i < 3; i++) {
  const val = await page.inputValue('#time').catch(() => '');
  const expected = lagosTimeHM();
  console.log(`[clock] Attempt ${i+1} | form #time=${val} | lagos now=${expected}`);
    if (val === expected) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle' }),
        (async () => {
          const btn = page.locator('form#locationForm button[type="submit"]');
          await btn.scrollIntoViewIfNeeded().catch(() => {});
          await btn.click();
        })()
      ]);
      return;
    }
    // Refresh to get a fresh readonly time value
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('form#locationForm', { timeout: 5000 }).catch(() => {});
  }

  // Fallback: remove readonly and set to current Lagos time, then submit
  await page.evaluate(() => {
    const t = document.getElementById('time');
    if (t) t.removeAttribute('readonly');
  });
  await page.fill('#time', lagosTimeHM());
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }),
    (async () => {
      const btn = page.locator('form#locationForm button[type="submit"]');
      await btn.scrollIntoViewIfNeeded().catch(() => {});
      await btn.click();
    })()
  ]);
}

async function clockIn(page) {
  await page.goto(`${BASE_URL}/clock-in`, { waitUntil: 'domcontentloaded' });
  // If already marked, there will be no form
  const hasForm = await page.$('form#locationForm');
  if (!hasForm) {
    return; // Nothing to do
  }
  await submitAttendanceForm(page);

  // Verify success
  const ok = await page.locator('.alert.alert-success').first().textContent().catch(() => '');
  if (!ok || !/Attendance marked successfully/i.test(ok)) {
    const errText = await page.locator('.alert.alert-danger, .invalid-feedback').allTextContents().catch(() => []);
    if (errText.length) throw new Error(`Clock-in may have failed: ${errText.join(' | ')}`);
  }
}

async function clockOut(page) {
  await page.goto(`${BASE_URL}/clock-out`, { waitUntil: 'domcontentloaded' });
  // If message says "You have not clocked in today", just exit gracefully
  const noEntry = await page.getByText('You have not clocked in today', { exact: false }).first().isVisible().catch(() => false);
  if (noEntry) return;

  const hasForm = await page.$('form#locationForm');
  if (!hasForm) return;

  await submitAttendanceForm(page);

  // Verify success
  const ok = await page.locator('.alert.alert-success').first().textContent().catch(() => '');
  if (!ok || !/You have clocked out successfully/i.test(ok)) {
    const errText = await page.locator('.alert.alert-danger, .invalid-feedback').allTextContents().catch(() => []);
    if (errText.length) throw new Error(`Clock-out may have failed: ${errText.join(' | ')}`);
  }
}

async function addDailyLog(page) {
  await page.goto(`${BASE_URL}/daily-activity-log`, { waitUntil: 'domcontentloaded' });

  // In case TinyMCE is used, we still can set the underlying textarea value.
  await page.fill('input#time', DAILY_LOG_TIME);

  // Officer name
  const officerNameSelector = 'input#officername';
  if (await page.$(officerNameSelector)) {
    const currentVal = await page.inputValue(officerNameSelector).catch(() => '');
    await page.fill(officerNameSelector, OFFICER_NAME || currentVal || '');
  }

  // Activity may be hidden based on company id, fill only if present
  if (await page.$('input#activity')) {
    await page.fill('input#activity', DAILY_LOG_ACTIVITY);
  }

  await page.fill('input#comment', DAILY_LOG_COMMENT);

  // If TinyMCE is present, set content via its API, else fill textarea
  const reportSelector = 'textarea#report';
  if (await page.$('iframe.tox-edit-area__iframe')) {
    const frame = await (await page.$('iframe.tox-edit-area__iframe')).contentFrame();
    await frame.evaluate((html) => {
      document.body.innerHTML = html;
    }, DAILY_LOG_REPORT.replace(/\n/g, '<br/>'));
  } else if (await page.$(reportSelector)) {
    await page.fill(reportSelector, DAILY_LOG_REPORT);
  }

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }),
    page.click('button[type="submit"]')
  ]);

  // Verify success alert appears
  const successText = await page.locator('.alert.alert-success').first().textContent().catch(() => '');
  if (!successText || !/added a daily log successfully/i.test(successText)) {
    // Best effort: ensure we’re still on the form page without validation errors
    const errText = await page.locator('.invalid-feedback, .alert.alert-danger').allTextContents().catch(() => []);
    if (errText.length) {
      throw new Error(`Daily log might have failed: ${errText.join(' | ')}`);
    }
  }
}

(async () => {
  if (opts.action !== 'dry-run') assertEnv();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    geolocation: { latitude: LAT, longitude: LON },
    locale: 'en-GB',
    userAgent: DESKTOP_UA,
    viewport: { width: 1366, height: 768 },
  });
  // Allow geolocation for our origin
  await context.grantPermissions(['geolocation'], { origin: BASE_URL });
  const page = await context.newPage();
  // Auto-accept confirm/alert prompts (used by clock-in/out pages)
  page.on('dialog', async (dialog) => {
    try { await dialog.accept(); } catch {}
  });

  try {
    switch (opts.action) {
      case 'login':
        await login(page);
        break;
      case 'logout':
        await login(page);
        await logout(page);
        break;
      case 'clock-in':
        await login(page);
        await clockIn(page);
        break;
      case 'clock-out':
        await login(page);
        await clockOut(page);
        break;
      case 'daily-log':
        await login(page);
        await addDailyLog(page);
        break;
      case 'dry-run':
        console.log('Dry run OK');
        break;
      default:
        throw new Error(`Unknown action: ${opts.action}`);
    }
    console.log(`Action ${opts.action} completed.`);
    await browser.close();
    process.exit(0);
  } catch (err) {
    console.error(`[ERROR] ${err.message}`);
    await page.screenshot({ path: `automation_error_${Date.now()}.png`, fullPage: true }).catch(() => {});
    await browser.close();
    process.exit(1);
  }
})();
