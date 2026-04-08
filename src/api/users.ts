import { AxiosInstance } from "axios";
import { LeahUser, PaginatedResponse } from "@/types";

export interface UserListParams {
  pageNo?: number;
  perPage?: number;
  search?: string;
  departmentId?: number;
  roleId?: number;
  licenseId?: number;
  userId?: number;
  applicationTypeId?: number;
  forAssignment?: boolean;
  includeCustomFields?: boolean;
  requestorUsername?: string;
}

// GET /api/{tenant}/v1/user — Old Prod API
export async function listUsers(
  client: AxiosInstance,
  tenant: string,
  params: UserListParams & { requestorUsername: string }
): Promise<PaginatedResponse<LeahUser>> {
  const queryParams = {
    "filter.pageNo": params.pageNo ?? 1,
    "filter.perPage": params.perPage ?? 100,
    "filter.requestorUsername": params.requestorUsername,
    ...(params.search && { "filter.search": params.search }),
    ...(params.departmentId && { "filter.departmentId": params.departmentId }),
    ...(params.roleId && { "filter.roleId": params.roleId }),
    ...(params.licenseId && { "filter.licenseId": params.licenseId }),
    ...(params.userId && { "filter.userId": params.userId }),
  };

  const res = await client.get(`/api/${tenant}/v1/user`, { params: queryParams });
  const raw = res.data;

  // Handle: array, { data: [] }, { data: { data: [], totalRecords: N } }
  let items: LeahUser[];
  let totalRecords: number;

  if (Array.isArray(raw)) {
    items = raw;
    totalRecords = raw.length;
  } else {
    const inner = raw?.data ?? raw;
    if (Array.isArray(inner)) {
      items = inner;
      totalRecords = raw?.totalRecords ?? raw?.totalCount ?? inner.length;
    } else {
      // Double-wrapped: { data: { data: [...], totalRecords: N } }
      items = Array.isArray(inner?.data) ? inner.data : (Array.isArray(inner?.items) ? inner.items : []);
      totalRecords = inner?.totalRecords ?? inner?.totalCount ?? items.length;
    }
  }

  return { data: items, totalRecords, pageNumber: params.pageNo ?? 1, pageSize: params.perPage ?? 100 };
}

const USER_PAGE_SIZE = 200;

/**
 * Robust helper to fetch ALL users across ALL pages.
 * Terminates when a page returns fewer items than the page size (last page),
 * OR when a reliable totalRecords value is reached.
 * Handles APIs that return a plain array (no totalRecords) gracefully.
 */
export async function fetchAllUsers(
  client: AxiosInstance,
  tenant: string,
  requestorUsername: string,
  departmentId?: number,
  onProgress?: (fetched: number, total: number) => void
): Promise<LeahUser[]> {
  let allUsers: LeahUser[] = [];
  let page = 1;

  while (true) {
    const res = await listUsers(client, tenant, {
      pageNo: page,
      perPage: USER_PAGE_SIZE,
      requestorUsername,
      departmentId,
    });

    if (res.data.length === 0) break;

    allUsers = [...allUsers, ...res.data];

    // Estimate total: prefer the API-reported total, fall back to what we have so far
    const knownTotal = res.totalRecords > USER_PAGE_SIZE ? res.totalRecords : Math.max(res.totalRecords, allUsers.length);
    if (onProgress) onProgress(allUsers.length, knownTotal);

    // Stop when last page (page returned fewer items than requested)
    if (res.data.length < USER_PAGE_SIZE) break;

    // Stop when API-reported total is reliable and we've fetched enough
    if (res.totalRecords > USER_PAGE_SIZE && allUsers.length >= res.totalRecords) break;

    page++;
  }

  return allUsers;
}

// PUT /api/{tenant}/v1/user/{id} — Old Prod API
// Toggles email masking by adding/removing the 'x' prefix
export async function updateUser(
  client: AxiosInstance,
  tenant: string,
  userId: number,
  user: LeahUser,
  requestorUsername: string
): Promise<unknown> {
  const payload = {
    ...user,
    email: user.email,
    requestorUsername: requestorUsername
  };

  // Fix: Replace 0 with null for ID fields that the API might reject if 0
  const idFields = ['countryId', 'titleId', 'preferredTimeZoneId', 'managerId', 'preferredDateFormatId', 'organizationId', 'licenseId'];
  idFields.forEach(k => {
    if ((payload as any)[k] === 0) (payload as any)[k] = null;
  });

  const res = await client.put(`/api/${tenant}/v1/user/${userId}`, payload);
  return res.data;
}

// Mask a single user — adds 'x' prefix to email
export async function maskUserEmail(
  client: AxiosInstance,
  tenant: string,
  user: LeahUser,
  requestorUsername: string
): Promise<unknown> {
  const targetId = user.userId || user.id;
  if (user.email.startsWith("x")) return; // already masked
  return updateUser(client, tenant, targetId, {
    ...user,
    email: `x${user.email}`,
  }, requestorUsername);
}

// Unmask a single user — removes 'x' prefix from email
export async function unmaskUserEmail(
  client: AxiosInstance,
  tenant: string,
  user: LeahUser,
  requestorUsername: string
): Promise<unknown> {
  const targetId = user.userId || user.id;
  if (!user.email.startsWith("x")) return; // already unmasked
  return updateUser(client, tenant, targetId, {
    ...user,
    email: user.email.slice(1), // remove leading 'x'
  }, requestorUsername);
}

// Bulk mask/unmask — Sequential execution to prevent rate limiting (matching Node.js version)
export async function bulkToggleMask(
  client: AxiosInstance,
  tenant: string,
  users: LeahUser[],
  action: "mask" | "unmask",
  requestorUsername: string,
  onProgress?: (done: number, total: number) => void
): Promise<{ success: number; failed: number; errors: string[] }> {
  const results = { success: 0, failed: 0, errors: [] as string[] };

  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    try {
      if (action === "mask") {
        await maskUserEmail(client, tenant, user, requestorUsername);
      } else {
        await unmaskUserEmail(client, tenant, user, requestorUsername);
      }
      results.success++;
    } catch (err) {
      results.failed++;
      results.errors.push(`${user.userName}: ${err instanceof Error ? err.message : String(err)}`);
    }
    
    onProgress?.(i + 1, users.length);
    
    // Small delay between requests to be gentle on the API
    if (i < users.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  return results;
}

// GET /api/{tenant}/v1/roles
export async function listRoles(
  client: AxiosInstance,
  tenant: string,
  requestorUsername: string
): Promise<Array<{ roleId: number; roleName: string }>> {
  const res = await client.get(`/api/${tenant}/v1/roles`, {
    params: { "filter.requestorUsername": requestorUsername },
  });
  const data = res.data;
  return Array.isArray(data) ? data : (data.data ?? []);
}
