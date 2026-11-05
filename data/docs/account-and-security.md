# Account and Security

## Roles and permissions

- **Owner:** one per workspace. Manages billing, can cancel the subscription and transfer ownership.
- **Admin:** manages settings, locations, roles and all schedules.
- **Manager:** builds and publishes schedules for the locations they are assigned to, and approves time-off and timesheets for those locations.
- **Employee:** sees their own shifts, requests swaps and time off, and clocks in and out.

To transfer ownership, the current owner goes to **Settings › Workspace › Transfer ownership** and selects an existing admin.

## Two-factor authentication

Any user can enable two-factor authentication (2FA) under **Profile › Security** using an authenticator app. Admins on Pro and Enterprise can require 2FA for all managers and admins from **Settings › Security**.

## Single sign-on

SAML single sign-on (Okta, Microsoft Entra ID, Google Workspace) is available on the Enterprise plan only.

## Password reset

Click **Forgot password** on the login page. The reset link is valid for 1 hour. If you sign in with SSO, reset your password with your identity provider instead.

## Data storage and privacy

Customer data is stored in the European Union (Frankfurt) by default. Enterprise customers can choose US hosting. Data is encrypted in transit (TLS 1.2+) and at rest (AES-256). Daily backups are kept for 30 days.

## Deleting your account

The workspace owner can delete the workspace from **Settings › Workspace › Delete workspace**. Deletion is permanent after a 14-day grace period, during which the owner can restore the workspace by contacting support. Backups containing the workspace are purged within 30 days after deletion.
