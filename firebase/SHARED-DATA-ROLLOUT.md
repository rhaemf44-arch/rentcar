# Shared reservation-management data

Project: `ky-rent-system`, the existing default Firestore database.

The deployed reservation collection already synchronizes all reservation fields,
including finances, insurance, dispatch and return locations, SMS fallback data,
status, and recoverable deletions. This change adds the remaining local business
catalogs without changing reservation documents or the print layout.

| Collection | Contents | Migration |
| --- | --- | --- |
| `vehicles/{plate}` | Name, seats, fuel, group, deletion tombstone | Create only missing documents from each browser's existing fleet. |
| `vehicleMigrations/{anonymousUid}` | Original local fleet as bounded JSON for recovery | Immutable backup, readable only by the originating device. |
| `reservationHistory/{id}` | Existing Kakao change history and future entries | Create only missing entries. Existing history remains immutable. |

## Deployment dependency

Verified on 2026-11-17: Firebase admin sign-in works for `ky-rent-system`,
default database, Standard edition, native mode, `asia-northeast3`. The deployed
rules permit `reservations` for **any authenticated identity**. The app signs
devices in anonymously; this is not an employee allowlist. Other collections
currently return `PERMISSION_DENIED`. The exact previous rules are backed up in
`firestore.previous.rules`.

`firestore.rules` is a tested prototype preserving the reservation rule and
adding fleet sharing, own-device immutable backups, and immutable history.
History snapshots contain customer contact, location and financial information.
Publishing this prototype admits every authenticated/anonymous device to the
shared history. This access change must be reviewed and confirmed before the
console Publish action. No rule has yet been published by this change.

Schema/size checks and immutable history restrict writes, but do not establish
employee identity. Employee-only membership is a separate authorization change;
do not describe the current anonymous audience as staff-only or securely private.

1. Before publishing, recheck that the console's active rules match the retained
   backup and confirm the exact project ID. Preserve any intervening changes.
2. Review and confirm the access scope above immediately before publishing.
3. Revalidate if the reviewed rules change. The current combined rules passed
   nine local Firestore emulator tests covering denied unauthenticated requests,
   invalid creates and updates, identity spoofing, oversized data, cross-device
   reads, tombstones, own-device backups, immutable history, exact retries,
   history ordering queries and preservation of the existing reservation rule.
4. Publish the frontend after the new collections are accessible. Verify that a
   fresh client can read them, and that an authenticated test transaction follows
   the intended rules before migrating business data.
5. Refresh the computer containing `103호1504` first. Each refreshed computer
   uploads its missing local vehicles and original backup, then follows the same
   live server catalog. Refresh the remaining computers too.
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

The combined application suite passes 49 tests after incorporating the already
deployed phone-capture/PDF layouts. Run the rule tests with:

```sh
npx -y firebase-tools@latest emulators:exec --only firestore --project demo-ky-shared --config firebase/emulator-test.config.json 'node --test firebase/shared-rules.test.mjs'
```

The script refuses any host except the named local demo emulator. The rules
bound snapshot JSON as opaque strings; the client parses it without evaluating
code and discards invalid serialized history. Rules do not validate JSON's
nested business fields. Original reservation documents are not re-encoded.
