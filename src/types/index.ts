// ─── Auth ─────────────────────────────────────────────────────────────────────
export interface LeahAuthConfig {
  cloudInstance: string;  // e.g. "cloud20.contractpod.com"
  newCloudApi: string;    // e.g. "cpai-productapi-pus20.azurewebsites.net"
  tenant: string;         // e.g. "pentair"
  username: string;
  password: string;
}

export interface AuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
}

// ─── Application Types ────────────────────────────────────────────────────────
export interface ApplicationType {
  applicationId: number;
  applicationName: string;
  applicationTypeId: number;
  applicationTypeName: string;
  contractTemplateName: string | null;
  stageCount: number;
  contractTemplateId: number;
  isActive: "Y" | "N";
  description: string;
  disclaimer: string;
  hasActiveWorkflow: boolean;
  isDefaultForRunAi: boolean;
  applicationStatuses: ApplicationStatus[];
}

export interface ApplicationStatus {
  statusId: number;
  statusName: string;
  sequence: number;
  isActive: boolean;
  isFinal: boolean;
}

// ─── Intake Form Fields ───────────────────────────────────────────────────────
export interface IntakeFormFieldGroup {
  groupId: number;
  groupName: string;
  groupLabel: string;
  groupType: "Custom" | "Standard";
  sortOrder: number;
  isVisible: boolean;
  isRequired: boolean;
  sections: IntakeFormSection[];
}

export interface IntakeFormSection {
  sectionName: string;
  isVisible: boolean | null;
  isRequired: boolean | null;
  isMultipleAllowed: boolean | null;
  fields: IntakeFormField[];
}

export interface IntakeFormField {
  fieldId: number;
  fieldName: string;
  displayName: string;
  ctgFieldName?: string;   // e.g. "F600072"
  fieldType: string;       // "Text", "Dropdown", "Date", "RadioButton", "Number", "MultilineText"
  isRequired: boolean;
  isVisible: boolean;
  helpText: string;
  selectOptions: Record<string, string> | null; // { "optionValue": "Display Label" }
  values?: Array<{ value: string; label: string }>;
  visibilityConditions?: VisibilityCondition[];
  visibilityCondition?: string | null; // Leah raw logic string
}

export interface VisibilityCondition {
  fieldId: number;
  fieldValue: string;
  operator: string;
}

// ─── Custom Field Group (on a contract) ──────────────────────────────────────
export interface CustomFieldGroup {
  id: number;
  name: string;
  customFields: CustomField[];
}

export interface CustomField {
  customFieldId: number;
  customFieldDisplayName: string;
  customFieldValue: string | null;
  customFieldValueId: number | null;
  customFieldHelpText: string;
  metaDataType: string;
  type: string;          // same as IntakeFormField.fieldType
  visibilityConditions: VisibilityCondition[];
}

// ─── Contract Request ─────────────────────────────────────────────────────────
export interface ContractListItem {
  id: number;
  recordId: number;
  applicationTypeId: number;
  applicationTypeName: string;
  workflowStage: string;
  requestType: string;
  addedByName: string;
  addedOn: string;
  modifiedOn: string;
  description: string;
  isConfidential: boolean;
  isUploadedContract: boolean;
  legalParties: LegalPartyRef[];
  assignees: AssigneeRef[];
  integrationId: string[];
  externalId: string | null;
}

export interface ContractDetail extends ContractListItem {
  applicationId: number;
  requestTypeId: number;
  requesterUser: RequesterUser;
  clients: ClientRef[];
  contractPriority: ContractPriority;
  recordClassificationId: number;
  confidentialRecords: ConfidentialRecord[];
  customFieldGroups: CustomFieldGroup[];
  addedById: number;
  requesterDepartmentId: number;
}

export interface ContractListResponse {
  data: ContractListItem[];
  totalRecords: number;
  pageNumber: number;
  pageSize: number;
}

// ─── Contract sub-types ───────────────────────────────────────────────────────
export interface LegalPartyRef {
  legalPartyId: number;
  name: string;
  isPrimary: boolean;
}

export interface AssigneeRef {
  userId: number;
  userName: string;
  departmentId: number;
  departmentName: string;
  functionId: number | null;
  isPrimary: boolean;
}

