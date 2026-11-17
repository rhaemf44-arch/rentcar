// The same server-managed staff account controls database and SMS access.
export async function approvedStaffAccount(uid: string, token: string, fetcher: typeof fetch = fetch) {
  if (!uid || !token) return false;
  const response = await fetcher('https://firestore.googleapis.com/v1/projects/ky-rent-system/databases/(default)/documents/staffAccounts/' + encodeURIComponent(uid), {
    headers: {Authorization: 'Bearer ' + token}, signal: AbortSignal.timeout(6000)
  });
  if (response.status === 403 || response.status === 404) return false;
  if (!response.ok) throw new Error('staff account lookup');
  return (await response.json()).fields?.enabled?.booleanValue === true;
}
