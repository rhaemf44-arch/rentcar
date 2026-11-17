// Run only against the named local demo emulator, never a real Firebase project.
// npx firebase-tools emulators:exec --only firestore --project demo-ky-shared \
//   --config firebase/emulator-test.config.json 'node --test firebase/shared-rules.test.mjs'
import test, {before} from 'node:test';
import assert from 'node:assert/strict';

const project = 'demo-ky-shared';
const host = process.env.FIRESTORE_EMULATOR_HOST;
if (host !== '127.0.0.1:8085') throw new Error('The local demo emulator is required');
const base = `http://${host}/v1/projects/${project}/databases/(default)/documents`;
const date = '2026-11-17T08:00:00.000Z';
const token = (uid, provider = 'password') => {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return encode({alg: 'none', typ: 'JWT'}) + '.' + encode({
    aud: project, iss: 'https://securetoken.google.com/' + project,
    sub: uid, user_id: uid, iat: now, exp: now + 3600, auth_time: now,
    firebase: {identities: {}, sign_in_provider: provider}
  }) + '.';
};
const field = value => value === null ? {nullValue: null} :
  typeof value === 'number' ? {integerValue: String(value)} :
  typeof value === 'boolean' ? {booleanValue: value} : {stringValue: value};
async function provision(uid, enabled) {
  const response = await fetch(base + '/staffAccounts/' + uid, {method: 'PATCH',
    headers: {'Content-Type': 'application/json', Authorization: 'Bearer owner'},
    body: JSON.stringify({fields: {enabled: {booleanValue: enabled}}})});
  assert.equal(response.status, 200, await response.text());
}
before(async () => {await provision('qa-device-a', true);await provision('qa-device-b', true)});
async function request(path, {uid = 'qa-device-a', method = 'GET', data, provider = 'password'} = {}) {
  const headers = {'Content-Type': 'application/json'};
  if (uid) headers.Authorization = 'Bearer ' + token(uid, provider);
  const body = data ? JSON.stringify({fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, field(v)]))}) : undefined;
  const response = await fetch(base + '/' + path, {method, headers, body});
  const message = await response.text();
  return {status: response.status, message};
}
const vehicle = (id, uid = 'qa-device-a') => ({id, n: '검수 차량', seat: '9인승', fuel: 'HEV', base: '카니발', deletedAt: null, updatedAt: date, updatedBy: uid});
const history = id => ({id, reservationId: 'qa-reservation', timestamp: date, action: 'UPDATE', changedFieldsJson: '["car"]', beforeJson: 'null', afterJson: '{}', sourceMessagesJson: '[]', updatedAt: date, updatedBy: 'qa-device-a'});
async function expect(path, options, expected) {
  const result = await request(path, options);
  assert.equal(result.status, expected, result.message);
}

