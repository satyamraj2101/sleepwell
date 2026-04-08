import { AxiosInstance } from "axios";
import {
  ContractListItem,
  ContractDetail,
  UpdateContractPayload,
  IntakeFormFieldGroup,
  IntakeFormField,
  ApiResponse,
  PaginatedResponse,
} from "@/types";

// GET /api/{tenant}/contract-request
// IMPORTANT: Do NOT pass RequesterUserName — it filters to only that user's contracts
export interface ContractListParams {
  ApplicationTypeId?: number;
  PageNumber?: number;
  PageSize?: number;
  RequestIdSearch?: string;
  WorkflowStage?: string;
  LegalPartyId?: number;
  LegalPartyName?: string;
  ExternalId?: string;
  IntegrationId?: string;
  HasFinalStatus?: boolean;
  IncludeArchived?: boolean;
  AssignToUserId?: number;
  AddedById?: number;
  ContractPriority?: boolean;
  Search?: string;
  OrderBy?: string;
  Direction?: boolean;
}

export async function listContracts(
  client: AxiosInstance,
  tenant: string,
  params: ContractListParams
): Promise<PaginatedResponse<ContractListItem>> {
  const queryParams: Record<string, unknown> = {
    ApplicationTypeId: params.ApplicationTypeId,
    PageNumber: params.PageNumber ?? 1,
    PageSize: params.PageSize ?? 50,
  };

  if (params.RequestIdSearch) {
    queryParams.RequestIdSearch = params.RequestIdSearch;
    queryParams.Search = params.RequestIdSearch;
  } else if (params.Search) {
    queryParams.Search = params.Search;
  }
  if (params.WorkflowStage)                      queryParams.WorkflowStage    = params.WorkflowStage;
  if (params.LegalPartyId)                        queryParams.LegalPartyId     = params.LegalPartyId;
  if (params.LegalPartyName)                      queryParams.LegalPartyName   = params.LegalPartyName;
  if (params.HasFinalStatus !== undefined)        queryParams.HasFinalStatus   = params.HasFinalStatus;
  if (params.IncludeArchived)                     queryParams.IncludeArchived  = params.IncludeArchived;
  if (params.AssignToUserId)                      queryParams.AssignToUserId   = params.AssignToUserId;
  if (params.AddedById)                           queryParams.AddedById        = params.AddedById;
  if (params.OrderBy)                             queryParams.OrderBy          = params.OrderBy;
  if (params.Direction !== undefined)             queryParams.Direction        = params.Direction;
  if (params.ExternalId)                          queryParams.ExternalId       = params.ExternalId;
  if (params.IntegrationId)                       queryParams.IntegrationId    = params.IntegrationId;

  const res = await client.get<any>(
    `/api/${tenant}/contract-request`,
    { params: queryParams }
  );
  
  // Standard Leah v1.9: { data: { data: [], totalRecords: 8 }, statusCode: 200 }
  // Falling back to direct data or results properties
  const root = res.data?.data ?? res.data;
  const list = Array.isArray(root?.data) ? root.data : 
              (Array.isArray(root?.results) ? root.results : 
              (Array.isArray(root) ? root : []));

  const total = root?.totalRecords ?? 
                root?.totalCount ?? 
                res.data?.totalRecords ?? 
                list.length;

  return {
    data: list,
    totalRecords: total,
    pageNumber: queryParams.PageNumber as number,
    pageSize: queryParams.PageSize as number
  };
}

// GET /api/{tenant}/contract-request/{id}
export async function getContractDetail(
  client: AxiosInstance,
  tenant: string,
  requestId: number
): Promise<ContractDetail> {
  const res = await client.get<any>(
    `/api/${tenant}/contract-request/${requestId}`
  );
  // Multi-layer unwrapping
  let root = res.data;
  if (root?.data && !Array.isArray(root.data)) root = root.data;
  if (root?.results && !Array.isArray(root.results)) root = root.results;
  
  return root?.data ?? root?.results ?? root;
}

// PUT /api/{tenant}/contract-request/{id}
export async function updateContract(
  client: AxiosInstance,
  tenant: string,
  requestId: number,
  payload: UpdateContractPayload
): Promise<ApiResponse<number>> {
  const res = await client.put<ApiResponse<number>>(
    `/api/${tenant}/contract-request/${requestId}`,
    payload
  );
  return res.data;
}

// POST /api/{tenant}/contract-request
export async function createContract(
  client: AxiosInstance,
  tenant: string,
  payload: Omit<UpdateContractPayload, "id"> & { id: 0 }
): Promise<ApiResponse<number>> {
  const res = await client.post<ApiResponse<number>>(
    `/api/${tenant}/contract-request`,
    payload
  );
  return res.data;
}

// Normalize a single intake field — handle ALL formats the API might return options in
function normalizeIntakeField(f: any): IntakeFormField {
  let selectOptions: Record<string, string> | null = f.selectOptions ?? null;

  // Format 2: options as array — swagger shows FieldOptions uses optionId + optionName,
  // ApplicationTypeMetadataOption uses id + value. Cover all known shapes.
  if (!selectOptions || Object.keys(selectOptions).length === 0) {
    const arr = f.fieldOptions ?? f.options ?? f.dropdownOptions ?? f.fieldValues ?? f.selectValues;
    if (Array.isArray(arr) && arr.length > 0) {
      selectOptions = {};
      arr.forEach((o: any) => {
        if (typeof o === "string") {
          selectOptions![o] = o;
          return;
        }
        // Swagger FieldOptions shape: { optionId, optionName, optionOrderId }
        // Swagger ApplicationTypeMetadataOption shape: { id, value, isDefault, fieldId }
        // Other observed shapes: { fieldOptionId, fieldOptionValue }, { key, label }, { value, label }
        const key = String(
          o.optionId       ??  // FieldOptions (swagger)
          o.fieldOptionId  ??  // our FieldOption type
          o.id             ??  // ApplicationTypeMetadataOption (swagger)
          o.key            ??
          o.value          ??
          ""
        );
        const label =
          o.optionName        ||  // FieldOptions (swagger)
          o.fieldOptionValue  ||  // our FieldOption type
          o.value             ||  // ApplicationTypeMetadataOption (swagger)
          o.label             ||
          o.displayName       ||
          o.name              ||
          key;
        if (key) selectOptions![key] = label || key;
      });
      if (Object.keys(selectOptions).length === 0) selectOptions = null;
    }
  }

  return { ...f, selectOptions };
}

