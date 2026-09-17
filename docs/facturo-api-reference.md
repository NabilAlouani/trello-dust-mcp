# Facturo API reference

Base URL: `https://api.facturo.eu/v1`. Requests and responses are JSON. Timestamps are ISO 8601 in UTC. Amounts carry two decimals in the invoice currency.

## Authentication

Send the API key in the header `Authorization: Bearer <api_key>`. Keys are created and rotated in Settings > API keys. Rotating a key revokes the old one immediately: every integration that still holds the old key receives `ERR_AUTH_401` until it is updated.

## Rate limit

60 requests per minute per API key. Above that, the API answers HTTP 429 with a `Retry-After` header. A batch call counts as one request, whatever the number of invoices it carries. Jobs that create many invoices should use the batch endpoint rather than one call per invoice.

## Endpoints

### POST /invoices

Creates one invoice. Body: `customer_id`, `line_items`, `currency`, `due_date`. Each line item has `description`, `quantity`, `unit_price` and `type`, which is `goods` or `services`. Returns the invoice with its `id`, `number` and computed tax lines.

### POST /invoices/batch

Creates up to 200 invoices in one call. Body: `invoices`, an array of invoice bodies as above. Counts as one request against the rate limit. Returns one result per invoice, in order, each either the created invoice or an error object. A run of 1,500 invoices needs 8 calls, not 1,500.

### POST /invoices/{id}/send

Sends the invoice to the customer's billing email and emits `invoice.sent`.

### GET /invoices/{id}/pdf

Returns the rendered PDF. When the account uses a custom template and rendering fails, the response is `ERR_TEMPLATE_500`.

### POST /credit-notes

Creates a credit note against a sent or paid invoice. Body: `invoice_id`, `line_items`, `reason`. Paid invoices are locked; a credit note is the only way to correct one.

### POST /webhooks

Registers an endpoint. Body: `url`, `events`, `secret`. Events: `invoice.sent`, `invoice.paid`, `invoice.overdue`.

## Error codes

| Code | HTTP | Meaning |
|---|---|---|
| `ERR_TEMPLATE_500` | 500 | PDF rendering failed on a custom template. The response `details` field names the element that failed. |
| `ERR_VAT_422` | 422 | The VAT number failed the VIES check, or the invoice mixes goods and services for a customer outside the EU (`details: "mixed_supply"`). |
| `ERR_AUTH_401` | 401 | Invalid or revoked API key. |
| `ERR_QUOTA_402` | 402 | Invoice quota exhausted and overage disabled. |

## Webhooks

Every delivery carries the header `X-Facturo-Signature`: an HMAC-SHA256 of the raw request body, keyed with the webhook secret, hex encoded. Verify it against the raw body, before any JSON parsing or re-serialisation. A body that has been parsed and re-encoded produces a different signature.

The endpoint must answer HTTP 200 within 5 seconds. Any other status, or a timeout, counts as a failed delivery. Facturo retries 3 times over 30 minutes, then marks the delivery as failed. Each delivery and its error text are listed in Integrations > Webhooks > Deliveries.

## VAT handling

The tax treatment is computed per invoice from three inputs: the customer's country, the customer's VAT number, and the line item type, goods or services.

- Reverse charge applies to B2B services outside France when the customer has a valid VAT number. The invoice shows no VAT and carries the reverse charge mention.
- Goods shipped to Switzerland are exports: no VAT.
- One invoice must not mix goods and services when the customer is outside the EU. The API returns `ERR_VAT_422` with `details: "mixed_supply"`. Split the lines into two invoices, one per type.

Escalate any other VAT question to the finance specialist. Support does not give tax advice.
