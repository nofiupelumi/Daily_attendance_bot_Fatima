# Automation bots for Portal4Security

This folder contains a small Playwright bot and GitHub Actions workflows to automate:
- Login at 08:00 Africa/Lagos on Mon/Tue/Wed/Fri
- Logout at 18:00 Africa/Lagos on Mon/Tue/Wed/Fri (posts a Daily Log first)
- Manually add a Daily Activity Log (on-demand workflow)

All actions target the live site at https://portal4security.com. No credentials are stored in the repo; add them as GitHub Secrets.

## Secrets to add (Repository → Settings → Secrets and variables → Actions)
- P4S_EMAIL: Your login email
- P4S_PASSWORD: Your login password
- (Optional) P4S_BASE_URL: Defaults to https://portal4security.com
- (Optional for daily log) DAILY_LOG_TIME in HH:MM (Africa/Lagos), DAILY_LOG_ACTIVITY, DAILY_LOG_COMMENT, DAILY_LOG_REPORT, OFFICER_NAME

## Local run (optional)
You can run the bot locally for testing without committing secrets:

1) From repo root, install deps under automation folder:

```
cd automation/p4s-bot
npm ci || npm install
npx playwright install --with-deps
```

2) Create `.env` from example and fill credentials:

```
cp .env.example .env
# edit .env to set P4S_EMAIL, P4S_PASSWORD, etc.
```

3) Run the bot:

```
node bot.js --action login
node bot.js --action daily-log
node bot.js --action logout
```

Note: Default comment is "AI update & Code improvement". Report is random from a predefined list unless DAILY_LOG_REPORT is provided.
