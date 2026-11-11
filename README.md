# Budget Pace v0.1

A zero-cost, local-first expense and budget tracker designed for phone and laptop use. Currency is set to CAD in v0.1.

## What this version does

- Monthly category budgets
- Planned and actual income
- Manual expense/income entry
- CSV transaction import
- Merchant-to-category rules
- Duplicate detection on import
- Month progress vs budget-spend progress
- Category pace tracking for Groceries, Gasoline, and Incidentals
- Linear month-end spending forecast
- Month-end close:
  - unused non-Incidentals budget is recorded as Savings
  - unused Incidentals budget rolls into the next month
- Full history CSV export
- Installable PWA when hosted over HTTPS
- Local-only storage using browser localStorage

## Important limitation

Data is stored separately in each browser/device. There is no synchronization in v0.1.

The storage layer is deliberately isolated behind `LocalStorageStore` in `app.js`.
A future `OneDriveStore` can implement the same `load()` / `save()` contract.

## Run it locally

The simplest laptop test:

1. Extract the folder.
2. Open a terminal in the folder.
3. Run:
   `python -m http.server 8000`
4. Browse to:
   `http://localhost:8000`

For installability on a phone, host these static files on any free HTTPS static host such as GitHub Pages.

## CSV import format

The easiest format is:

```csv
date,description,amount,type,category
2026-07-01,Superstore,120.45,expense,Groceries
2026-07-02,Salary,3200.00,income,
```

The importer also recognizes common columns including:

- Date / Transaction Date / Posted Date
- Description / Merchant / Payee / Details
- Amount
- Debit / Credit
- Type
- Category

If Category is blank, merchant rules are applied.

## Product rules implemented

### Pace

Pace is based on **days elapsed in the month**, not calendar weeks.

Example:
- 40% of the month has elapsed
- 55% of the grocery budget is spent
- Groceries are 15 percentage points over pace

### Savings

During the month, `Available now` shows unspent non-Incidentals category budget.

When you press `Close month`, that unused amount is recorded as a Savings transfer.

### Incidentals

Incidentals are intentionally different:
- unused Incidentals are not transferred to Savings
- they roll into the next month's Incidentals budget

## Future v0.2 candidates

1. OneDrive synchronization
2. Better CSV column-mapping wizard for different banks/cards
3. Editable category list
4. Transaction editing
5. Historical charts and budget recommendations
6. Multi-user household entry


## Version 0.2 additions

- Add custom expense categories from **Edit budget → Add category**
- Optional pace tracking for newly created categories
- Change an expense's category directly from the Transactions table
- Select **+ New category…** from a transaction to create and assign a category in one step
- New categories are persisted and included in future monthly budgets


## Version 0.3 additions

- Learns merchant/category rules from manual corrections
- When a transaction is recategorized:
  - if an existing merchant rule caused the old category, the app offers to update that rule
  - if no rule exists, the app offers an editable merchant-text rule for future imports
- Manual expense entry also learns when the chosen category differs from the automatic suggestion
- Cancelling the learning prompt keeps the change for the current transaction only


## Version 0.4 additions

- Category dropdown menus are alphabetically sorted, case-insensitively
- Transactions can be sorted by Date, Description, Category, or Amount
- Click the same column again to reverse the sort
- Default sort is Date descending (newest first)
- New Date and Amount sorts start descending; Description and Category start ascending


## Version 0.6 additions

- Edit transaction date, description, amount, type, and category.
- Search transactions by merchant/description.
- Filter transactions by category or type.
- Clear filters with one button.
- Delete transactions with confirmation.
- Export a full JSON backup containing transactions, budgets, categories, rules, income planning, month-close/carryover data, and settings.
- Restore a validated Budget Pace JSON backup.
- Existing CSV export remains available for transaction analysis.
- Existing browser data remains compatible because the localStorage key is unchanged.


## Version 0.6.1 import compatibility update

- Recognizes `Description 1`, `Description 2`, `CAD$`, and `USD$` bank-export columns.
- Combines Description 1 and Description 2 when both are present.
- Signed CAD$ values: negative = expense, positive = income.
- Adds a Transfer type excluded from expense and income totals.
- High-confidence internal transfers such as ONLINE TRANSFER TO/FROM DEPOSIT ACCOUNT and ONLINE BANKING TRANSFER are imported as transfers.
- USD-only rows are skipped instead of being treated as CAD.
- Ambiguous e-transfers and payments remain reviewable rather than being hidden automatically.


## Version 0.7 — Credit-card payments

- `CC PAYMENT` is no longer treated as an expense budget category.
- Credit-card payments are stored as **Transfer / CC Payment**.
- Transfers do not count as spending or income and therefore do not affect:
  - monthly budget usage
  - remaining budget
  - spending pace
  - forecast
  - savings calculations
- Existing transactions categorized as `CC PAYMENT` are migrated automatically.
- Existing `CC PAYMENT` budget categories are removed automatically.
- Common descriptions such as `CC PAYMENT`, `CREDIT CARD PAYMENT`, `VISA PAYMENT`, and `MASTERCARD PAYMENT` are automatically recognized as transfers.
- Existing or restored merchant rules that represented credit-card payments are converted to transfer rules.
- Credit-card payments remain visible in the Transactions table and can be filtered using Type = Transfer or label = CC Payment.
- Generic internal transfers remain labeled `Transfer`.

The app intentionally does not match both sides of a transfer yet. Matching becomes useful only if account-balance reconciliation is added later.

- Added an **Add transfer** button for manual transfer entry.
- Manually entered descriptions recognized as credit-card payments are automatically stored as `Transfer / CC Payment`.


## Version 0.8 additions — Excel export

