# Automation bots for Portal4Security

This folder contains a small Playwright bot and GitHub Actions workflows to automate:
- Login at 08:00 Africa/Lagos on Mon/Tue/Wed/Fri
- Logout at 18:00 Africa/Lagos on Mon/Tue/Wed/Fri
- Manually add a Daily Activity Log (on-demand workflow)

All actions target the live site at https://portal4security.com. No credentials are stored in the repo; add them as GitHub Secrets.

## Secrets to add (Repository → Settings → Secrets and variables → Actions)
- P4S_EMAIL: Your login email
- P4S_PASSWORD: Your login password
- (Optional) P4S_BASE_URL: Defaults to https://portal4security.com
- (Optional for daily log) DAILY_LOG_TIME in HH:MM (24h) Lagos time, DAILY_LOG_ACTIVITY, DAILY_LOG_COMMENT, DAILY_LOG_REPORT, OFFICER_NAME

## How it works
- Playwright launches a headless Chromium, signs in via `/login`, and optionally posts the Daily Activity form at `/daily-activity-log`.
- Logout navigates to `/logout` (AuthController::__invoke) after signing in during that job.
- Schedules use UTC under the hood: 07:00 UTC (08:00 Lagos) and 17:00 UTC (18:00 Lagos) on Mon/Tue/Wed/Fri.

## Local run (optional)
You can run the bot locally for testing:

1) From repo root, install deps under automation folder:

```
cd automation/p4s-bot
npm ci
npx playwright install --with-deps
```

2) Run the bot (replace envs):

```
P4S_EMAIL=you@example.com P4S_PASSWORD=secret node bot.js --action login
P4S_EMAIL=you@example.com P4S_PASSWORD=secret node bot.js --action logout
P4S_EMAIL=you@example.com P4S_PASSWORD=secret DAILY_LOG_REPORT="My report" node bot.js --action daily-log
```

Note: Don’t commit secrets. Use env vars or a .env file excluded by .gitignore.
