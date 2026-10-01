# AI Order Radar

AI Order Radar is an early-stage operating design for screening and prioritizing paid software and automation opportunities.

## Status

This repository currently documents the operating architecture and decision rules. It is not presented as a finished production product yet.

## What it is designed to do

The system separates opportunity research from real external execution and ranks work by how close it is to a verifiable paid outcome.

Key ideas:

- **Payment readiness first** — favor opportunities with an active budget, hiring intent, bounty, request for proposal, or other current buying signal.
- **Execution preflight** — check scope, acceptance criteria, competition, account access, payout path, and expected delivery time before investing deeply.
- **Action-level channel health** — a connector can be readable while one write action is unavailable, so capability is tracked per operation rather than as a single online/offline flag.
- **External receipt required** — sending, bidding, claiming, submitting, or delivering counts only when the external system returns a verifiable receipt/ID.
- **Project race slots** — run a small number of opportunity types in parallel and reallocate effort toward the routes that create the strongest paid signals.
- **Fail closed on uncertainty** — do not turn research, drafts, local tests, or tool repair into fake progress.

## Example workflow

1. Discover a current paid opportunity.
2. Verify the buyer/issuer, scope, payment path, deadline, and application or submission channel.
3. Check whether the current account and tools can actually perform the required external action.
4. Reject or downgrade opportunities with unclear payout, excessive competition, unavailable write access, or unrealistic scope.
5. Execute the smallest legitimate external action.
6. Record the external receipt and monitor the next commercial state: reply, shortlist, accepted delivery, or payment.

## Reliability approach

A common automation failure mode is treating an integration as simply "connected" even when one operation has degraded. The design instead tracks capabilities such as read, send, submit, claim, and payment handoff separately. A failed write does not become a false success, and repeated retries are not used to hide a blocked path.

## Technology context

The broader workflow is designed around TypeScript/Java services, APIs, Linux production operations, and external integrations. The public repository is intentionally small while the operating model is being validated.

## Safety and operational constraints

- No credentials, verification codes, or private customer data are stored here.
- No external action is counted without a real receipt.
- No paid tool or account upgrade is assumed to be available.
- Irreversible financial, identity, or legal actions stay behind an explicit human gate.
