
import { IntakeFormField, VisibilityCondition } from "@/types";

/**
 * Standard Leah Operators
 */
export type LeahOperator = 
  | "equal" | "notEqual" | "contains" | "notContains" 
  | "isNull" | "isNotNull" | "greaterThan" | "lessThan"
  | "in" | "notIn";

/**
 * Normalizes values for comparison, handling typical metadata edge cases
 */
function normalizeValue(val: any): string {
  if (val === undefined || val === null) return "";
  if (typeof val === 'boolean') return val ? "true" : "false";
  return String(val).trim().toLowerCase();
}

/**
 * Evaluates a single atomic condition against a field value.
 * Hardened to handle numeric IDs, labels, and null-safety.
 */
export function evaluateCondition(
  actualValue: any, 
  operator: string, 
  targetValue: any
): boolean {
  const op = String(operator || "equal").toLowerCase().trim();
  const a = normalizeValue(actualValue);
  const t = normalizeValue(targetValue);

  // Check for specialized operators first
  if (op.includes("null") || op.includes("empty")) {
    const isNull = a === "" || a === "null" || a === "undefined";
    return op.includes("not") ? !isNull : isNull;
  }

  if (op === "in" || op === "not_in" || op === "notIn") {
    const targets = t.split(",").map(item => item.trim().toLowerCase());
    const isMember = targets.includes(a);
    return op.includes("not") ? !isMember : isMember;
  }

  // Fallback to numeric comparison if possible
  const aNum = parseFloat(a);
  const tNum = parseFloat(t);
  const isNumeric = !isNaN(aNum) && !isNaN(tNum) && a !== "" && t !== "";

  switch (op) {
    case "equal":
    case "equals":
    case "=":
    case "==":
      return a === t;
    case "notequal":
    case "not_equal":
    case "!=":
      return a !== t;
    case "contains":
    case "like":
      return a.includes(t);
    case "not_contains":
    case "notcontains":
      return !a.includes(t);
    case "greaterthan":
    case "greater_than":
    case ">":
      return isNumeric ? aNum > tNum : a > t;
    case "lessthan":
    case "less_than":
    case "<":
      return isNumeric ? aNum < tNum : a < t;
    case "greaterthanorequal":
    case "greater_than_or_equal":
    case ">=":
      return isNumeric ? aNum >= tNum : a >= t;
    case "lessthanorequal":
    case "less_than_or_equal":
    case "<=":
      return isNumeric ? aNum <= tNum : a <= t;
    default:
      console.warn(`[LogicEngine] Unknown operator "${op}", falling back to equality`);
      return a === t;
  }
}

/**
 * Main visibility engine. 
 * ENFORCES: If logic exists, the field is HIDDEN by default unless a rule evaluates to true.
 */
