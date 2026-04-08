import { createAuthClient } from "./leahClient";
import { AuthTokenResponse } from "@/types";

export async function fetchToken(
  cloudInstance: string,
  tenant: string,
  username: string,
  password: string
): Promise<AuthTokenResponse> {
  const client = createAuthClient(cloudInstance);
  // POST JSON directly to https://{cloudInstance}/cpaimt_auth/auth/token
  let res;
  try {
    res = await client.post(`/auth/token`, {
      grant_type: "password",
      username,
      password,
      domain: tenant,
    });
  } catch (err: any) {
    // Extract the most useful error message from the server response
    const body = err.response?.data;
    const detail =
      body?.error_description ||
      body?.error ||
      body?.message ||
      body?.detail ||
      body?.Detail ||
      (typeof body === "string" ? body : null) ||
      err.message;
    throw new Error(detail ?? "Auth request failed");
  }
  // Leah API may wrap the response in { data: { access_token, ... }, statusCode: 200 }
  const tokenData: AuthTokenResponse = (res.data as any)?.data ?? res.data;
  if (!tokenData.access_token) {
    throw new Error("No access_token in response — check credentials");
  }
  return tokenData;
}

export async function refreshToken(
  cloudInstance: string,
  tenant: string,
  clientId: string,
  refreshTokenValue: string
): Promise<AuthTokenResponse> {
  const client = createAuthClient(cloudInstance);
  const res = await client.post(`/auth/token`, {
    grant_type: "refresh_token",
    domain: tenant,
    client_id: clientId,
    refresh_token: refreshTokenValue,
  });
  const tokenData: AuthTokenResponse = (res.data as any)?.data ?? res.data;
  return tokenData;
}
