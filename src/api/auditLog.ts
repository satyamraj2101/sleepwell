import { AxiosInstance } from "axios";
import { AuditLogEntry, AuditLogRequest } from "@/types";

export async function queryAuditLog(
  client: AxiosInstance,
  tenant: string,
  body: AuditLogRequest
): Promise<{ data: AuditLogEntry[]; totalRecords: number }> {
  const res = await client.post(`/api/${tenant}/AuditLog`, body);
  return res.data;
}
