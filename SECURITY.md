# Budget Pace v1.0.1 — OneDrive Security

Budget Pace should use the smallest OneDrive permission that works.

## Preferred modes

### Personal OneDrive
Uses delegated `Files.ReadWrite.AppFolder`.

### Work/school OneDrive
v1.0.1 tries delegated `Files.ReadWrite.AppFolder` first.

Microsoft documentation currently conflicts:
- the App Folder overview says App Folder works across work/school and home OneDrive;
- other permission/special-folder references still describe delegated AppFolder as personal-account-oriented.

Therefore v1.0.1 tests App Folder-only access first and shows a targeted error if the tenant rejects it.

### Fallback
`Files.ReadWrite` remains available only as an explicitly acknowledged work/school fallback.
It is broader than Budget Pace needs.

## Migration from v1.0
Old v1.0 work-account mode is automatically changed to work/school App Folder-only mode and the browser authentication session is cleared so Microsoft must issue a fresh token for the narrower requested scope.

No Budget Pace transaction or budget data is deleted.

## After App Folder mode works
In Microsoft Entra > App registrations > Budget Pace > API permissions:
1. verify sync works on laptop and phone;
2. confirm `Files.ReadWrite.AppFolder` is present;
3. only then remove the broader `Files.ReadWrite` delegated permission if it remains.

## Browser hardening
v1.0.1 also adds:
- Content Security Policy blocking inline/third-party scripts;
- no-referrer policy;
- camera, microphone, and geolocation disabled;
- visible current OneDrive permission mode in the HMI.