function normalizeIntakeGroups(groups: any[]): IntakeFormFieldGroup[] {
  return groups.map((g: any) => ({
    ...g,
    sections: (g.sections ?? []).map((s: any) => ({
      ...s,
      fields: (s.fields ?? []).map(normalizeIntakeField),
    })),
    // Some API versions put fields directly on the group
    fields: Array.isArray(g.fields) ? g.fields.map(normalizeIntakeField) : undefined,
  }));
}

// GET /api/{tenant}/application-type/intake-form-field-groups
// ALWAYS pass SkipFieldOptions=false to get dropdown values
export async function getIntakeFormFields(
  client: AxiosInstance,
  tenant: string,
  applicationTypeId: number,
  groupType?: string
): Promise<IntakeFormFieldGroup[]> {
  const res = await client.get(`/api/${tenant}/application-type/intake-form-field-groups`, {
    params: {
      ApplicationTypeId: applicationTypeId,
      SkipFieldOptions: false,  // CRITICAL — ensures selectOptions are returned
      GroupType: groupType,
    },
  });
  const data = res.data?.data ?? res.data;
  const groups = Array.isArray(data) ? data : [];
  return normalizeIntakeGroups(groups);
}

// POST /api/{tenant}/contract-request/search (Elasticsearch)
export async function searchContracts(
  client: AxiosInstance,
  tenant: string,
  body: {
    filter: {
      applicationId?: number;
      pageNumber?: number;
      pageSize?: number;
      search?: string;
      fieldGroup?: unknown;
    };
    sort?: unknown[];
  }
): Promise<PaginatedResponse<ContractListItem>> {
  const res = await client.post<PaginatedResponse<ContractListItem>>(
    `/api/${tenant}/contract-request/search`,
    body
  );
  return res.data;
}

// GET /api/{tenant}/contract-request/action-taken/{requestId}
export async function getActionTaken(
  client: AxiosInstance,
  tenant: string,
  requestId: number
): Promise<boolean> {
  const res = await client.get<boolean>(
    `/api/${tenant}/contract-request/action-taken/${requestId}`
  );
  return res.data;
}

// Build the update payload from a fetched ContractDetail + edited fields
export function buildUpdatePayload(
  detail: ContractDetail,
  editedFields: Record<number, string>,
  editedDescription: string | undefined,
  username: string
): UpdateContractPayload {
  const customFields: Array<{ customFieldId: number; customFieldValue: string }> = [];
  (detail.customFieldGroups ?? []).forEach((g) =>
    (g.customFields ?? []).forEach((f) => {
      const val = editedFields[f.customFieldId] !== undefined ? editedFields[f.customFieldId] : f.customFieldValue;
      if (val !== null && val !== undefined && val !== "") {
        customFields.push({ customFieldId: f.customFieldId, customFieldValue: String(val) });
      }
    })
  );

  return {
    id: detail.id,
    applicationTypeId: detail.applicationTypeId,
    recordId: detail.recordId ?? 0,
    isUploadedContract: detail.isUploadedContract ?? false,
    assignees: (detail.assignees ?? []).map((a) => ({
      userId: a.userId,
      departmentId: a.departmentId,
      functionId: a.functionId ?? null,
      isPrimary: a.isPrimary ?? true,
    })),
    requesterUser: {
      UserId: (detail.requesterUser as any)?.userId || (detail as any).requestorId || (detail as any).addedById || 0,
      DepartmentId: (detail.requesterUser as any)?.departmentId || (detail as any).requesterDepartmentId || 1,
    },
    legalParties: (detail.legalParties ?? []).map((lp) => ({
      legalPartyId: lp.legalPartyId,
      isPrimary: lp.isPrimary ?? true,
    })),
    contractPriority: detail.contractPriority ?? { priority: false, priorityReason: "" },
    recordClassificationId: detail.recordClassificationId ?? 0,
    integrationId: detail.integrationId ?? [],
    clients: (detail.clients ?? []).map((c) => ({
      clientId: c.clientId,
      isPrimary: c.isPrimary ?? true,
      addressDetailId: c.addressDetailId ?? null,
      contactNumberDetailId: c.contactNumberDetailId ?? null,
      emailDetailId: c.emailDetailId ?? null,
      contactNameDetailId: c.contactNameDetailId ?? null,
      roleId: c.roleId ?? null,
      customFields: c.customFields ?? [],
    })),
    requestorUsername: username,
    description: editedDescription ?? detail.description ?? "",
    isConfidential: detail.isConfidential ?? false,
    skipCustomFields: false,
    skipClientCustomFields: true,
    confidentialRecords: detail.confidentialRecords ?? [],
    customFields,
  };
}

// POST /api/{tenant}/contract-request/bulk-update-stage
export async function bulkUpdateStage(
  client: AxiosInstance,
  tenant: string,
  payload: { requestId: number[]; workflowStageId: number }
): Promise<ApiResponse<string>> {
  const res = await client.post<ApiResponse<string>>(
    `/api/${tenant}/contract-request/bulk-update-stage`,
    payload
  );
  return res.data;
}

