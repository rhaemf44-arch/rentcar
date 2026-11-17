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

## Deployment dependency

Verified on 2026-11-17: Firebase admin sign-in works for `ky-rent-system`,
default database, Standard edition, native mode, `asia-northeast3`. The deployed
rules permit `reservations` for **any authenticated identity**. The app signs
devices in anonymously; this is not an employee allowlist. Other collections
currently return `PERMISSION_DENIED`. The exact previous rules are backed up in
`firestore.previous.rules`.

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

1. Email/password is already enabled in Firebase Authentication (verified in the
   console). Create the four user-requested employee accounts there. Do not put
   passwords, hashes or a credential roster in this repository or browser local
   storage. Firebase requires at least six characters; the supplied four-character
   initial password cannot be registered. Account creation is pending a valid
   password set directly by the user.
2. Login IDs are normalized to lowercase. A simple ID such as `employee_qa`
   maps to `employee_qa@staff.ky-rent-system.invalid` in Firebase Authentication;
   actual email IDs are accepted unchanged except lowercase/trim normalization.
   The `.invalid` aliases do not receive mail or password-reset emails. For each
   created account, use its actual Auth UID to create `staffAccounts/{uid}` with
   `enabled: true` (boolean) and the requested employee name as `label`. These
   records are administrator-managed; no public signup grants staff membership.
3. Before publishing, recheck that the active Firestore rules match the retained
   backup and preserve any intervening changes. Publish the approved staff-only
   rules, the matching frontend and the matching `ppurio-reservation-sms` function
   in a coordinated cutover. Until then the deployed anonymous app remains as-is.
   The SMS function must include `staff-account-auth.ts`; it verifies the same
   staff approval using the already verified Firebase token. Old device invites
   do not grant account access and no SMS is sent during validation.
4. Verify a real approved account can log in, that automatic login persists a
   Firebase session when selected, that unchecked login uses session persistence,
   and that logout and revocation block further reads/writes. The frontend keeps
   all business UI and caches unopened until a server-confirmed staff approval.
   Passwords are never written to app local storage; Firebase manages auth tokens.
   A new page requires online staff approval. Do not claim offline authorization
   from a cached approval. Rules and frontend are prepared but not yet deployed.
5. After cutover, log in first on the computer containing `103호1504` first. Each refreshed computer
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
