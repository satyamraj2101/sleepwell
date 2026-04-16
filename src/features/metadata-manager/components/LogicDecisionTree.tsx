import { useMemo } from "react";
import {
  Plus,
  Trash2,
  Layers,
  Zap
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { LogicTree, LogicRule, FieldDefinition } from "@/types";

interface LogicDecisionTreeProps {
  logic: LogicTree;
  onChange: (newLogic: LogicTree) => void;
  availableFields: FieldDefinition[];
}

export function LogicDecisionTree({ logic, onChange, availableFields }: LogicDecisionTreeProps) {
  
  const updateGroup = (path: number[], updated: Partial<LogicTree>) => {
    const next = JSON.parse(JSON.stringify(logic));
    let target = next;
    for (const segment of path) {
      target = target.rules[segment];
    }
    Object.assign(target, updated);
    onChange(next);
  };

  const addRule = (path: number[], isGroup = false) => {
    const next = JSON.parse(JSON.stringify(logic));
    let target = next;
    for (const segment of path) {
      target = target.rules[segment];
    }
    
    if (isGroup) {
      target.rules.push({ condition: "AND", rules: [] });
    } else {
      target.rules.push({ 
        operator: "equals", 
        value: "",
        field: { id: "", label: "", type: "" }
      });
    }
    onChange(next);
  };

  const removeAt = (path: number[], index: number) => {
    const next = JSON.parse(JSON.stringify(logic));
    let target = next;
    for (const segment of path) {
      target = target.rules[segment];
    }
    target.rules.splice(index, 1);
    onChange(next);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
         <div className="flex items-center gap-2 text-primary">
            <Zap size={14} className="animate-pulse" />
            <span className="text-[10px] font-black uppercase tracking-widest text-white/60">Gating Logic Blueprint</span>
         </div>
         <Badge variant="outline" className="text-[9px] font-black border-primary/20 bg-primary/5 text-primary">
            Decision Tree
         </Badge>
      </div>

      <div className="p-6 rounded-[2rem] border border-white/5 bg-white/[0.01] shadow-inner min-h-[400px]">
        <TreeNode 
          node={logic} 
          path={[]} 
          availableFields={availableFields}
          onUpdate={updateGroup}
          onAdd={addRule}
          onRemove={removeAt}
          depth={0}
        />
      </div>
    </div>
  );
}

// ─── Internal Tree Node ───────────────────────────────────────────────────────

function TreeNode({ 
  node, 
  path, 
  availableFields, 
  onUpdate, 
  onAdd, 
  onRemove,
  depth 
}: { 
  node: LogicTree | LogicRule; 
  path: number[];
  availableFields: FieldDefinition[];
  onUpdate: (path: number[], updated: any) => void;
  onAdd: (path: number[], isGroup: boolean) => void;
  onRemove: (parentPath: number[], index: number) => void;
  depth: number;
}) {
  const isGroup = 'condition' in node;

  if (isGroup) {
    const lNode = node as LogicTree;
    return (
      <div className={cn(
        "relative pl-6 py-2 transition-all border-l-2",
        depth === 0 ? "border-primary/20" : "border-white/10 ml-4 lg:ml-8"
      )}>
        {/* Connection Dot */}
        <div className="absolute -left-[5px] top-4 h-2 w-2 rounded-full bg-primary/40 shadow-sm" />
        
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <Select 
            value={lNode.condition} 
            onValueChange={(v) => onUpdate(path, { condition: v })}
          >
            <SelectTrigger className="w-24 h-8 bg-white/5 border-white/10 text-[10px] font-black uppercase tracking-widest rounded-lg">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-[#14141c] border-white/10 text-white">
              <SelectItem value="AND" className="text-[10px] font-black tracking-widest uppercase">AND</SelectItem>
              <SelectItem value="OR" className="text-[10px] font-black tracking-widest uppercase">OR</SelectItem>
            </SelectContent>
          </Select>

          <span className="text-[9px] font-bold text-white/20 uppercase tracking-widest">Group Conditions</span>

          <div className="flex gap-2 ml-auto">
             <Button 
                variant="ghost" 
                size="sm" 
                className="h-8 px-3 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary text-[9px] font-black uppercase tracking-widest"
                onClick={() => onAdd(path, false)}
             >
                <Plus size={12} className="mr-1.5" /> Rule
             </Button>
             <Button 
                variant="ghost" 
                size="sm" 
                className="h-8 px-3 rounded-lg bg-white/5 hover:bg-white/10 text-white/40 text-[9px] font-black uppercase tracking-widest border border-white/5"
                onClick={() => onAdd(path, true)}
             >
                <Layers size={12} className="mr-1.5" /> Group
             </Button>
          </div>
        </div>

        <div className="space-y-4">
          {lNode.rules.length === 0 ? (
            <div className="py-12 text-center bg-white/[0.02] rounded-3xl border border-dashed border-white/5 mx-4">
               <p className="text-[9px] text-white/10 uppercase font-black tracking-[0.2em] italic">Empty Logic Branch</p>
            </div>
          ) : (
            lNode.rules.map((rule, idx) => (
              <TreeNode 
                key={idx} 
                node={rule} 
                path={[...path, idx]} 
                availableFields={availableFields}
                onUpdate={(targetPath, upd) => onUpdate(targetPath, upd)}
                onAdd={onAdd}
                onRemove={onRemove}
                depth={depth + 1}
              />
            ))
          )}
        </div>
      </div>
    );
  }

  // ─── Single Rule Render ───
  const rule = node as LogicRule;
  
  // Robust Universal Field Resolver
  const currentField = useMemo(() => {
    const normalize = (val: any) => {
      if (!val) return "";
      const s = String(val).toLowerCase();
      return s.startsWith('f') ? s.substring(1) : s;
    };

    const ruleId = normalize(rule.field?.id || rule.conditionFieldId || "");
    const ruleLabel = (rule.field?.label || "").toLowerCase();

    return availableFields.find(f => {
      const fId = normalize(f.id || f.fieldId || f.applicationTypeMetaDataId);
      const fName = (f.fieldName || "").toLowerCase();
      const fDisplay = (f.displayName || f.fieldDisplayName || "").toLowerCase();
      
      return (fId && fId === ruleId) || 
             (fName && (fName === ruleId || fName === ruleLabel)) ||
             (fDisplay && (fDisplay === ruleId || fDisplay === ruleLabel));
    });
  }, [rule, availableFields]);

  const triggerOptions = (currentField as any)?.options || (currentField as any)?.fieldOptions || [];
  const hasOptions = (triggerOptions.length > 0) || (currentField && ["dropdown", "select", "radiobutton", "multiselect", "trigger"].includes((currentField.fieldType || "").toLowerCase()));
  const options = triggerOptions as any[];

  return (
    <div className="flex flex-wrap items-center gap-4 p-4 rounded-2xl bg-white/[0.04] border border-white/5 shadow-lg group/rule animate-in fade-in slide-in-from-left-4 duration-300">
      <div className="h-2 w-2 rounded-full bg-white/20 shrink-0" />
      
      {/* Field Selector */}
      <Select 
        value={currentField ? String(currentField.fieldName || currentField.fieldId || currentField.id) : String(rule.field?.id || rule.conditionFieldId || "")} 
        onValueChange={(id) => {
          const f = availableFields.find(af => {
            const afId = String(af.id || af.fieldId || af.applicationTypeMetaDataId || "");
            return afId === id || af.fieldName === id;
          });
          onUpdate(path, { 
            conditionFieldId: id,
            field: { 
              id: id, 
              label: f?.displayName || f?.fieldDisplayName || f?.fieldName || id,
              type: f?.fieldType || "unknown"
            },
            value: "" // Clear value when field changes
          });
        }}
      >
        <SelectTrigger className="w-[240px] h-10 bg-[#0c0c12] border-white/10 text-[12px] font-bold rounded-xl truncate">
          <SelectValue>
             {currentField ? (currentField.displayName || currentField.fieldDisplayName || currentField.fieldName) : "Select Trigger Field"}
          </SelectValue>
        </SelectTrigger>
        <SelectContent className="bg-[#14141c] border-white/10 text-white max-h-[300px] z-[9999]" position="popper" sideOffset={5}>
           <div className="px-2 py-2 mb-2 sticky top-0 bg-[#14141c] border-b border-white/5">
              <span className="text-[10px] font-black uppercase tracking-widest text-primary">Metadata Dictionary</span>
           </div>
           {availableFields.map((f, idx) => {
             const key = String(f.fieldName || f.id || f.fieldId || f.applicationTypeMetaDataId || `idx-${idx}`);
             return (
               <SelectItem key={key} value={key} className="text-[12px] py-3 focus:bg-primary/10 transition-colors">
                  <div className="flex flex-col gap-0.5">
                     <span className="font-bold">{f.displayName || f.fieldDisplayName || f.fieldName || "Unnamed Field"}</span>
                     <span className="text-[9px] opacity-20 font-mono tracking-tighter uppercase">{f.fieldType || "trigger"} • #{key}</span>
                  </div>
               </SelectItem>
             );
           })}
        </SelectContent>
      </Select>

      {/* Operator */}
      <Select 
        value={rule.operator} 
        onValueChange={(op) => onUpdate(path, { operator: op })}
      >
        <SelectTrigger className="w-28 h-10 bg-[#0c0c12] border-white/10 text-[11px] font-black uppercase tracking-widest rounded-xl">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="bg-[#14141c] border-white/10 text-white z-[9999]">
          <SelectItem value="equals" className="text-[10px] font-black uppercase tracking-widest">equals</SelectItem>
          <SelectItem value="not_equals" className="text-[10px] font-black uppercase tracking-widest">not equals</SelectItem>
          <SelectItem value="contains" className="text-[10px] font-black uppercase tracking-widest">contains</SelectItem>
          <SelectItem value="is_empty" className="text-[10px] font-black uppercase tracking-widest">is empty</SelectItem>
        </SelectContent>
      </Select>

      {/* Value (Auto-Discovery Dropdown vs Input) */}
      <div className="flex-1 min-w-[140px]">
        {hasOptions ? (
          <Select 
            value={String(rule.value || "")} 
            onValueChange={(val) => {
              const opt = options.find(o => String(o.fieldOptionId) === val || o.fieldOptionValue === val);
              onUpdate(path, { 
                value: val,
                valueDisplay: opt?.fieldOptionValue || val,
                values0: { value: val, label: opt?.fieldOptionValue || val }
              });
            }}
          >
            <SelectTrigger className="w-full h-10 bg-primary/5 border-primary/20 text-[13px] font-bold text-primary rounded-xl">
              <SelectValue placeholder="Select Value" />
            </SelectTrigger>
            <SelectContent className="bg-[#14141c] border-white/10 text-white z-[9999]" position="popper" sideOffset={5}>
               {options.map((o, i) => {
                 const key = String(o.id || o.fieldOptionId || o.value || o.fieldOptionValue || `opt-${i}`);
                 const val = String(o.value || o.fieldOptionValue || o.id || o.fieldOptionId || "");
                 return (
                   <SelectItem key={key} value={val} className="text-xs">
                     {o.fieldOptionValue || o.value || o.displayName || val}
                   </SelectItem>
                 );
               })}
            </SelectContent>
          </Select>
        ) : (
          <Input 
            value={rule.value || ""} 
            onChange={(e) => onUpdate(path, { value: e.target.value })}
            placeholder="Type value..."
            className="h-10 bg-[#0c0c12] border-white/10 text-[13px] rounded-xl focus:ring-primary/40 focus:border-primary/40 transition-all placeholder:text-white/10"
          />
        )}
      </div>

      <Button 
        variant="ghost" 
        size="icon" 
        className="h-9 w-9 text-white/20 hover:text-red-400 hover:bg-red-400/10 rounded-xl opacity-0 group-hover/rule:opacity-100 transition-all"
        onClick={() => onRemove(path.slice(0, -1), path[path.length - 1])}
      >
        <Trash2 size={14} />
      </Button>
    </div>
  );
}
