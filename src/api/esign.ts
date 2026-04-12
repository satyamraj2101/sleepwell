import { AxiosInstance } from "axios";
import { ESignStatusResponse, ApiResponse, SendESignPayload } from "@/types";

/**
 * Fetches the eSignature trail and recipient status for a specific contract/request.
 */
export async function getESignStatus(
  client: AxiosInstance,
  tenant: string,
  params: { contractId: number; requestId: number; requestorUsername: string }
): Promise<ESignStatusResponse> {
  // GET /api/integreonpg/v1/contracteSign
  const res = await client.get(`/api/${tenant}/v1/contracteSign`, { params });
  return res.data;
}

/**
 * Submits a contract for eSignature.
 * Uses FormData as per platform requirements for multipart/form-data payload.
 */
export async function sendESignRequest(
  client: AxiosInstance,
  tenant: string,
  payload: SendESignPayload
): Promise<ApiResponse<string>> {
  const formData = new FormData();
  
  formData.append("RequestId", String(payload.RequestId));
  formData.append("ContractId", String(payload.ContractId));
  formData.append("ContractVersionId", String(payload.ContractVersionId));
  formData.append("RequestorUsername", payload.RequestorUsername);
  
  if (payload.Subject) formData.append("Subject", payload.Subject);
  if (payload.Message) formData.append("Message", payload.Message);
  
  // Boolean flags with defaults
  formData.append("IsDraft", String(payload.IsDraft ?? false));
  formData.append("ShouldBeSanitized", String(payload.ShouldBeSanitized ?? false));
  formData.append("isContractFileHasComment", String(payload.isContractFileHasComment ?? false));
  formData.append("GenerateRecipientViewer", String(payload.GenerateRecipientViewer ?? false));
  formData.append("AddApprovalAuditHistory", String(payload.AddApprovalAuditHistory ?? false));
  formData.append("OnlyIncludeLatestVersionApprovals", String(payload.OnlyIncludeLatestVersionApprovals ?? false));
  
  if (payload.EmailTemplateId) formData.append("EmailTemplateId", payload.EmailTemplateId);
  if (payload.SupportingDocumentIds) formData.append("SupportingDocumentIds", payload.SupportingDocumentIds);
  
  formData.append("SigningSystemAccountId", String(payload.SigningSystemAccountId ?? 1));

  // Recipients indexing: Recipients[0].Name, Recipients[0].EmailId, etc.
  payload.Recipients.forEach((r, i) => {
    formData.append(`Recipients[${i}].Name`, r.Name);
    formData.append(`Recipients[${i}].EmailId`, r.EmailId);
    formData.append(`Recipients[${i}].Order`, String(r.Order));
    formData.append(`Recipients[${i}].TemplateForm`, String(r.TemplateForm ?? false));
    formData.append(`Recipients[${i}].IncludeApprovalHistory`, String(r.IncludeApprovalHistory ?? false));
  });

  // Document Order indexing: documentOrder[0].Id, documentOrder[0].Type
  payload.documentOrder.forEach((d, i) => {
    formData.append(`documentOrder[${i}].Id`, String(d.Id));
    formData.append(`documentOrder[${i}].Type`, d.Type);
  });

  // POST /api/integreonpg/v1/contracteSign
  const res = await client.post(`/api/${tenant}/v1/contracteSign`, formData);
  return res.data;
}
