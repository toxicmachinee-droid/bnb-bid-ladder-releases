# BNB Bid Ladder

Public download and update channel for the BNB Bid Ladder desktop app.

This repository is intentionally release-only. It contains installer assets, update manifests, checksums, and user-facing security notes. It does not contain the private license server, admin panel, premium planner code, license database, signing private keys, or operator secrets.

## Download

Latest Windows installer:

https://github.com/toxicmachinee-droid/bnb-bid-ladder-releases/releases/latest/download/BNB.Bid.Ladder.Setup.0.1.3.exe

Latest release page:

https://github.com/toxicmachinee-droid/bnb-bid-ladder-releases/releases/latest

Auto-update manifest:

https://github.com/toxicmachinee-droid/bnb-bid-ladder-releases/releases/latest/download/latest.json

Current Windows installer SHA256:

```text
8a718affb2aa9601171a5ecbe18d33db3113ab7befb4e995865bbcd6e10d75cf
```

## Wallet And Private Key Safety

BNB Bid Ladder is designed so wallet private keys stay on the user's computer.

- Private keys are stored in a local encrypted keystore, protected by the user's wallet password.
- The license server is not a wallet custodian and must not receive raw private keys, seed phrases, or wallet passwords.
- The desktop app talks to the premium server for license checks and server-side planning, then verifies signed planner responses before execution.
- Browser cookies, local storage, and the license session are not a source of wallet authority.
- Users should never paste a private key, seed phrase, or wallet password into GitHub issues, Telegram, Discord, screenshots, or support chat.

## What The Public Server Sees

The production server is used for:

- license activation and heartbeat;
- premium planner responses;
- signed plan delivery to the desktop app;
- admin license management by the product operator.

The server must not need:

- raw wallet private keys;
- seed phrases;
- wallet passwords;
- local encrypted keystore contents.

## Verifying A Download

On Windows PowerShell:

```powershell
Get-FileHash .\BNB.Bid.Ladder.Setup.0.1.3.exe -Algorithm SHA256
```

The hash should match the SHA256 shown above or the digest on the GitHub release asset.

## Source Audit Status

This release repository is the installer/update channel, not the source-audit repository.

The public client source should be published separately only after its git history and release artifacts are checked for secrets, private server code, license database files, admin credentials, and test-only wallet material. Publishing source by simply flipping a private repository to public is intentionally avoided until that audit is complete.
