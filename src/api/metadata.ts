import { AxiosInstance } from "axios";
import {
  FieldDefinition,
  FieldOption,
  FieldTypeInfo,
  CreateFieldOptionPayload,
  AddUpdateFieldPayload,
} from "@/types";

export interface FieldListParams {
  fieldId?: number;
  fieldType?: string;
  fieldName?: string;
  fieldDisplayName?: string;
  applicationTypeId?: number;
  applicationId?: number;
  metadataType?: string | number;
  pageIndex?: number;
  pageSize?: number;
  sortBy?: string;
  sortDescending?: boolean;
  showOptions?: boolean;
}

// GET /api/{tenant}/application-type-metadata/list
export async function listFieldDefinitions(
  client: AxiosInstance,
  tenant: string,
  params?: FieldListParams
): Promise<{ data: FieldDefinition[]; totalRecords: number }> {
  const res = await client.get(`/api/${tenant}/application-type-metadata/list`, {
    params: {
      PageIndex: params?.pageIndex ?? 1,
      PageSize: params?.pageSize ?? 100,
      ShowOptions: params?.showOptions ?? true,
      ...(params?.applicationTypeId && { ApplicationTypeId: params.applicationTypeId }),
      ...(params?.fieldType && { FieldType: params.fieldType }),
      ...(params?.fieldName && { FieldName: params.fieldName }),
      ...(params?.fieldDisplayName && { FieldDisplayName: params.fieldDisplayName }),
      ...(params?.metadataType && { MetadataType: params.metadataType }),
    },
  });
  // Leah New Cloud API wraps: { data: { data: [...], totalRecords: N }, statusCode: 200 }
  const root = res.data?.data ?? res.data;
  const rawItems: any[] = Array.isArray(root?.data) ? root.data : (Array.isArray(root) ? root : []);
  const totalRecords: number = root?.totalRecords ?? root?.totalCount ?? rawItems.length;

  const items: FieldDefinition[] = rawItems.map((f: any) => {
    // Swagger: ApplicationTypeMetadataResponse uses these property names:
    //   id / fieldId, displayName / fieldDisplayName, fieldTypeName / fieldType, fieldTypeId
    const fieldId: number = f.fieldId ?? f.id ?? 0;
    const fieldDisplayName: string = f.fieldDisplayName ?? f.displayName ?? f.fieldName ?? "";
    const fieldType: string = f.fieldType ?? f.fieldTypeName ?? f.type ?? f.FieldType ?? "";
    const fieldTypeId: number | undefined = f.fieldTypeId ?? undefined;

    // Swagger: ApplicationTypeMetadataOption uses id + value (not fieldOptionId + fieldOptionValue)
    const options: FieldOption[] = (f.options ?? []).map((o: any) => ({
      fieldOptionId:      o.fieldOptionId ?? o.id ?? 0,
      fieldOptionValue:   o.fieldOptionValue ?? o.value ?? o.optionName ?? o.name ?? "",
      isDefault:          o.isDefault ?? false,
      isActive:           o.isActive ?? true,
      parentId:           o.parentId ?? null,
      numericValue:       o.numericValue ?? null,
      fieldOptionOrderId: o.fieldOptionOrderId ?? o.optionOrderId ?? 0,
    }));

    return {
      ...f,
      fieldId,
      fieldDisplayName,
      fieldType,
      fieldTypeId,
      isRequired:    f.isRequired ?? f.isMandatoryField ?? false,
      isMandatoryField: f.isMandatoryField ?? f.isRequired ?? false,
      options: options.length > 0 ? options : (f.options ?? []),
    };
  });

  return { data: items, totalRecords };
}

