# Facturo troubleshooting

Known problems, their usual cause, and the fix. Follow the steps in order. When a fix does not work, escalate with the list of steps already tried.

## Broken invoice PDF

Symptoms: the logo overlaps the header or the invoice number, the totals column is cut off on the right, line items are misaligned. Usually every invoice of the account is affected at once, right after a branding or template change.

Cause: almost always a custom template combined with a logo outside the supported size. Logo limits: maximum 300 x 100 pixels, PNG or SVG. Custom templates support the layout blocks of the template editor only. Imported CSS with absolute positioning or flex is ignored at render time, which shifts the elements around it.

Fix:

1. Settings > Branding: re-upload a logo within 300 x 100 px, PNG or SVG.
2. Templates > open the custom template > Preview. Check the header and the totals column.
3. If the preview is still broken: Reset to default template, then re-apply the colours and the footer text.

Sending is unaffected. Invoices already sent with a broken PDF can be regenerated from the invoice page once the template renders correctly. The customer does not need to recreate them.

## Payment link says expired

Symptoms: clients who click Pay now land on a page saying the payment link has expired. Nothing changed on the customer's side.

Cause: the Stripe connection has expired or been revoked. Stripe rotates the connection every 12 months. The connection also breaks when the Stripe account owner changes their password.

Fix: Settings > Payments > Reconnect Stripe. Existing links start working again as soon as the connection is back. There is no need to resend the invoices.

## Recurring invoices sent at the wrong hour

Symptoms: recurring invoices scheduled for 9:00 arrive at 2:00 or another odd hour.

Cause: the schedule runs in the workspace timezone, set in Settings > Workspace. The default is UTC, so a company in Lisbon or Paris sees invoices go out hours early.

Fix: set the workspace timezone to the company's timezone. The next scheduled run uses the new setting. Invoices already sent are not affected.

## Webhooks not received after a migration

Symptoms: after a move to a new server or domain, deliveries show as failed in the dashboard and the CRM or ERP no longer reacts to `invoice.paid` or other events.

Check, in order:

1. The endpoint answers HTTP 200 within 5 seconds. An endpoint that does its work before answering can time out.
2. The signature verification uses the raw request body, not a parsed and re-encoded copy.
3. Integrations > Webhooks > Deliveries shows the error text for each failed delivery. Connection refused or timeout points at the network.

IP allowlists on the new server are the usual cause: the firewall of the new machine blocks Facturo's delivery addresses even though the application answers correctly when tested from inside the network.

## Correcting a paid invoice

Paid invoices are locked and cannot be edited. Issue a credit note from the invoice page (More > Credit note) for the full or partial amount, then a new invoice if needed. Both documents stay linked to the original, and the customer's statement shows all three.
