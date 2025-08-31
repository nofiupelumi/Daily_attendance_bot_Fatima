#!/usr/bin/env node
import { Command } from 'commander';
import { chromium } from 'playwright';
import dotenv from 'dotenv';

dotenv.config();

const program = new Command();
program
  .option('--action <action>', 'Action to run: login | logout | daily-log | dry-run', 'dry-run')
  .parse(process.argv);

const opts = program.opts();

const BASE_URL = process.env.P4S_BASE_URL || 'https://portal4security.com';
const EMAIL = process.env.P4S_EMAIL;
const PASSWORD = process.env.P4S_PASSWORD;

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
  'Laravel LMS development continues',
  'Scrapers Libraries updated',
  'Automation update for TAT',
  'Model fine tuning',
  'General development update',
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
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    switch (opts.action) {
      case 'login':
        await login(page);
        break;
      case 'logout':
        await login(page);
        await logout(page);
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