export interface RequesterUser {
  userId: number;
  departmentId: number;
  fullName?: string;
}

export interface ClientRef {
  clientId: number;
  clientName?: string;
  isPrimary: boolean;
  addressDetailId: number | null;
  contactNumberDetailId: number | null;
  emailDetailId: number | null;
  contactNameDetailId: number | null;
  roleId: number | null;
  customFields: Array<{ customFieldId: string; customFieldValue: string }>;
}

export interface ContractPriority {
  priority: boolean;
  priorityReason: string;
}

export interface ConfidentialRecord {
  userId: number;
  roleId: number;
}

// ─── Update Contract Payload ──────────────────────────────────────────────────
export interface UpdateContractPayload {
  id: number;
  applicationTypeId: number;
  recordId: number;
  isUploadedContract: boolean;
  assignees: Array<{ userId: number; departmentId: number; functionId: number | null; isPrimary: boolean }>;
  requesterUser: { UserId: number; DepartmentId: number }; // uppercase - per spec
  legalParties: Array<{ legalPartyId: number; isPrimary: boolean }>;
  contractPriority: ContractPriority;
  recordClassificationId: number;
  integrationId: string[];
  clients: ClientRef[];
  requestorUsername: string;
  description: string;
  isConfidential: boolean;
  skipCustomFields: boolean;
  skipClientCustomFields: boolean;
  confidentialRecords: ConfidentialRecord[];
  customFields: Array<{ customFieldId: number; customFieldValue: string }>;
}

// ─── User ─────────────────────────────────────────────────────────────────────
export interface LeahUser {
  id: number;
  userId: number;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  userName: string;    // always the real email
  isActive: boolean;
  roleId: number;
  roleName: string;
  departmentId: number;
  departmentName: string;
  licenseId: number;
  organizationId: number;
  organizationName: string;
  isExternalUser: boolean;
  addedOn: string;
}

export type UserMaskStatus = "masked" | "unmasked";

// email starts with "x" = masked. userName = real email always.
export function getUserMaskStatus(user: LeahUser): UserMaskStatus {
  return user.email.startsWith("x") ? "masked" : "unmasked";
}

// ─── Legal Party ──────────────────────────────────────────────────────────────
export interface LegalParty {
  legalPartyId: number;
  name: string;
  description: string;
  registrationNumber: string;
  placeOfRegistration: string;
  street1: string;
  street2: string;
  city: string;
  state: string;
  countryId: number;
  countryName?: string;
  zipCode: string;
  isActive: boolean;
}

export interface LegalPartyListResponse {
  data: LegalParty[];
  totalRecords: number;
}

export interface CreateLegalPartyPayload {
  name: string;
  description?: string;
  registrationNumber?: string;
  placeOfRegistration?: string;
  street1?: string;
  street2?: string;
  city?: string;
  state?: string;
  countryId?: number;
  zipCode?: string;
  isActive: boolean;
}

// ─── Department ───────────────────────────────────────────────────────────────
export interface Department {
  departmentId: number;
  departmentName: string;
  organizationId: number;
  organizationName: string;
  description: string;
  isActive: boolean;
}

// ─── Metadata / Custom Field Definitions ─────────────────────────────────────
export interface FieldDefinition {
  fieldId: number;
  fieldName: string;
  fieldDisplayName: string;
  displayName?: string;              // alias used by some API responses
  id?: number;                       // alias for fieldId in legacy responses  
  applicationTypeMetaDataId?: number; // legacy ID format
  ctgFieldName?: string;
  fieldType: string;
  fieldTypeId?: number;
  applicationTypeId: number;
  applicationId?: number;            // parent application ID
  applicationTypeName?: string;
  applicationTypeIds?: number[];
  metadataType: string | number;
  metadataTypeName?: string;
  isRequired: boolean;
  isMandatoryField?: boolean;
  isActive: boolean;
  isVisible?: boolean;
  isVisibleOnRequestDetails?: boolean;
  displayInRequestJourney?: boolean;
  displayInRequestDetails?: boolean;
  isForAllApplicationTypes?: boolean;
  helpText?: string;
  guidanceText?: string;
  comments?: string;
  fieldGroup?: string;
  fieldGroupId?: number;
  defaultValue?: string;
  metadataExtractionPromptId?: number | null;
  calculatedFieldUnit?: number;
  calculationOutputDecimals?: number | null;
  decimalPointNumber?: number | null;
  applicationTypeMandatoryData?: Array<{
    applicationTypeId: number;
    isMandatory: boolean;
    fieldId: number;
  }>;
  visibilityConditions?: string | LogicTree; // API returns string, we use LogicTree in UI
  visibilityConditionObject?: LogicTree;     // parsed version
  visibilityCondition?: string | null;
  guidance?: { content: string };
  options?: FieldOption[];
  [key: string]: any;                // allow extra legacy API properties
}