test('unauthenticated collection queries and writes are denied', async () => {
  for (const collection of ['vehicles', 'reservationHistory', 'vehicleMigrations', 'reservations']) {
    await expect(collection, {uid: null}, 403);
  }
  await expect('vehicles/103호1504', {uid: null, method: 'PATCH', data: vehicle('103호1504')}, 403);
});
test('unapproved authenticated devices cannot read or write business data', async () => {
  for (const collection of ['vehicles', 'reservationHistory', 'vehicleMigrations', 'reservations']) {
    await expect(collection, {uid: 'qa-guest'}, 403);
    await expect(collection + '/qa-record', {uid: 'qa-guest'}, 403);
  }
  await expect('reservations/qa-guest', {uid: 'qa-guest', method: 'PATCH', data: {id: 'qa-guest'}}, 403);
  await expect('vehicles/127호2521', {uid: 'qa-guest', method: 'PATCH', data: vehicle('127호2521', 'qa-guest')}, 403);
  await expect('reservationHistory/qa-guest', {uid: 'qa-guest', method: 'PATCH', data: {...history('qa-guest'), updatedBy: 'qa-guest'}}, 403);
});
test('even an approved UID cannot bypass password login with an old anonymous token', async () => {
  await expect('staffAccounts/qa-device-a', {provider:'anonymous'}, 403);
  await expect('reservations', {provider:'anonymous'}, 403);
  await expect('vehicles', {provider:'anonymous'}, 403);
  await expect('reservationHistory', {provider:'anonymous'}, 403);
});
test('devices can check only their own approval and can never grant staff access', async () => {
  await expect('staffAccounts/qa-device-a', {}, 200);
  await expect('staffAccounts/qa-guest', {uid: 'qa-guest'}, 404);
  await expect('staffAccounts/qa-device-a', {uid: 'qa-guest'}, 403);
  await expect('staffAccounts', {}, 403);
  await expect('staffAccounts/qa-guest', {uid: 'qa-guest', method: 'PATCH', data: {enabled: true}}, 403);
  await expect('staffAccounts/qa-device-a', {method: 'PATCH', data: {enabled: false}}, 403);
  await expect('staffAccounts/qa-device-a', {method: 'DELETE'}, 403);
});
test('an administrator grant allows access and revocation immediately denies subsequent requests', async () => {
  await provision('qa-revoked', true);
  await expect('vehicles', {uid: 'qa-revoked'}, 200);
  await provision('qa-revoked', false);
  await expect('vehicles', {uid: 'qa-revoked'}, 403);
  await expect('reservations', {uid: 'qa-revoked'}, 403);
  await expect('reservationHistory', {uid: 'qa-revoked'}, 403);
});
test('fleet create, cross-device reads and field updates work', async () => {
  await expect('vehicles/103호1504', {method: 'PATCH', data: vehicle('103호1504')}, 200);
  await expect('vehicles/103호1504', {uid: 'qa-device-b'}, 200);
  await expect('vehicles/103호1504', {uid: 'qa-device-b', method: 'PATCH', data: {...vehicle('103호1504', 'qa-device-b'), n: '공유 이름'}}, 200);
});
test('tombstones work and hard fleet deletion is denied', async () => {
  await expect('vehicles/103호1504', {method: 'PATCH', data: {...vehicle('103호1504'), deletedAt: date}}, 200);
  await expect('vehicles/103호1504', {method: 'DELETE'}, 403);
});
test('vehicle create and update reject invalid schema, identity and oversized fields', async () => {
  const invalid = [
    {...vehicle('127호1868'), id: 'another'},
    {...vehicle('127호1868'), updatedBy: 'qa-device-b'},
    {...vehicle('127호1868'), n: ''},
    {...vehicle('127호1868'), n: 'x'.repeat(201)},
    {...vehicle('127호1868'), seat: 'x'.repeat(61)},
    {...vehicle('127호1868'), fuel: 9},
    {...vehicle('127호1868'), updatedAt: 'yesterday'},
    {...vehicle('127호1868'), role: 'admin'},
  ];
  const missing = vehicle('127호1868'); delete missing.base; invalid.push(missing);
  for (const data of invalid) await expect('vehicles/127호1868', {method: 'PATCH', data}, 403);
  await expect('vehicles/127호1868', {method: 'PATCH', data: vehicle('127호1868')}, 200);
  for (const data of invalid) await expect('vehicles/127호1868', {method: 'PATCH', data}, 403);
});
test('device backup is scoped to its creator and immutable', async () => {
  const deviceId='browser-0123456789abcdef';
  const backup = {version: 1, capturedAt: date, deviceId, rowsJson: '[]'};
  await expect('vehicleMigrations/qa-device-a/devices/browser-0123456789abcdef', {method: 'PATCH', data: backup}, 200);
  await expect('vehicleMigrations/qa-device-a/devices/browser-0123456789abcdef', {}, 200);
  await expect('vehicleMigrations/qa-device-a/devices/browser-0123456789abcdef', {uid: 'qa-device-b'}, 403);
  await expect('vehicleMigrations/qa-device-a/devices/browser-0123456789abcdef', {uid: 'qa-device-b', method: 'PATCH', data: backup}, 403);
  await expect('vehicleMigrations/qa-device-a/devices/browser-0123456789abcdef', {method: 'PATCH', data: backup}, 200);
  await expect('vehicleMigrations/qa-device-a/devices/browser-0123456789abcdef', {method: 'PATCH', data: {...backup, rowsJson: '[1]'}}, 403);
  await expect('vehicleMigrations/qa-device-a/devices/browser-0123456789abcdef', {method: 'DELETE'}, 403);
  await expect('vehicleMigrations/qa-device-b/devices/browser-0123456789abcdef', {uid: 'qa-device-b', method: 'PATCH', data: {...backup, deviceId, rowsJson: 'x'.repeat(300001)}}, 403);
});
test('history shares across signed-in devices, accepts exact retries and rejects edits', async () => {
  const row = history('qa-history');
  await expect('reservationHistory/qa-history', {method: 'PATCH', data: row}, 200);
  await expect('reservationHistory/qa-history', {uid: 'qa-device-b'}, 200);
  await expect('reservationHistory/qa-history', {method: 'PATCH', data: row}, 200);
  await expect('reservationHistory/qa-history', {method: 'PATCH', data: {...row, afterJson: 'null'}}, 403);
  await expect('reservationHistory/qa-history', {uid: 'qa-device-b', method: 'PATCH', data: {...row, updatedBy: 'qa-device-b'}}, 403);
  await expect('reservationHistory/qa-history', {method: 'DELETE'}, 403);
});
test('history rejects missing, spoofed, polluted and oversized data', async () => {
  const row = history('qa-invalid-history');
  const invalid = [
    {...row, updatedBy: 'qa-device-b'}, {...row, afterJson: 'x'.repeat(200001)},
    {...row, sourceMessagesJson: 'x'.repeat(40001)}, {...row, admin: true},
    {...row, action: 42}, {...row, timestamp: 'yesterday'},
  ];
  const missing = {...row}; delete missing.beforeJson; invalid.push(missing);
  for (const data of invalid) await expect('reservationHistory/qa-invalid-history', {method: 'PATCH', data}, 403);
});
test('history ordering/limit queries and preserved reservation behavior remain usable', async () => {
  const response = await fetch(base + ':runQuery', {
    method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + token('qa-device-b')},
    body: JSON.stringify({structuredQuery: {from: [{collectionId: 'reservationHistory'}], orderBy: [{field: {fieldPath: 'timestamp'}, direction: 'DESCENDING'}], limit: 500}})
  });
  assert.equal(response.status, 200, await response.text());
  await expect('reservations/qa-reservation', {method: 'PATCH', data: {id: 'qa-reservation', status: 'waiting'}}, 200);
  await expect('reservations/qa-reservation', {uid: 'qa-device-b'}, 200);
});
test('other collections, role escalation and nested paths remain denied', async () => {
  await expect('settings/fleet', {method: 'PATCH', data: {role: 'admin'}}, 403);
  await expect('users/qa-device-a', {method: 'PATCH', data: {role: 'admin'}}, 403);
  await expect('vehicles/103호1504/private/qa', {method: 'PATCH', data: {secret: 'test'}}, 403);
});
