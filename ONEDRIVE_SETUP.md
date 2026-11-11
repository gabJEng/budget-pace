# Budget Pace v1.0 — OneDrive Sync Setup

## Architecture

OneDrive is the authoritative copy.

- OneDrive: `Apps/Budget Pace/budget-data.json`
- Browser `localStorage`: fast/offline working copy
- Budget Pace HMI: reads local data immediately and synchronizes to OneDrive when online

The app uses Microsoft OAuth 2.0 authorization-code flow with PKCE.
There is no client secret in Budget Pace.

---

## Before switching from the old 127.0.0.1 test site

Your old data is associated with the browser origin `http://127.0.0.1:8001`.

Microsoft's normal SPA configuration is simpler with `http://localhost:8001/`.

If you need to preserve the old test data:

1. Open the old Budget Pace site at `http://127.0.0.1:8001`.
2. Click **Export backup** and save the JSON file.
3. Replace the app files with this v1.0 package.
4. Start with `START_SYNC.bat`.
5. Open `http://localhost:8001/`.
6. Use **Restore backup** to load your old data.
7. Then configure OneDrive and perform the first sync.

This is a one-time migration because `localhost` and `127.0.0.1` have separate browser storage.

---

## Step 1 — Register Budget Pace with Microsoft

Go to the Microsoft Entra admin center and create an App registration.

Recommended name:

`Budget Pace`

For a personal OneDrive account, select a supported account type that includes
**Personal Microsoft accounts**. If you only intend to use your personal account,
"Personal Microsoft accounts only" is the narrowest choice.

Copy the **Application (client) ID** after registration.

### Authentication platform

Under **Authentication**:

1. Add a platform.
2. Choose **Single-page application (SPA)**.
3. Add this development redirect URI exactly:

`http://localhost:8001/`

Later, when the app is hosted for your phone, add the exact HTTPS GitHub Pages address too, for example:

`https://YOUR-USERNAME.github.io/budget-pace/`

Do not create or use a client secret. A browser SPA cannot safely keep one.

---

## Step 2 — Add Microsoft Graph permission

### Personal OneDrive — recommended

Add Microsoft Graph **Delegated** permission:

`Files.ReadWrite.AppFolder`

This gives Budget Pace access to its own OneDrive App Folder rather than your entire OneDrive.

### Work/school OneDrive

Choose the "Work or school OneDrive" option in Budget Pace setup and add delegated:

`Files.ReadWrite`

This is broader. Organizational consent policy may require an administrator to approve it.

---

## Step 3 — Configure Budget Pace

1. Run `START_SYNC.bat`.
2. Open `http://localhost:8001/`.
3. In **OneDrive sync**, click **Configure**.
4. Paste the Application (client) ID.
5. Select the OneDrive account type.
6. Verify that the displayed redirect URI is exactly the one registered in Entra.
7. Save configuration.
8. Click **Sign in to OneDrive**.
9. Consent to the requested OneDrive permission.
10. After returning to Budget Pace, click **Sync now** if it does not sync automatically.

On the first successful save, OneDrive creates:

`Apps/Budget Pace/budget-data.json`

The exact app-folder name comes from the application name in Microsoft Entra.

---

## How synchronization works

### Local edits

Every change:

1. saves immediately to browser localStorage;
2. marks the local copy as unsynced;
3. automatically attempts OneDrive sync after a short delay.

If offline, the local data remains usable and sync resumes when the browser comes online.

### App startup

Budget Pace:

1. loads localStorage immediately;
2. shows the HMI without waiting for OneDrive;
3. checks OneDrive when authenticated and online;
4. downloads a newer cloud copy or uploads local changes as needed.

### Conflict handling

Every OneDrive dataset contains a revision number and modified timestamp.

If the laptop and phone both change between syncs:

- transactions are merged by unique transaction ID;
- categories and merchant rules are merged by logical key;
- monthly budget/settings conflicts use the more recently modified side as the base;
- the merged result is written back as a new OneDrive revision;
- the UI reports **Conflict merged**.

This is intentionally optimized for one user operating multiple devices.

---

## Authentication/session behavior

Authorization tokens are kept in browser session storage, not inside the budget data file.
If the browser session expires, click **Sign in to OneDrive** again. Your local budget
data remains available even when signed out.

---

## Phone deployment

The same folder is a Progressive Web App (PWA).

Publish these files to an HTTPS static host such as GitHub Pages, add that exact HTTPS
URL as a **SPA redirect URI** in the Microsoft app registration, then open it on the phone
and choose **Add to Home Screen / Install app**.

The phone and laptop must use the same Microsoft app registration/client ID and sign in
to the same OneDrive account.

---

## Data safety

Keep using **Export backup** periodically. OneDrive synchronization is the operational
authoritative copy; the JSON backup remains the disaster-recovery mechanism.
