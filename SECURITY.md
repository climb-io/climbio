# Security policy

Please report vulnerabilities privately, not in a public issue.

- Use GitHub's "Report a vulnerability" (Security tab → Advisories) on this repository, or
- email climbio.service@gmail.com.

Include what you found, how to reproduce it, and which part is affected (the app, `functions/`, `firestore.rules`, `storage.rules`, `holdscan/`, `holdkit/`).

We aim to reply within 7 days. Please give us a reasonable time to fix the issue before disclosing it.

## Scope

In scope: this repository's code and rules, and the official site https://climbio.app.

Out of scope: sites hosted by others from a fork, volumetric denial-of-service tests against the official site, and social engineering.

The Firebase web config in `backend/firebase.js` (including its API key) is public by design; access is controlled by the security rules and App Check, not by hiding that config.
