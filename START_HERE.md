# Budget Pace v0.6.1 — Clean Test Package

This folder contains everything needed to run a fresh laptop test.

## Files required by the app

- `index.html`
- `app.js`
- `styles.css`
- `manifest.json`
- `sw.js`

Also included:

- `sample-transactions.csv` — sample import file
- `README.md` — product/version notes
- `START_TEST.bat` — starts the app locally on a clean test port

## Recommended way to start

Double-click:

`START_TEST.bat`

Then open:

`http://127.0.0.1:8001`

The test package deliberately uses **port 8001** rather than 8000.

Browser local storage is tied to the full web origin, including the port. Therefore:

- `http://127.0.0.1:8000` = your previous data
- `http://127.0.0.1:8001` = a separate clean test environment

This lets you test without deleting or changing the data from your earlier version.

## Security

The supplied start script binds Python only to:

`127.0.0.1`

That means it is accessible only from this laptop, not from other devices on your network.

## Stopping the app

Return to the Command Prompt window and press:

`Ctrl+C`

## Importing your bank CSV

Use the app's **Import CSV** button and choose your bank transaction file.

Before doing significant testing, you can use **Export backup** to create a complete JSON backup of the test data.
