# Publish Budget Pace v1.0 for Phone

1. Upload all files in this folder to the root of your GitHub Pages repository.
2. Enable GitHub Pages from the `main` branch and `/(root)`.
3. Wait until the HTTPS site is live.
4. Copy the exact site URL, such as:
   `https://YOUR-USERNAME.github.io/budget-pace/`
5. In the Microsoft Entra Budget Pace app registration:
   - Authentication
   - Single-page application
   - Add the exact HTTPS URL as another redirect URI.
6. Open the HTTPS site on the phone.
7. Budget Pace > OneDrive sync > Configure.
8. Paste the same Application (client) ID used on the laptop.
9. Sign in to the same Microsoft/OneDrive account.
10. Sync.
11. Install:
    - iPhone Safari: Share > Add to Home Screen
    - Android Chrome/Edge: Install app / Add to Home screen

The phone localStorage is only a cache. OneDrive remains the authoritative dataset.
