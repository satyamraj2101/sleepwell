import { AxiosInstance } from "axios";
import { PreExecutionApprovalResponse } from "@/types";

export async function getPreExecutionApprovals(
  client: AxiosInstance,
  tenant: string,
  requestId: number
): Promise<PreExecutionApprovalResponse> {
  const res = await client.get<PreExecutionApprovalResponse>(
    `/api/${tenant}/contractapproval/preexecution/${requestId}`
  );
  return res.data;
}

export async function getPreExecutionStatus(
  client: AxiosInstance,
  tenant: string,
  requestId: number
): Promise<unknown> {
  const res = await client.get(`/api/${tenant}/contractapproval/preexecutionstatus/${requestId}`);
  return res.data;
}

export async function isUpcomingApprovalEnabled(
  client: AxiosInstance,
  tenant: string
): Promise<boolean> {
  const res = await client.get<boolean>(
    `/api/${tenant}/contractapproval/is-upcomingapproval-feature-enable`
  );
  return res.data;
}
