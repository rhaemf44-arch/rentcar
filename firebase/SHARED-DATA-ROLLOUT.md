# Shared reservation-management data

Project: `ky-rent-system`, the existing default Firestore database.

The deployed reservation collection already synchronizes all reservation fields,
including finances, insurance, dispatch and return locations, SMS fallback data,
status, and recoverable deletions. This change adds the remaining local business
catalogs without changing reservation documents or the print layout.

| Collection | Contents | Migration |
| --- | --- | --- |
| `vehicles/{plate}` | Name, seats, fuel, group, deletion tombstone | Create only missing documents from each browser's existing fleet. |
| `vehicleMigrations/{accountUid}/devices/{browserId}` | Original local fleet as bounded JSON for recovery | Immutable per-browser backup, readable only by its approved staff account. |
| `reservationHistory/{id}` | Existing Kakao change history and future entries | Create only missing entries. Existing history remains immutable. |
| `staffAccounts/{uid}` | Administrator-managed enabled flag and staff label | A password account plus enabled=true is required for business access. Clients can read only their own approval. |

## Deployed state · 2026-11-17

The existing `ky-rent-system` default database is Standard edition, native mode,
`asia-northeast3`. Four employee Auth accounts were created directly by the user,
and their actual UIDs were approved in `staffAccounts` with `enabled: true` and
matching staff labels. No credential roster, passwords or hashes are committed.

The staff-only rules were published after confirming the previous active rules
matched `firestore.previous.rules`. The frontend was merged in PR #42 and its
live GitHub Pages response contains the staff gate and no anonymous-login call.
The production login screen and automatic-login checkbox were inspected. The
customer SMS function `ppurio-reservation-sms` version 12 is ACTIVE with the same
staff-account authorization and its own Firebase JWT verification.

Live console rule simulations allowed an approved password account and denied an
unapproved password account and an anonymous identity, including an anonymous
token with an approved UID. An unauthenticated Firestore REST request returned
403. These simulations do not replace a real employee's first sign-in, password
persistence check and local-data migration on the actual office computers.

The user has selected **employee ID/password login with automatic login**,
not device approval or anonymous sharing. `firestore.rules` is a tested
prototype that requires a password-provider Firebase identity and an enabled,
server-managed `staffAccounts/{uid}` document for reservations, fleet and history.
Anonymous accounts, unapproved accounts and revoked accounts are denied. Clients
cannot create, edit or list approval records. Existing reservation document
schemas remain intact. Schema/size validation and immutable history apply to the
new catalogs; the legacy reservation schema has not been comprehensively
rewritten or hardened by this rollout.

## Account setup and coordinated rollout

1. Email/password is enabled in Firebase Authentication. The initial four
   accounts and their approval records are created and verified. Future accounts
   must be created in Firebase Auth and approved by an administrator. Passwords
   are set directly by the user and are not stored in application source or local
   storage. Firebase requires at least six characters.
2. Login IDs are normalized to lowercase. A simple ID such as `employee_qa`
   maps to `employee_qa@staff.ky-rent-system.invalid` in Firebase Authentication;
   actual email IDs are accepted unchanged except lowercase/trim normalization.
   The `.invalid` aliases do not receive mail or password-reset emails. For each
   created account, use its actual Auth UID to create `staffAccounts/{uid}` with
   `enabled: true` (boolean) and the requested employee name as `label`. These
   records are administrator-managed; no public signup grants staff membership.
3. The staff-only rules, matching frontend and matching SMS function have been
   deployed. Before any future rule change, back up the then-active rules and
   preserve intervening changes.
   The SMS function must include `staff-account-auth.ts`; it verifies the same
   staff approval using the already verified Firebase token. Old device invites
   do not grant account access and no SMS is sent during validation.
4. Verify a real approved account can log in, that automatic login persists a
   Firebase session when selected, that unchecked login uses session persistence,
   and that logout and revocation block further reads/writes. The frontend keeps
   all business UI and caches unopened until a server-confirmed staff approval.
   Passwords are never written to app local storage; Firebase manages auth tokens.
   A new page requires online staff approval. Do not claim offline authorization
   from a cached approval. The production employee login page is deployed; real
   first sign-in and persistence on the office devices are the remaining rollout
   checks.
5. Log in first on the computer containing `103호1504`. Each refreshed computer
   uploads its missing local vehicles and original backup, then follows the same
   live server catalog. Log in on the remaining computers too.
6. Confirm `103호1504` is on the server and appears in another independent client.
   Compare vehicle counts and values. Do not declare the migration complete from
   frontend tests alone.

## Preservation and conflicts

- Existing server names and deletion tombstones win over legacy browser copies.
  Original fleet values remain in each device backup for review and recovery.
- When the server fleet is confirmed empty, the first device's missing default
  vehicles are recorded as deleted. Missing vehicles on later devices do not
  delete server records.
- New user edits use per-vehicle field patches and a durable local queue. Other
  vehicle records and unchanged fields are retained. A newer edit made while a
  previous write is pending is not dropped.
- Local storage remains an offline cache and journal. Clearing it before the
  first successful migration can lose vehicles that never reached the server.
- The vehicle page has a device-recovery download containing reservations,
  vehicles, history, pending writes, and the original local fleet.
- Device-specific display settings and unsaved navigation drafts remain local.
  They do not determine the shared business data.
- The top save indicator is successful only when reservation, vehicle, and
  history synchronization have all succeeded. A denied vehicle or history write
  remains visible even when reservations are saved.

## Validation

`npm test` includes independent-client migration, stale-client deletion safety,
offline reloads, field-level merging, overlapping writes, permission and storage
failures, empty SDK caches, immutable history migration, and the aggregate save
indicator. Browser validation uses a separate in-memory test backend and does
not write customer data.

The combined application suite passes 61 tests, including login persistence,
revocation, separate browser backups under one employee account, and account-based
SMS authorization. Thirteen local Firestore emulator tests pass, covering
unapproved/anonymous denial, self-escalation, account revocation, catalog
validation, own-account backups and immutable history. Run the rule tests with:

```sh
npx -y firebase-tools@latest emulators:exec --only firestore --project demo-ky-shared --config firebase/emulator-test.config.json 'node --test firebase/shared-rules.test.mjs'
```

The script refuses any host except the named local demo emulator. The rules
bound snapshot JSON as opaque strings; the client parses it without evaluating
code and discards invalid serialized history. Rules do not validate JSON's
nested business fields. Original reservation documents are not re-encoded.