// GET /api/{tenant}/application-type-metadata/{id}
export async function getFieldById(
  client: AxiosInstance,
  tenant: string,
  id: number
): Promise<FieldDefinition> {
  const res = await client.get(`/api/${tenant}/application-type-metadata/${id}`);
  const raw = res.data?.data ?? res.data;
  const f = raw;
  return {
    ...f,
    fieldId:            f.fieldId ?? f.id ?? id,
    fieldDisplayName:   f.fieldDisplayName ?? f.displayName ?? f.fieldName ?? "",
    fieldType:          f.fieldType ?? f.fieldTypeName ?? "",
    fieldTypeId:        f.fieldTypeId ?? undefined,
    fieldGroupId:       f.fieldGroupId ?? undefined,
    isRequired:         f.isRequired ?? f.isMandatoryField ?? false,
    isMandatoryField:   f.isMandatoryField ?? f.isRequired ?? false,
    isActive:           f.isActive ?? true,
    isVisible:          f.isVisible ?? false,
    isVisibleOnRequestDetails: f.isVisibleOnRequestDetails ?? false,
    displayInRequestJourney:   f.displayInRequestJourney ?? false,
    displayInRequestDetails:   f.displayInRequestDetails ?? false,
    guidanceText:              f.guidanceText ?? "",
    comments:                  f.comments ?? "",
    defaultValue:              f.defaultValue ?? null,
    metadataExtractionPromptId: f.metadataExtractionPromptId ?? null,
    calculatedFieldUnit:       f.calculatedFieldUnit ?? 0,
    calculationOutputDecimals: f.calculationOutputDecimals ?? null,
    decimalPointNumber:        f.decimalPointNumber ?? null,
    applicationTypeMandatoryData: f.applicationTypeMandatoryData ?? [],
    options: (f.options ?? []).map((o: any) => ({
      fieldOptionId:      o.fieldOptionId ?? o.id ?? 0,
      fieldOptionValue:   o.fieldOptionValue ?? o.value ?? "",
      isDefault:          o.isDefault ?? false,
      isActive:           o.isActive ?? true,
      parentId:           o.parentId ?? null,
      numericValue:       o.numericValue ?? null,
      fieldOptionOrderId: o.fieldOptionOrderId ?? 0,
    })),
  };
}

// GET /api/{tenant}/application-type-metadata/field-types
export async function listFieldTypes(
  client: AxiosInstance,
  tenant: string,
  metadataType?: string | number
): Promise<FieldTypeInfo[]> {
  const res = await client.get(`/api/${tenant}/application-type-metadata/field-types`, {
    params: metadataType ? { metaDataType: metadataType } : undefined,
  });
  const raw = res.data?.data ?? res.data ?? [];
  const arr: any[] = Array.isArray(raw) ? raw : [];

  // Swagger: ApplicationMetaDataTypeFieldTypeResponseModel — fieldTypeId + fieldTypeName
  return arr.map((ft: any) => ({
    fieldTypeId:   ft.fieldTypeId ?? ft.id ?? ft.fieldType ?? 0,
    fieldTypeName: ft.fieldTypeName ?? ft.name ?? ft.displayName ?? ft.fieldType ?? "",
  }));
}

// POST /api/{tenant}/application-type-metadata/field-options
export async function addFieldOption(
  client: AxiosInstance,
  tenant: string,
  payload: CreateFieldOptionPayload
): Promise<number> {
  const res = await client.post(`/api/${tenant}/application-type-metadata/field-options`, payload);
  return res.data?.data ?? res.data;
}

// DELETE /api/{tenant}/application-type-metadata/field-options/{id}
export async function deleteFieldOption(
  client: AxiosInstance,
  tenant: string,
  optionId: number
): Promise<void> {
  await client.delete(`/api/${tenant}/application-type-metadata/field-options/${optionId}`);
}

// PUT /api/{tenant}/application-type-metadata/field-options/{id}/set-default
// (some API versions use a different endpoint — try both)
export async function setDefaultFieldOption(
  client: AxiosInstance,
  tenant: string,
  optionId: number,
  fieldId: number
): Promise<void> {
  // Try patch-style update by re-POSTing the option with isDefault: true
  await client.put(
    `/api/${tenant}/application-type-metadata/field-options/${optionId}`,
    { id: optionId, fieldId, isDefault: true, isActive: true }
  );
}

// POST /api/{tenant}/application-type-metadata — create field
export async function createFieldDefinition(
  client: AxiosInstance,
  tenant: string,
  payload: AddUpdateFieldPayload
): Promise<number> {
  const res = await client.post(`/api/${tenant}/application-type-metadata`, payload);
  return res.data?.data ?? res.data;
}