export interface LogicTree {
  condition: "AND" | "OR";
  rules: Array<LogicRule | LogicTree>;
  parsedConditions?: string;
}

export interface LogicRule {
  field?: {
    id: string;
    label: string;
    type: string;
  };
  conditionFieldId?: string | number;
  operator: string;
  value?: any;
  valueDisplay?: any;
  values?: any[];
  values0?: any;
}

export interface FieldOption {
  fieldOptionId: number;
  fieldOptionValue: string;
  isDefault: boolean;
  isActive: boolean;
  parentId: number | null;
  numericValue: number | null;
  fieldOptionOrderId: number;
}

export interface FieldConditionRule {
  ctgFieldName: string;
  type: string;
  question: string | null;
  visibilityCondition: string | null;
  items: any[];
}

export interface CreateFieldOptionPayload {
  fieldId: number;
  fieldOptionValue: string;
  isDefault: boolean;
  parentId?: number;
  numericValue?: number;
  fieldOptionOrderId?: number;
  isActive: boolean;
}

// Swagger: AddUpdateApplicationMetadataRequest
export interface AddUpdateFieldPayload {
  fieldId: number; // 0 for create
  fieldType: number; // ContractMetadataFieldType enum id
  fieldName: string;
  displayName: string;
  isMandatoryField: boolean;
  applicationTypeIds: number[];
  applicationId?: number;
  options: AddUpdateFieldOption[];
  helpText?: string;
  comments?: string;
  fieldGroup?: string;
  metadataType: number; // MetadataType enum id
  isActive: boolean;
  isVisible: boolean;
  isVisibleOnRequestDetails: boolean;
  displayInRequestJourney: boolean;
  displayInRequestDetails: boolean;
  isForAllApplicationTypes: boolean;
  visibilityConditions?: string; // Stringified LogicTree
  applicationTypeMandatoryData?: Array<{
    applicationTypeId: number;
    isMandatory: boolean;
    fieldId: number;
  }>;
  guidance?: { content: string };
  guidanceText?: string;
  calculationTypeValue?: string | null;
  calculatedFieldUnit?: number;
}

export interface AddUpdateFieldOption {
  id: number; // 0 for new
  value: string;
  isDefault: boolean;
  fieldId: number;
  parentId?: number | null;
  numericValue?: number | null;
  fieldOptionOrderId: number;
  isActive: boolean;
}

// Swagger: ApplicationMetaDataTypeFieldTypeResponseModel
export interface FieldTypeInfo {
  fieldTypeId: number;
  fieldTypeName: string;
}

// ─── Audit Log ────────────────────────────────────────────────────────────────
export interface AuditLogEntry {
  auditLogId: number;
  entityId: number;
  entityType: string;
  action: string;
  fieldName: string;
  oldValue: string | null;
  newValue: string | null;
  performedBy: string;
  performedByUserId: number;
  performedOn: string;
  description: string;
}

export interface AuditLogRequest {
  entityId?: number;
  entityType?: string;
  userId?: number;
  fromDate?: string;
  toDate?: string;
  actionType?: string;
  pageNumber?: number;
  pageSize?: number;
}

// ─── Pre-Execution Approval ───────────────────────────────────────────────────
export interface PreExecutionApproval {
  approvalId: number;
  approvalGuid?: string;
  approverName: string;
  fullname?: string;
  username?: string;
  approverUserId: number;
  approverRole: string;
  condition: string;
  status: "Pending" | "Approved" | "Rejected";
  statusName?: string;
  isApproved?: boolean;
  isAutoApproval?: boolean;
  actionedOn: string | null;
  comments: string | null;
}

