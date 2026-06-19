# Security Rules

These rules are mandatory for every release, hotfix, and local change that touches licensing, execution planning, wallet signing, exports, or updater behavior.

## Non-Negotiable Boundaries

- Never ship local premium transaction builders in the public/exported client.
- Never treat client flags, UI gates, obfuscation, packaging, installer signing, or code signing as license enforcement.
- Never add a production path where remote planner failure falls back to local premium execution.
- Never add dev bypasses to production modules, handlers, routes, or exported builds.
- Never cache reusable executable premium calldata as a bypass path.
- Never put server private keys, license peppers, admin secrets, raw license keys, production databases, or deployment secrets in public/exported source.
- Never publish a desktop installer, portable archive, or updater payload unless the packaged artifact itself is audited against the public/private boundary.
- Never process chain/RPC/transaction data as trusted input; calldata, receipts, token metadata, logs, symbols, URLs, and pool fields must be validated before storage, display, or planner use.

## Required Premium Flow

Live `open`, `close`, `claim`, and `swap` actions must use server-issued signed plans:

1. The client sends normalized intent to the license/planner server.
2. The server validates license session, device identity, nonce, chain, action, policy, and entitlement.
3. The server builds or strictly validates transaction requests.
4. The server signs a short-lived plan and records issuance metadata.
5. The client verifies signature, wallet, chain, expiry, tx count, selector policy, approval spender, native value limits, and action before local signing.
6. The local wallet signs only the verified transaction requests.

If any step fails, the action fails closed with a clear error. It must not generate local live premium transaction requests.

## UX Constraints

- Pool Search, filters, Manage, local state, monitoring, wallet import/unlock, and read-only previews stay local and responsive.
- License heartbeat and planner health warm asynchronously after startup.
- A live premium planner request happens only when the user starts execution/review.
- Planner p95 should stay under 1 second in normal operation.
- Timeouts show a reconnect/retry state and must not freeze the UI.
- Existing approval, slippage, native/WBNB, nonce, gas, receipt, and RPC safety checks remain active.

## Tests Required For Every Premium Action

Before adding or changing a premium action, add negative bypass tests first:

- forcing `licenseRequired=false` must not produce live premium transaction requests;
- forcing any remote-planner-required flag off must not produce live premium transaction requests;
- missing planner URL or public key must fail closed;
- mutated plan `to`, `data`, `value`, wallet, chain, expiry, approval spender, or selector must be rejected before signing;
- expired or replayed plans must be rejected.

## Release Boundary Commands

Run these before publishing public source or release artifacts:

```powershell
npm ci
npm test
npm audit --omit=dev
npm run security:verify
npm run audit:public-private
npm run audit:public-release-boundary
node ./scripts/export_public_release.cjs --dry-run
```

The strict audit must check a copied exported artifact, not only the repo tree. Public/exported builds must fail if they contain premium builders, `encodeFunctionData` premium sinks, server planner internals, license server code, private signing keys, peppers, admin tools, raw secrets, or private runtime references.

Release builds must come from a clean dependency install. Do not package from a stale local `node_modules` directory with extraneous packages or versions that do not match `package-lock.json`.

Installer and updater artifacts must have their own gate:

- build only from the approved thin-client/public bundle;
- unpack or inspect the produced artifact before publishing;
- run the public/private boundary audit against the unpacked artifact;
- verify hashes and signatures for every published asset;
- block release if the artifact contains private runtime files, server code, premium builders, secrets, or unexpected dependencies.

## Server-Side Plan Requirements

- Remote license/planner transport must use HTTPS unless the host is loopback or an explicit dev-only insecure override is set.
- Licenses must be enforced server-side with device binding: `installId`, `hwidHash`, `publicKeyPem`, and derived device fingerprint must match the bound license/session before planner access.
- A license key may have one active bound device unless an admin explicitly resets it. Wrong-device attempts must fail closed and be auditable.
- Signed plans must reject action mismatches, wallet mismatches, chain mismatches, missing transaction requests, future issue timestamps, expired plans, and plan TTLs above policy.
- Admin list endpoints must not return raw license keys by default.
- Execution reports must be signed with the device key and replay-protected with one-time nonces.
- License/planner HTTP servers must set bounded request/header/keep-alive timeouts.
- Repeated nonce replay, wrong-device session attempts, abnormal planner volume, or impossible device churn are abuse indicators. The response is server-side revoke/block/reset workflow, never a client-side flag.

## Chain Data Handling Rules

- Treat every RPC response, receipt, token symbol/name, pool field, hook, route, and transaction log as attacker-controlled.
- Do not pass chain-derived strings to shell commands, filesystem paths, SQL strings, HTTP fetches, or admin actions.
- Use parameterized database writes and structured ABI/RPC parsers.
- Bound response sizes and request timeouts for RPC, market APIs, planner APIs, and execution report APIs.
- UI must escape token symbols, names, URLs, and diagnostics before rendering.
- Server access cannot be obtained by a transaction alone; it becomes possible only if our code turns transaction data into unsafe command execution, SSRF, SQL injection, path traversal, deserialization, or secret disclosure.

## Review Checklist

- Does this change preserve local wallet custody?
- Does this change preserve speed for read-only UI paths?
- Does every live premium action require a verified server plan?
- Does the failure path stop before local signing?
- Does the public export exclude private runtime files?
- Does the docs text match the actual trust model?
- Does server-side device binding reject wrong-device and replay attempts?
- Does the code treat chain/RPC data as hostile input?
