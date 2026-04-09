import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import { useApiClients } from "@/hooks/useApiClients";
import { listContracts, getContractDetail, updateContract, getIntakeFormFields, buildUpdatePayload, ContractListParams } from "@/api/contractRequest";
import { listFieldDefinitions } from "@/api/metadata";
import { QK } from "@/lib/utils";
import { IntakeFormField, FieldOption } from "@/types";

import { useAppTypes } from "@/hooks/useAppTypes";
export { useAppTypes };

export function useContracts(appTypeId: number | null, params: Omit<ContractListParams, "ApplicationTypeId">) {
  const clients = useApiClients();
  const { tenant } = useAuthStore();
  return useQuery({
    queryKey: [...QK.contracts(tenant, appTypeId ?? 0, params.PageNumber ?? 1), params],
    queryFn: () =>
      listContracts(clients!.newCloud, tenant, { 
        ...(appTypeId !== -1 && { ApplicationTypeId: appTypeId! }),
        ...params 
      }),
    enabled: !!clients && appTypeId !== null,
  });
}

export function useContractDetail(requestId: number | null) {
  const clients = useApiClients();
  const { tenant } = useAuthStore();
  return useQuery({
    queryKey: QK.contractDetail(tenant, requestId ?? 0),
    queryFn: () => getContractDetail(clients!.newCloud, tenant, requestId!),
    enabled: !!clients && !!requestId,
  });
}

// Preload intake fields when app type selected — always with SkipFieldOptions=false
export function useIntakeFields(appTypeId: number | null) {
  const clients = useApiClients();
  const { tenant } = useAuthStore();
  return useQuery({
    queryKey: QK.intakeFields(tenant, appTypeId ?? 0),
    queryFn: () => getIntakeFormFields(clients!.newCloud, tenant, appTypeId!),
    enabled: !!clients && !!appTypeId,
    staleTime: 5 * 60 * 1000,
  });
}

// Build a field ID → IntakeFormField map for dropdown lookup
export function useIntakeFieldMap(appTypeId: number | null) {
  const { data: groups } = useIntakeFields(appTypeId);
  const map: Record<number, IntakeFormField> = {};
  if (groups) {
    for (const group of groups) {
      // 1. Check for fields directly on the group
      if (Array.isArray((group as any).fields)) {
        for (const field of (group as any).fields) {
          if (field.fieldId) map[field.fieldId] = field;
        }
      }
      // 2. Check for fields inside sections
      if (Array.isArray(group.sections)) {
        for (const section of group.sections) {
          if (Array.isArray(section.fields)) {
            for (const field of section.fields) {
              if (field.fieldId) map[field.fieldId] = field;
            }
          }
        }
      }
    }
  }
  return map;
}

// Build fieldId → FieldOption[] map from metadata API (fallback for when intake fields have no options)
export function useFieldOptionsMap(appTypeId: number | null): Record<number, FieldOption[]> {
  const clients = useApiClients();
  const { tenant } = useAuthStore();
  const { data: fieldData } = useQuery({
    queryKey: [...QK.fieldDefs(tenant, appTypeId ?? undefined), "withOptions"],
    queryFn: () => listFieldDefinitions(clients!.newCloud, tenant, {
      applicationTypeId: appTypeId!,
      showOptions: true,
      pageSize: 500,
    }),
    enabled: !!clients && !!appTypeId,
    staleTime: 5 * 60 * 1000,
  });

  const map: Record<number, FieldOption[]> = {};
  if (fieldData?.data) {
    for (const field of fieldData.data) {
      if (field.options?.length) {
        map[field.fieldId] = field.options;
      }
    }
  }
  return map;
}

export function useUpdateContractMutation() {
  const qc = useQueryClient();
  const clients = useApiClients();
  const { tenant, username } = useAuthStore();

  return useMutation({
    mutationFn: async ({
      detail,
      editedFields,
      editedDescription,
    }: {
      detail: Parameters<typeof buildUpdatePayload>[0];
      editedFields: Record<number, string>;
      editedDescription?: string;
    }) => {
      if (!clients) throw new Error("Not connected");
      const payload = buildUpdatePayload(detail, editedFields, editedDescription, username);
      return updateContract(clients.newCloud, tenant, detail.id, payload);
    },
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: QK.contractDetail(tenant, variables.detail.id) });
    },
  });
}