The Transactions section now includes **Export Excel**.

The generated `.xlsx` workbook is a real Excel Open XML file and is created
entirely in the browser without a server, subscription, external library, or
internet connection.

The workbook contains:

1. **Summary** — selected month's main KPIs
2. **Monthly Summary** — month-by-month income, budget, spending and savings
3. **Transactions** — complete transaction history, including transfers
4. **Budget Detail** — budget vs actual by month and category
5. **Categories** — category configuration and pace-tracking settings
6. **Merchant Rules** — automatic categorization / transfer rules

Credit-card payments and other transfers remain visible in the Transactions
sheet but are excluded from expense and income calculations.


## Version 0.9 additions — Month selection and month snapshot files

### Month navigation

The selected working month is now more explicit:

- month calendar/picker
- Previous month button
- Next month button
- Current month button

Changing the selected month updates the dashboard, category balances, income and
transactions for that month.

### Save Month CSV

`Save month CSV` creates a Budget Pace month snapshot such as:

`BudgetPace-2026-11-snapshot.csv`

It can be saved at any point during a month and regenerated later as spending
changes. The snapshot contains:

- month summary and save timestamp
- planned and actual income
- total budget, spending and remaining balance
- category budgets, actual spending and remaining balances
- category pace-tracking settings
- savings transferred
- Incidentals carryover
- month-close status
- all transactions for the selected month, including transfers

### Load Month CSV

`Load month CSV` reads only Budget Pace month-snapshot CSV files. Loading one:

- replaces that month's budget and transactions
- restores planned income and month-close information
- adds historical categories if needed
- leaves every other month untouched
- switches the app to the loaded month for review

The app validates the file structure and compares the saved spending total with
the spending recomputed from its transactions.

This monthly snapshot is distinct from:

- **Export CSV** — complete transaction history only
- **Export Excel** — analytical workbook
- **Export backup** — full application backup for disaster recovery


## Version 0.9.1 additions — Bank CSV import format

The importer now explicitly supports CSV files with these headers:

- Account Type
- Account Number
- Transaction Date
- Cheque Number
- Description 1
- Description 2
- CAD$
- USD$

Import rules:

- `Description 1` and `Description 2` are merged using `--`
  - example: `PAYEE--REFERENCE`
- blank description parts are omitted cleanly
- `CAD$` is used as the transaction amount
- negative CAD amounts are treated as expenses
- positive CAD amounts are treated as income
- existing transfer/credit-card-payment detection still overrides expense/income classification
- USD-only rows are skipped rather than being incorrectly treated as CAD
- duplicate detection remains active
- account type, account number and cheque number are retained as source metadata for future use


## Version 0.9.2 additions — Headerless bank CSV import

The importer now also supports CSV files with **no header row** when columns appear
in this exact order:

1. Date
2. Transaction Description
3. Debit
4. Credit
5. Balance
6. Optional trailing blank column

Import behavior:

- Debit values are imported as expenses
- Credit values are imported as income
- Existing transfer / credit-card-payment detection still overrides the type
- Balance is retained as source metadata but is not used in budget calculations
- Duplicate detection remains active
- The importer auto-detects this format when the first row begins with a date
- The existing headered bank formats remain supported


## Version 0.9.3 — Laptop cache fix and headerless CSV hardening

- Laptop build no longer uses the Budget Pace service worker cache.
- Old Budget Pace service-worker registrations and caches are removed on load.
- `app.js` and `styles.css` use versioned URLs to force fresh code.
- A visible `v0.9.3` badge appears beside the Budget Pace title.
- Headerless CSV detection explicitly supports:
  `Date, Transaction Description, Debit, Credit, Balance`
- MM/DD/YYYY dates are explicitly converted to YYYY-MM-DD.

The supplied test file format:
`11/04/2026,ROYAL BANK OF CANADA,,852.00,-0.88`
is recognized as:
- Date: 2026-11-04
- Description: ROYAL BANK OF CANADA
- Credit: 852.00
- Balance: -0.88


# Version 1.0 — OneDrive authoritative synchronization

Budget Pace v1.0 introduces:

- OneDrive authoritative `budget-data.json`
- browser localStorage offline/fast cache
- OAuth 2.0 authorization-code flow with PKCE
- no client secret
- personal OneDrive least-privilege `Files.ReadWrite.AppFolder`
- optional work/school OneDrive mode
- automatic debounced sync after local changes
- offline mode and automatic reconnect sync
- visible sync state and last-sync timestamp
- manual **Sync now**
- revision/timestamp-based conflict detection
- transaction/category/rule merge behavior for multi-device conflicts
- PWA support for the same HMI on phone
- service worker enabled only for HTTPS production hosting, not localhost development

See `ONEDRIVE_SETUP.md` before first sign-in.


## v1.0 sync integration hardening

- Restoring a full backup marks the local dataset unsynced and uploads it.
- Loading a monthly snapshot marks the local dataset unsynced and uploads it.
- Monthly snapshot status metadata participates in synchronization.
- Startup data migrations are marked for cloud synchronization.
- Multi-device transaction merge uses the same practical transaction fingerprint
  concept as CSV duplicate detection, reducing duplicate transactions when the same
  bank transaction was independently imported on two devices.


# Version 1.0.1 — Security hardening

- App Folder-only is now the preferred mode for personal and work/school accounts.
- Existing v1.0 work mode is migrated to App Folder-only and requires a fresh sign-in.
- A broader `Files.ReadWrite` work fallback remains available only with explicit acknowledgement.
- The OneDrive panel displays the current permission scope.
- Added Content Security Policy, no-referrer policy, and disabled camera/microphone/geolocation.
- See `SECURITY.md`.
