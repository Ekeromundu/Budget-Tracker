# Pocket Ledger

A monthly budget tracker you install on your iPhone from Safari. It reads bank statements (CSV or PDF) on the phone itself, sorts transactions into categories, and compares spending against monthly budgets. No server, no account, no fees.

## What it does

- **Import statements**: CSV (column layout auto-detected, adjustable) or PDF (including password-protected statements).
- **Duplicate protection**: transactions already imported are detected and unticked, so overlapping statements are safe.
- **Auto-categorising**: keyword rules (e.g. `SHOPRITE` → Groceries). When you fix a category, the app offers to save it as a rule.
- **Monthly overview**: money in, money out, net, and spend vs budget per category.
- **Manual entry** for cash spending.
- **Backup / restore** to a JSON file (share sheet → Save to Files).

All data lives in the browser's storage on your phone. Nothing is uploaded anywhere.

## Put it on your iPhone (free, with GitHub Pages)

1. Create a free GitHub account and a new **public** repository, e.g. `pocket-ledger`.
2. Upload every file in this folder, keeping the `icons/` and `vendor/` folders.
3. In the repository: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, choose `main` and `/ (root)`, then Save.
4. After about a minute, the site is live at `https://<your-username>.github.io/pocket-ledger/`.
5. Open that link in **Safari** on your iPhone, tap **Share → Add to Home Screen**.

The app now opens full-screen from its icon and works offline.

> Netlify Drop (app.netlify.com/drop) works too: drag the folder onto the page.

## Try it on your computer first

```bash
cd pocket-ledger
python -m http.server 8000
```

Then open http://localhost:8000.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page shell and tab bar |
| `app.js` | Views, import flow, budgets, rules, backup |
| `parser.js` | CSV / PDF statement parsing (no DOM, testable in Node) |
| `styles.css` | Light and dark theme |
| `sw.js` | Offline caching |
| `manifest.webmanifest`, `icons/` | Home Screen install |
| `vendor/` | PDF reader (pdf.js 3.11.174, Apache 2.0) |

## Tuning for your bank's statement

Statement layouts differ. If a PDF import misses transactions, open **Show text read from the PDF** on the import screen. The parser expects each transaction line to start with a date, followed by the description, the amount, and the running balance. Adjust `parseStatementLines` in `parser.js` to match your layout.

## Updating the app

After changing files, bump `CACHE` in `sw.js` (e.g. `pocket-ledger-v2`) and upload again. The phone picks up the new version the next time it opens the app online.

## Notes

- Clearing Safari's website data erases the app's data, so export a backup first.
- Transfers are excluded from the monthly totals so moving money between your own accounts isn't counted as spending.
