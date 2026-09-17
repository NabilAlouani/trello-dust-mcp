# Facturo support playbook

How the pre-sales support team handles tickets on the Trello support board. It applies to people and to the support agent alike.

## Board and flow

Tickets arrive in Inbox. Triage sets Priority and Category. In progress means someone is working on it. Waiting on customer means we replied and the next move is theirs. Done means resolved and confirmed.

Every ticket carries four custom fields: Priority (P1, P2, P3), Category (Billing, API, Integration, Account), Customer, and Agent status, a free text such as "Replied 2026-09-02".

## Priority and SLA

| Priority | Definition | First response |
|---|---|---|
| P1 | Invoices cannot be sent, or PDFs are broken for all invoices of an account | 2 hours |
| P2 | Degraded service with a workaround, or payments affected | 8 hours |
| P3 | Question or feature request | 2 business days |

Rules:

- Anything that stops an account from sending invoices or collecting payments is P1 until proven otherwise. Downgrade only once a workaround is confirmed with the customer.
- Billing questions about Facturo's own pricing are P3.

## Category

- Billing: plans, prices, discounts, upgrades, invoices Facturo sends to the customer.
- API: the REST API, rate limits, error codes, webhooks.
- Integration: Stripe, ERP and CRM connectors, imports.
- Account: access, API keys, users, workspace settings.

## Reply style

- Greet by first name.
- One paragraph. Say what the cause is, what to do, and where to click.
- Point to the relevant doc section by name.
- Sign as the Facturo pre-sales team.
- Quote only figures that appear in the docs. When the docs do not answer the question, say so and escalate.

## Escalation

- VAT and cross-border tax questions go to the finance specialist. Do not attempt a tax answer, even a partial one.
- Discounts above 10% go to a manager before anything is quoted.
- Stripe payout failures wait for Stripe. Open a case with Stripe support, add the blocked label, and note the case number on the card.

## Feature requests

Thank the customer, log the ticket with the feature label, and make no commitment on dates. Do not say whether the feature is planned.

## Duplicates

When two tickets describe the same problem for the same customer, answer the first one. On the second, post a Note that points to the first and move it as the team lead instructs.

## Comments on cards

Comments follow a prefix convention so the card history reads at a glance:

- Analysis: assessment of the ticket, with cause, priority and proposed action.
- Draft reply: a proposed answer, not yet sent.
- Reply to customer: the answer as sent. Posted only after a person approved it.
- Note: anything else, such as a duplicate, an escalation or a case number.

## Stale tickets

Tickets in Waiting on customer with no activity for 14 days are archived, after a preview reviewed by a person. Tickets with a future due date or the blocked label are never archived.
