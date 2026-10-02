# Automation Reliability Proof

This is a compact, public proof asset for the reliability patterns used in **AI Order Radar**.

The goal is not to present a polished client product. It is to make several implementation choices directly inspectable.

## 1. Action-level channel health

Instead of marking an integration simply "online" or "offline", the system tracks what can actually be done right now.

See: [`.bboss/platform-writeability.json`](./.bboss/platform-writeability.json)

Examples recorded there:

- Gmail opt-in applications can be available while a different action or destination is suppressed.
- An owned GitHub repository can be writable without implying write access to external repositories.
- A bounty service can be readable while authenticated claim/submit remains unavailable.
- ATS APIs that require private site credentials are not treated as credential-free submission endpoints.

This avoids a common automation failure: assuming that successful read access means a write action will also work.

## 2. Fail closed instead of inventing success

The Frantic executor deliberately separates public status reads from credentialed write actions.

See: [`.github/workflows/frantic-executor.yml`](./.github/workflows/frantic-executor.yml)

Current behavior:

- `status` uses the public API and records a sanitized result.
- `claim` / `submit` do **not** silently pretend to work when the credentialed bridge is unavailable.
- The workflow writes an explicit `WRITE_BRIDGE_UNAVAILABLE` result instead.

That is intentional: a failed external write remains a failure until the external system returns a real receipt.

## 3. Sanitized external receipts

See: [`.bboss/frantic-result.json`](./.bboss/frantic-result.json)

The recorded status includes:

- agent eligibility,
- payout readiness,
- current claim eligibility,
- active / delivered / paid work state,
- verification state,

without storing the private agent token in the repository.

## 4. Permanent-bounce suppression

See: [`.bboss/email-suppressions.json`](./.bboss/email-suppressions.json)

A permanent delivery failure is treated as an invalidated action, not as a successful send. The failed address is added to a suppression list so the system does not repeatedly retry it.

## 5. Operational principles demonstrated

These files demonstrate a few reliability practices that matter in real automation work:

1. **Idempotency mindset** — repeated retries are not used to hide a blocked path.
2. **Explicit preflight** — writeability and payout constraints are checked before deep work.
3. **Evidence over status labels** — an action counts only when the external service returns a verifiable ID/receipt.
4. **Least-privilege handling** — credentials stay outside the public repository.
5. **Observable failure states** — blocked writes and permanent bounces are recorded explicitly.

## What this proves — and what it does not

This repository proves the implementation and operating patterns above. It does **not** claim a paid-client case study, production scale, or revenue result that has not been independently verified.
