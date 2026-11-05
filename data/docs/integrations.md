# Integrations

Integrations are available on the Pro and Enterprise plans. Connect them from **Settings › Integrations**.

## Slack

The Slack integration posts schedule updates to a channel of your choice and sends shift reminders as direct messages.

1. Click **Connect Slack** and approve the TidyShift app in your Slack workspace. You need to be a Slack admin, or have permission to install apps.
2. Choose the channel for schedule announcements.
3. Employees are matched to Slack users by email address. Employees whose TidyShift email does not match a Slack account will keep receiving email notifications instead.

## Google Calendar

Each employee can sync their own shifts to Google Calendar from **Profile › Calendar sync**. Shifts appear in a separate calendar called "TidyShift shifts". Changes appear in Google Calendar within 15 minutes. Syncing is one-way: editing a shift in Google Calendar does not change it in TidyShift.

## Payroll export

TidyShift exports approved timesheets for payroll. Go to **Timesheets › Export**, pick a date range and choose a format:

- CSV (works with any payroll software)
- Gusto
- QuickBooks Online

Only approved timesheets are exported. Overtime is calculated using the overtime rules set under **Settings › Pay rules**.

## API and webhooks

Pro and Enterprise workspaces can create API keys under **Settings › Developers**. The REST API lets you read and create shifts, employees and timesheets. Rate limits are 100 requests per minute on Pro and 1,000 per minute on Enterprise.

Webhooks notify your system when a schedule is published, a shift is swapped or a timesheet is approved. Each webhook request is signed with an HMAC-SHA256 signature in the `TidyShift-Signature` header. Failed deliveries are retried with exponential backoff for up to 24 hours.
