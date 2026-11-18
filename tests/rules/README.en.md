# Firebase permission tests

[繁體中文](README.md)

These tests use Node's test runner, the Firebase Emulator and the Rules testing SDK. They write only to the local `demo-climbio-acceptance` project at `127.0.0.1`. They do not use real accounts, contact production data or deploy rules.

Requires Node.js 22 or later, Java 21 or later, and available ports 8080 and 9199. Run from the repository root:

```sh
npm ci --prefix tests/rules
npm test --prefix tests/rules
```

The tests load the repository's actual `firestore.rules` and `storage.rules`. Simulated Google and anonymous token claims verify Rules authorization, not real OAuth, deployed rules or app integration.

Owners, other Google accounts, anonymous accounts with the owner's UID, other anonymous accounts and unauthenticated clients cannot read, write or list retired Firebase sync paths. Everyone can read `public/projects.json`, but clients cannot write or delete it or list its directory. Other `public/` files and retired `topos/` paths deny direct access. Sharing data, base photos, gym indexes, private statistics and Studio project indexes (`datasets`) also deny direct client access. See [backup and restore](../../docs/backup.md) for the app's current backup flow.

Set `RULES_STORAGE_FILE` to compare another Storage rules file, or `RULES_REPO_ROOT` to select a repository root. These options change only the test input. Emulators shut down after the run; test data is never exported to production.