export interface PreExecutionApprovalResponse {
  data: {
    approvals: PreExecutionApproval[];
    requestId: number;
    currentStage: string;
  };
}

// ─── Date Rules ───────────────────────────────────────────────────────────────
export interface DateRule {
  id: number;
  ruleName: string;
  applicationTypeId: number;
  sourceFieldKey: string;
  targetFieldKey: string;
  ruleType: number;
  operation: string;    // "AddDays", "AddMonths", "AddYears"
  value: number;
  isActive: boolean;
  description: string;
}

export interface DateRuleEvaluateRequest {
  ruleId?: number;
  sourceFieldKey: string;
  targetFieldKey: string;
  operation: string;
  value: number;
  baseDate: string;
}

export interface DateRuleEvaluateResponse {
  sourceDate: string;
  calculatedDate: string;
  sourceFieldKey: string;
  targetFieldKey: string;
}

// ─── Custom Reports ───────────────────────────────────────────────────────────
export interface CustomReport {
  reportId: number;
  reportName: string;
  applicationId: number;
  createdBy: string;
  createdOn: string;
  isScheduled: boolean;
  scheduleFrequency: string | null;
}

export interface ReportDataResponse {
  data: Record<string, unknown>[];
  totalRecords: number;
  columns: string[];
}

// ─── Compare & Comply ─────────────────────────────────────────────────────────
export interface ComplianceScoreCard {
  requestId: number;
  overallScore: number;
  totalObligations: number;
  compliantCount: number;
  nonCompliantCount: number;
  unreviewedCount: number;
  obligations: ObligationItem[];
}

export interface ObligationItem {
  itemId: number;
  obligationName: string;
  extractedText: string;
  isCompliant: boolean;
  isLocked: boolean;
  isDraft: boolean;
  lastUpdatedBy: string;
  lastUpdatedOn: string;
}

// ─── Bulk Import ──────────────────────────────────────────────────────────────
export interface BulkImportTemplate {
  id: number;
  templateName: string;
  applicationTypeId: number;
  applicationTypeName: string;
  isActive: boolean;
  createdOn: string;
}

// ─── Generic API response wrapper ─────────────────────────────────────────────
export interface ApiResponse<T> {
  data: T;
  statusCode: number;
  message: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  totalRecords: number;
  pageNumber: number;
  pageSize: number;
}

// ─── Pagination params ────────────────────────────────────────────────────────
export interface PaginationParams {
  pageNumber?: number;
  pageSize?: number;
  search?: string;
  direction?: boolean;
  orderBy?: string;
}

// ─── Electronic Signature (eSign) ─────────────────────────────────────────────
export interface ESignRecipient {
  name: string;
  email: string;
  order?: number;
  status?: string;
  sendDate?: string;
  receivedDate?: string;
  isCC?: boolean;
  addedBy?: string;
  addedOn?: string;
}

export interface ESignStatusResponse {
  contractID: number;
  requestId: number;
  contractVersionId: number;
  status: string;
  recipientStatus: ESignRecipient[];
  isESignSummaryAvailable: boolean;
  isAllowedDownloadAsSeperateDocument: boolean;
}

export interface SendESignPayload {
  RequestId: number;
  ContractId: number;
  ContractVersionId: number;
  RequestorUsername: string;
  Recipients: Array<{ 
    Name: string; 
    EmailId: string; 
    Order: number;
    TemplateForm?: boolean;
    IncludeApprovalHistory?: boolean;
  }>;
  Subject?: string;
  Message?: string;
  IsDraft?: boolean;
  ShouldBeSanitized?: boolean;
  isContractFileHasComment?: boolean;
  EmailTemplateId?: string;
  SupportingDocumentIds?: string;
  SigningSystemAccountId?: number;
  GenerateRecipientViewer?: boolean;
  AddApprovalAuditHistory?: boolean;
  OnlyIncludeLatestVersionApprovals?: boolean;
  documentOrder: Array<{ Id: number; Type: "Contract" | "Attachment" }>;
}
