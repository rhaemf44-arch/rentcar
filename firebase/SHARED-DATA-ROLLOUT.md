# Shared reservation-management data

Project: `ky-rent-system`, the existing default Firestore database.

The deployed reservation collection already synchronizes all reservation fields,
including finances, insurance, dispatch and return locations, SMS fallback data,
status, and recoverable deletions. This change adds the remaining local business
catalogs without changing reservation documents or the print layout.

| Collection | Contents | Migration |
| --- | --- | --- |
| `vehicles/{plate}` | Name, seats, fuel, group, deletion tombstone | Create only missing documents from each browser's existing fleet. |
| `vehicleMigrations/{anonymousUid}` | Original local fleet for recovery | Immutable backup captured before the fleet migration is marked complete. |
| `reservationHistory/{id}` | Existing Kakao change history and future entries | Create only missing entries. Existing history remains immutable. |

## Deployment dependency

Verified on 2026-11-17: a normal authenticated client can read `reservations`.
The same authenticated client receives `PERMISSION_DENIED` for `vehicles`,
`reservationHistory`, and `settings/fleet`. Backend rule deployment therefore
requires authenticated access to the owner's Firebase project. Installing the
ChatGPT Firebase plugin alone does not prove project access.

1. Read and retain the currently deployed Firestore rules through the connected
   Firebase project. Confirm the exact project ID before any write.
2. Author narrowly scoped collection rules using the schema and operations
   above, inside the existing documents block. Preserve reservation and other
   existing matches and reuse the project's actual staff authorization predicate.
   History contains private reservation data and must stay within that staff
   audience. No deployable rule replacement is included before that review.
3. Validate the combined rules, including unauthorized requests, invalid fleet
   records, cross-device reads, tombstones, immutable history, and exact retries.
   Publish only the reviewed, validated combined rules.
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