// PUT /api/{tenant}/application-type-metadata — update field
export async function updateFieldDefinition(
  client: AxiosInstance,
  tenant: string,
  payload: AddUpdateFieldPayload
): Promise<void> {
  await client.put(`/api/${tenant}/application-type-metadata`, payload);
}

// DELETE /api/{tenant}/application-type-metadata/{id}
export async function deleteFieldDefinition(
  client: AxiosInstance,
  tenant: string,
  id: number
): Promise<void> {
  await client.delete(`/api/${tenant}/application-type-metadata/${id}`);
}

// GET /api/{tenant}/application-type-metadata/legalparty/fields
export async function listLegalPartyFields(
  client: AxiosInstance,
  tenant: string,
  params?: FieldListParams
): Promise<{ data: FieldDefinition[] }> {
  const res = await client.get(`/api/${tenant}/application-type-metadata/legalparty/fields`, {
    params: {
      PageIndex: params?.pageIndex ?? 1,
      PageSize: params?.pageSize ?? 100,
      ...(params?.applicationTypeId && { ApplicationTypeId: params.applicationTypeId }),
    },
  });
  return res.data;
}

/**
 * Fetch condition filters (visibility rules) for metadata fields.
 */
export async function getConditionFilters(
  client: AxiosInstance,
  tenant: string
): Promise<any[]> {
  const res = await client.get(`api/${tenant}/v1/condition-filters`, {
    params: {
      skipLoadingFieldOptions: true,
      showAllKLO: false,
      forRequestStatus: true
    },
    headers: {
      'tenant': tenant,
      'x-tenant-name': tenant
    }
  });
  return res.data?.data ?? res.data ?? [];
}

/**
 * Fetch the master list of field types and their IDs.
 */
export async function getMetaDataFieldTypes(
  client: AxiosInstance,
  tenant: string
): Promise<any[]> {
  const res = await client.get(`api/${tenant}/v1/applicationTypeMetaData/metaDataFieldType/list`, {
    params: { metaDataTypeId: "ApplicationTypeRequestForm" }
  });
  return res.data?.data ?? res.data ?? [];
}

/**
 * Fetch the list of fields specifically identified as numeric/currency.
 */
export async function getNumericCustomFields(
  client: AxiosInstance,
  tenant: string,
  requestorUsername: string
): Promise<any[]> {
  const res = await client.get(`api/${tenant}/v1/applicationtypemetadata/getnumericcustomfields`, {
    params: { requestorUsername }
  });
  return res.data?.data ?? res.data ?? [];
}

/**
 * GET /api/{tenant}/v1/applicationtypemetadata/getbyid/{id}
 * Uses the OLD PROD API to get full field detail (includes all edit fields)
 */
export async function getFieldDetailOldProd(
  client: AxiosInstance,
  tenant: string,
  fieldId: number,
  requestorUsername: string
): Promise<any> {
  const res = await client.get(
    `/api/${tenant}/v1/applicationtypemetadata/getbyid/${fieldId}`,
    { 
      params: { requestorUsername },
      headers: {
        'tenant': tenant,
        'x-tenant-name': tenant
      }
    }
  );
  return res.data?.data ?? res.data;
}

/**
 * PUT /api/{tenant}/v1/applicationtypemetadata/{id}
 * Uses the OLD PROD API to update a field definition.
 * The payload must include: id, displayName, fieldName, fieldType (numeric),
 * isActive (1/0), options[], applicationTypeMandatoryData[], requestorUsername, etc.
 */
export async function updateFieldOldProd(
  client: AxiosInstance,
  tenant: string,
  fieldId: number,
  payload: Record<string, any>
): Promise<any> {
  const res = await client.put(
    `/api/${tenant}/v1/applicationtypemetadata/${fieldId}`,
    payload,
    {
      headers: {
        'tenant': tenant,
        'x-tenant-name': tenant
      }
    }
  );
  return res.data?.data ?? res.data;
}