export function isFieldVisible(
  field: IntakeFormField, 
  formValues: Record<number, any>
): boolean {
  let logicObj = (field as any).visibilityConditionObject;
  const conditions = field.visibilityConditions;

  // Case 0: Handle stringified JSON logic (common in Leah)
  if (!logicObj) {
    const raw = (field as any).visibilityConditions || field.visibilityCondition;
    if (typeof raw === "string" && raw.startsWith("{")) {
       try {
         const parsed = JSON.parse(raw);
         if (parsed && (parsed.rules || parsed.operator)) {
           logicObj = parsed;
         }
       } catch (e) {}
    }
  }

  // Case 1: Standard nested visibilityConditionObject
  if (logicObj && Array.isArray(logicObj.rules) && logicObj.rules.length > 0) {
    const op = (logicObj.operator || "AND").toUpperCase();
    const results = logicObj.rules.map((rule: any) => {
      const rawId = rule.conditionFieldId || rule.fieldId || rule.field?.id || rule.id || "";
      let fieldIdStr = String(rawId);
      if (fieldIdStr.startsWith('F')) fieldIdStr = fieldIdStr.substring(1);
      const fieldId = parseInt(fieldIdStr, 10);
      
      if (isNaN(fieldId)) return true; // Fail safe for that specific rule

      const actualVal = formValues[fieldId];
      
      // Recurse for nested rule sets
      if (rule.rules && Array.isArray(rule.rules) && rule.rules.length > 0) {
        return isFieldVisible({ ...field, visibilityConditionObject: rule } as any, formValues);
      }
      
      const targetVal = rule.displayValue || rule.valueDisplay || rule.conditionValue || rule.value || (rule.values?.[0]?.value);
      return evaluateCondition(actualVal, rule.operator || "equal", targetVal);
    });

    const isMet = op === "OR" ? results.some(r => r === true) : results.every(r => r === true);
    if (!isMet) return false; // Enforce hidden-by-default if logic exists but isn't met
  }

  // Case 2: Legacy/Flat visibilityConditions array
  else if (Array.isArray(conditions) && conditions.length > 0) {
    const isMet = conditions.every(cond => {
      let fieldIdStr = String(cond.fieldId);
      if (fieldIdStr.startsWith('F')) fieldIdStr = fieldIdStr.substring(1);
      const fieldId = parseInt(fieldIdStr, 10);
      
      const actualVal = formValues[fieldId];
      return evaluateCondition(actualVal, cond.operator || "equal", cond.fieldValue);
    });
    if (!isMet) return false;
  }

  // Final fallback: Use the basic isVisible flag from system metadata
  return field.isVisible !== false;
}

/**
 * Analyzes a set of intake groups to find "Trigger Fields"
 * (Fields that are referenced in visibility conditions of other fields)
 */
export function getLogicTriggers(groups: IntakeFormFieldGroup[]): Set<number> {
  const triggers = new Set<number>();

  const processRule = (rule: any) => {
    if (!rule || typeof rule !== 'object') return;
    
    // Catch every possible field identifier property
    const possibleIds = [
      rule.fieldId, rule.conditionFieldId, rule.id, 
      rule.field?.id, rule.FieldId, rule.ConditionFieldId,
      rule.sourceFieldId, rule.targetFieldId, rule.condition_field_id
    ];

    possibleIds.forEach(rawId => {
      if (rawId === undefined || rawId === null) return;
      let s = String(rawId);
      if (s.startsWith('F')) s = s.substring(1);
      const id = parseInt(s, 10);
      if (!isNaN(id) && id > 0) triggers.add(id);
    });

    if (Array.isArray(rule.rules)) {
      rule.rules.forEach(processRule);
    }
  };

  groups.forEach(g => {
    const fields = [
      ...(g.fields ?? []), 
      ...(g.sections ?? []).flatMap(s => s.fields ?? [])
    ];

    fields.forEach(f => {
      // 1. Check array conditions
      if (Array.isArray(f.visibilityConditions)) {
        f.visibilityConditions.forEach(processRule);
      }

      // 2. Heavy-duty string parsing for logic
      const raw = 
        (f as any).visibilityConditions || 
        (f as any).visibilityCondition || 
        (f as any).visibilityConditionObject ||
        (f as any).visibility_conditions ||
        (f as any).visibility_condition;
      if (typeof raw === 'string') {
         const trimmed = raw.trim();
         // Try parsing as JSON
         if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
            try {
               const parsed = JSON.parse(trimmed);
               if (Array.isArray(parsed)) parsed.forEach(processRule);
               else processRule(parsed);
            } catch(e) {}
         }
         // Fallback: Regex for fieldId/conditionFieldId patterns if JSON fails
         const idMatches = trimmed.match(/"(?:fieldId|conditionFieldId)":\s*(?:F)?(\d+)/g);
         if (idMatches) {
            idMatches.forEach(m => {
               const match = m.match(/\d+/);
               if (match) triggers.add(parseInt(match[0], 10));
            });
         }
      } else if (typeof raw === 'object' && raw !== null) {
         processRule(raw);
      }
    });
  });

  return triggers;
}
