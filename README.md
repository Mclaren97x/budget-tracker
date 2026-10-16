# Budget Tracker

A Windows desktop budgeting app. Track income and expenses by category, set budgets as percentages of your income, and see how each category changes month to month.

## Install

1. Go to the [latest release](https://github.com/Mclaren97x/budget-tracker/releases/latest).
2. Download `Budget-Tracker-Setup-x.y.z.exe` and run it.
3. Windows SmartScreen may warn because the app isn't code-signed: click **More info → Run anyway**.

After that, the app updates itself. It checks GitHub on launch and every 4 hours, downloads new versions in the background, and asks you to restart.

## Your data

Your data is stored at `%APPDATA%\BudgetTracker\budget-data.json`, outside the app's install folder, so installing updates (or reinstalling) never touches it. The app also keeps a daily backup in `%APPDATA%\BudgetTracker\backups` (the last 30 days). Under **Settings** you can export a backup or restore from one.

## Features

- **Transactions**: add, edit, and delete income and expenses, filter by month or category, search notes, and export to CSV.
- **Categories & Budgets**: give each expense category a percentage. Its budget is that percentage of your income, either the actual income you record each month or a fixed monthly amount you set in Settings. A live indicator shows how much of 100% you've allocated.
- **Dashboard**: income, expenses, net, and savings rate for the month, plus each category's budget, spending, remaining amount, % used, and change from last month.
- **Trends**: a line chart and table of spending per category over the last 6, 12, or 24 months, with the change from each month to the next.

## Development

```bash
npm install
npm start          # run the app locally
npm run dist       # build the installer into dist/ (no publish)
```

### Releasing an update

```bash
npm run release    # bumps the patch version (1.0.0 → 1.0.1), tags it, and pushes
```

Pushing the tag triggers the GitHub Actions workflow, which builds the installer and publishes it as a GitHub Release. Installed copies pick it up automatically.

If you ever change the shape of the saved data, increase `SCHEMA_VERSION` in `src/app.js` and add a step to `migrate()` so existing data gets upgraded rather than reset.
