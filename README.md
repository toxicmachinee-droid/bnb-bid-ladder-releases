# BNB BitLadder

BNB BitLadder is a desktop operator app with local wallet custody and server-enforced premium execution planning.

Public source distribution is allowed only through the audited thin-client export.

This repository verifies the public source/export boundary and writes a hash manifest for the exported artifact. It still does not contain a Windows installer pipeline. Do not publish an installer or portable archive until that packaging pipeline exists and proves that the packaged artifact is built from the approved thin-client bundle and passes the same boundary checks after packaging.

Expected release assets, once the installer pipeline is restored and audited:
- `BNB.BitLadder.Setup.<version>.exe` - Windows installer.
- `BNB.BitLadder.Portable.<version>.zip` - unpacked app folder for users who prefer to inspect files before launching.
- `SHA256SUMS.txt` - hashes for release assets.

The updater mechanism must be verified against the packaged artifact before public release. Until that artifact test exists, updater behavior is not considered security-verified by this repository.

## Trust Model

Private keys never leave the user's machine. The desktop app keeps wallet import/unlock, encrypted keystore storage, RPC settings, Pool Search, Manage state, monitoring, journals, filters, and preferences local.

Premium live actions use a thin-client flow:
- the client sends a normalized intent for `open`, `close`, `claim`, or `swap` to the license/planner server;
- the server validates the license session, device identity, nonce, and action policy;
- the server builds the executable transaction requests and signs a short-lived plan;
- the client verifies the server signature, wallet, chain, expiry, selector policy, tx count, native value limits, approval spender, and expected action before local signing.

Read-only UI and local state must stay fast and local. Live premium execution may make one planner request after the user starts execution/review; if the planner is unavailable or the plan fails verification, the app fails closed with a clear retry state. It must never silently fall back to local premium transaction building.

## Public Source Boundary

The public/exported source exists so users can verify wallet safety and client-side plan verification. It is not a place to ship premium transaction planning algorithms.

Allowed in public/exported source:
- UI, static assets, and read-only client code;
- local encrypted keystore and local signing flow;
- device/session client code;
- signed-plan verification and execution runner;
- public audit scripts and public security rules.

Intentionally not public:
- private license server implementation;
- admin panel internals;
- premium planner internals;
- V3/V4 mint, close, claim, swap, route-to-tx, and calldata builders used for live premium execution;
- signing private keys, peppers, license databases, raw license keys, and deployment secrets;
- internal planning docs, screenshots, runbooks, and development test artifacts.

## Required Release Checks

Before any public source export or release build:

```powershell
npm ci
npm test
npm run security:verify
npm run audit:public-private
npm run audit:public-release-boundary
npm run audit:public-manifest
node ./scripts/export_public_release.cjs --dry-run
```

`security:verify` runs tests, dependency audit, strict private/public checks, copied-artifact boundary checks, and public manifest verification. The release boundary audit exports into `dist/public-release-audit` and verifies the copied artifact, not just the working tree. Every exported public source bundle includes `PUBLIC_RELEASE_MANIFEST.json`; `node ./scripts/verify_public_release_manifest.cjs --target <export-dir>` must pass before publishing.

Installer size and updater behavior must be justified by the audited packaging pipeline, not by assumption. A release is blocked if the packaged artifact contains private planner/runtime files, premium transaction builders, server secrets, or stale dependencies.

## Current Live Verification

Last recorded manual verification on BSC mainnet:
- `swap`: `0.1 USDT -> VRA` on VRA/USDT Uniswap V3, confirmed through a server-issued `remote_swap_plan`.
- `open -> close`: VRA/USDT Uniswap V3 `micro_open_close`, `capitalUsd=0.1`, `autoswapOnClose=false`, confirmed with one approve, one mint, and one close transaction.

These live checks prove the current installed app can execute through the remote planner, but they do not replace regression tests or release-artifact audits. Every new release still needs `npm run security:verify` and an audited exported/package artifact.

## Device And License Binding

The server binds a license to a device identity. The client sends `installId`, `hwidHash`, `publicKeyPem`, and derived `fingerprint`; sessions and planner/report requests must match that device and use signed one-time nonces.

Operational policy:
- one license key is one active bound device unless an admin explicitly resets it;
- a different device must be rejected as `license key is bound to another device`;
- signed request timestamps are accepted only within the server skew window;
- nonce replays, repeated wrong-device attempts, and suspicious session churn must be recorded in sanitized server audit logs;
- license create/block/reset/delete actions require an issued user identity or an admin reason where appropriate;
- confirmed abuse is handled by blocking the license key server-side, not by trusting client UI state.

## Anti-Fraud Baseline

The anti-fraud policy is intentionally strict but not heavy for legitimate users:

- one paid license binds to one device identity;
- support can reset a device only after verifying the customer and recording a reason;
- refund, chargeback, resale, or public key sharing is handled by server-side block/revoke;
- normal Pool Search, Manage, monitoring, wallet unlock, and read-only previews do not wait on fraud checks;
- live premium actions already pass through the server planner, so wrong-device and replay checks run there without adding client friction.

## Transaction Input Safety

Users cannot gain shell or database access to the license server merely by sending an on-chain transaction. The realistic risk is different: transaction receipts, calldata, token metadata, logs, or route data become untrusted input once the server/client parses them. Any code that consumes chain data must treat it like hostile JSON/binary data: validate addresses/selectors/amounts, avoid shell execution, avoid SQL string concatenation, bound request sizes/timeouts, and never use transaction-provided URLs or file paths as trusted server operations.
