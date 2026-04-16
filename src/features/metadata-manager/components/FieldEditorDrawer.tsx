import { useState, useEffect, useMemo } from "react";
import {
  Plus,
  Trash2,
  X,
  Save,
  Fingerprint,
  ListOrdered,
  FileCode,
  Layers,
  Activity,
  AlertTriangle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { FieldDefinition, LogicTree, AddUpdateFieldPayload } from "@/types";
import { LogicDecisionTree } from "./LogicDecisionTree";
import { toast } from "sonner";

interface FieldEditorDrawerProps {
  field: FieldDefinition | null;
  bulkFields?: FieldDefinition[];
  isOpen: boolean;
  onClose: () => void;
  onSave: (payload: AddUpdateFieldPayload) => void;
  onBulkSave?: (fieldIds: number[], updates: Partial<AddUpdateFieldPayload>) => void;
  availableFields: FieldDefinition[];
  fieldTypes: any[];
  appTypes: any[];
  clients?: { oldProd: any; newCloud: any } | null;
  username?: string;
  tenant?: string;
}

const METADATA_TYPES = [
  { id: 1, name: "Request Form" },
  { id: 2, name: "Partner Type" },
  { id: 3, name: "User Type" },
  { id: 4, name: "Other (4)" },
  { id: 8, name: "Other (8)" },
  { id: 9, name: "Other (9)" },
];

export function FieldEditorDrawer({
  field,
  bulkFields = [],
  isOpen,
  onClose,
  onSave,
  onBulkSave,
  availableFields,
  fieldTypes: _fieldTypes,
  appTypes,
  clients,
  username,
  tenant
}: FieldEditorDrawerProps) {
  const isBulk = bulkFields.length > 1;
  const [activeTab, setActiveTab] = useState("identity");
  const [logicMode, setLogicMode] = useState<"visual" | "expert">("visual");

  // Local Form State
  const [formData, setFormData] = useState<Partial<FieldDefinition>>({});
  const [oldProdDetail, setOldProdDetail] = useState<any>(null);
  const [logic, setLogic] = useState<LogicTree>({ condition: "AND", rules: [] });
  const [rawLogicJson, setRawLogicJson] = useState("");

  // Normalize applicationTypeIds into a consistent number array for both UI and Payload
  const normalizedAppTypeIds: number[] = useMemo(() => {
    const rawIds = formData.applicationTypeIds;
    if (Array.isArray(rawIds)) return rawIds.map(Number);
    if (typeof rawIds === 'string' && rawIds.length > 0) {
      return rawIds.split(',').map(v => Number(v.trim())).filter(n => !isNaN(n));
    }
    return [];
  }, [formData.applicationTypeIds]);

  useEffect(() => {
    if (field && isOpen) {
      setFormData(field);

  // Parse logic helper
  const updateLogicFromRaw = (raw: any) => {
    if (!raw) return;
    let parsed: LogicTree = { condition: "AND", rules: [] };
    
    try {
      if (typeof raw === 'string' && raw.startsWith('{')) {
        parsed = JSON.parse(raw);
      } else if (typeof raw === 'object' && raw !== null) {
        // Handle legacy wrapper { condition: string, rules: [] } or { rules: [] }
        if (Array.isArray(raw.rules)) {
          parsed = raw as LogicTree;
        } else if (raw.visibilityConditionObject && Array.isArray(raw.visibilityConditionObject.rules)) {
          parsed = raw.visibilityConditionObject as LogicTree;
        }
      }

      if (parsed.rules && parsed.rules.length > 0) {
        setLogic(parsed);
        setRawLogicJson(JSON.stringify(parsed, null, 2));
      }
    } catch (e) {
      console.error("Failed to parse logic:", e);
    }
  };

  useEffect(() => {
    if (isOpen && field) {
      setFormData(field);
      setActiveTab("identity");
      setOldProdDetail(null); // Reset when opening new field

      // Initial parse from shallow data
      updateLogicFromRaw(field.visibilityConditions || field.visibilityCondition || (field as any).visibilityConditionObject);

      // Fetch rich data
      if (clients && field?.fieldId && username && tenant) {
        import("@/api/metadata").then(({ getFieldDetailOldProd }) => {
          getFieldDetailOldProd(clients.oldProd, tenant, field.fieldId, username)
            .then(d => {
              setOldProdDetail(d);
              // Re-parse with rich data (will contain full rules)
              if (d) updateLogicFromRaw(d.visibilityCondition || d.visibilityConditions || d.visibilityConditionObject);
            })
            .catch(() => {});
        });
      }
    }
  }, [field, isOpen]);

  const handleSave = () => {
    if (isBulk) {
       if (!onBulkSave) return;
       // In bulk mode, we only sync common attributes
       onBulkSave(bulkFields.map(f => f.fieldId), {
          isActive: formData.isActive,
          isVisible: formData.isVisible,
          isMandatoryField: formData.isRequired,
          fieldGroup: formData.fieldGroup,
          metadataType: formData.metadataType
       } as any);
       return;
    }

    if (!formData.fieldName || !formData.fieldDisplayName) {
      toast.error("Field Name and Display Name are required");
      return;
    }

    const finalLogic = logicMode === "expert" 
      ? JSON.parse(rawLogicJson) 
      : logic;


    const payload: any = {
      ...(oldProdDetail || {}), // Start with the full legacy schema to preserve extra fields
      id: field?.fieldId || 0,
      fieldId: field?.fieldId || 0,
      applicationId: field?.applicationId || (field as any)?.applicationId || 77,
      fieldName: formData.fieldName!,
      displayName: formData.fieldDisplayName!,
      fieldType: Number(formData.fieldTypeId || 1),
      isActive: formData.isActive ? 1 : 0,
      isMandatoryField: !!formData.isRequired,
      isVisible: formData.isVisible !== false ? 1 : 0,
      isVisibleOnRequestDetails: formData.isVisibleOnRequestDetails !== false ? 1 : 0,
      displayInRequestJourney: !!formData.displayInRequestJourney ? 1 : 0,
      displayInRequestDetails: !!formData.displayInRequestDetails ? 1 : 0,
      isForAllApplicationTypes: !!formData.isForAllApplicationTypes,
      applicationTypeIds: normalizedAppTypeIds,
      applicationTypeMandatoryData: normalizedAppTypeIds.map(numId => {
         const matrixEntry = (formData.applicationTypeMandatoryData || []).find(m => m.applicationTypeId === numId);
         return {
            applicationTypeId: numId,
            isMandatory: !!matrixEntry?.isMandatory
            // fieldId removed from here as per "correct payload" sample
         };
      }),
      visibilityConditions: JSON.stringify(finalLogic),
      fieldGroup: formData.fieldGroup || oldProdDetail?.fieldGroup || 100008,
      helpText: formData.helpText || "",
      comments: formData.comments || "",
      guidanceText: formData.guidanceText || "",
      guidance: { content: formData.guidanceText || oldProdDetail?.guidance?.content || "" },
      metadataType: Number(formData.metadataType) === 2 ? "Partner Type" : Number(formData.metadataType) === 3 ? "User Type" : "Request Form",
      metadataTypeId: Number(formData.metadataType || 1),
      metadataExtractionPromptId: oldProdDetail?.metadataExtractionPromptId || 17,
      addAttachment: oldProdDetail?.addAttachment || "YO",
      importantDateFieldId: oldProdDetail?.importantDateFieldId || 1,
      requestorUsername: username || "integreonpg",
      options: (formData.options || []).map(o => ({
         id: o.fieldOptionId || (o as any).id || 0,
         value: o.fieldOptionValue || (o as any).value || "",
         isDefault: !!o.isDefault ? 1 : 0,
         fieldId: field?.fieldId || 0,
         fieldOptionOrderId: o.fieldOptionOrderId || 0,
         isActive: o.isActive !== false ? 1 : 0
      }))
    };

    if (clients && username && tenant && field?.fieldId && !isBulk) {
      // Use old prod API for update with the unified/hardened payload
      import("@/api/metadata").then(async ({ updateFieldOldProd }) => {
        try {
          await updateFieldOldProd(clients.oldProd, tenant, field.fieldId, payload);
          toast.success("Field updated via Old Prod API");
          onClose();
        } catch (err) {
          toast.error((err as Error).message);
        }
      });
    } else {
      // Fallback: use parent's onSave handler (for create, or when no clients)
      onSave(payload);
    }
  };

  return (
    <>
      <div 
        className={cn(
          "fixed inset-0 bg-black/60 backdrop-blur-md z-[100] transition-opacity duration-300",
          isOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        onClick={onClose}
      />
      
      <div 
        className={cn(
          "fixed right-0 top-0 bottom-0 w-[700px] bg-[#0c0c0e]/95 backdrop-blur-3xl border-l border-white/10 z-[101] shadow-2xl transition-transform duration-500 ease-out flex flex-col",
          isOpen ? "translate-x-0" : "translate-x-full"
        )}
      >
        {/* Header */}
        <div className="p-8 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
           <div className="flex items-center gap-4">
              <div className={cn("h-12 w-12 rounded-2xl flex items-center justify-center border shadow-lg shadow-primary/5", isBulk ? "bg-amber-500/10 border-amber-500/20" : "bg-primary/10 border-primary/20")}>
                 {isBulk ? <Layers size={24} className="text-amber-400" /> : <Fingerprint size={24} className="text-primary" />}
              </div>
              <div>
                 <h3 className="text-xl font-black text-white tracking-tight">{isBulk ? "Bulk Architect" : "Leah Architect"}</h3>
                 <p className="text-[10px] text-muted-foreground/40 uppercase font-black tracking-widest leading-none mt-1">
                    {isBulk ? `Batch Command: ${bulkFields.length} Nodes` : "Metadata Command Center"}
                 </p>
              </div>
           </div>

           {/* Quick Pillar */}
           {!isBulk && field && (
             <div className="flex items-center gap-6 px-6 py-2 bg-white/[0.03] border border-white/5 rounded-2xl">
                <div className="flex flex-col">
                   <span className="text-[9px] font-black uppercase text-white/20 tracking-widest">Node ID</span>
                   <span className="text-xs font-mono font-bold text-primary">#{field.fieldId}</span>
                </div>
                <div className="h-8 w-px bg-white/5" />
                <div className="flex flex-col">
                   <span className="text-[9px] font-black uppercase text-white/20 tracking-widest">Type</span>
                   <span className="text-xs font-bold text-white/60 lowercase">{field.fieldType}</span>
                </div>
                <div className="h-8 w-px bg-white/5" />
                <div className="flex flex-col">
                   <span className="text-[9px] font-black uppercase text-white/20 tracking-widest">Status</span>
                   <div className="flex items-center gap-1.5 mt-0.5">
                      <div className={cn("h-1.5 w-1.5 rounded-full", field.isActive ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-white/10")} />
                      <div className={cn("h-1.5 w-1.5 rounded-full", field.isVisible !== false ? "bg-sky-500 shadow-[0_0_8px_rgba(14,165,233,0.5)]" : "bg-white/10")} />
                   </div>
                </div>
             </div>
           )}

           {isBulk && (
              <div className="flex items-center gap-4 px-6 py-2 bg-amber-500/5 border border-amber-500/20 rounded-2xl">
                 <Activity size={16} className="text-amber-400 animate-pulse" />
                 <span className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-200/60">Multi-Node Selection Active</span>
              </div>
           )}

           <Button variant="ghost" size="icon" onClick={onClose} className="h-10 w-10 border border-white/5 rounded-xl hover:bg-white/5 ml-auto">
              <X size={20} className="text-white/20" />
           </Button>
        </div>

        {/* Action Tabs */}
        <div className="flex-1 overflow-hidden flex flex-col">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
            <div className="px-8 pt-4 bg-white/[0.01]">
              <TabsList className="bg-white/5 border border-white/5 p-1 rounded-xl w-full">
                <TabsTrigger value="identity" className="flex-1 text-[9px] uppercase font-black tracking-widest py-2.5">Identity</TabsTrigger>
                <TabsTrigger value="logic" className="flex-1 text-[9px] uppercase font-black tracking-widest py-2.5">Logic Architect</TabsTrigger>
                <TabsTrigger value="values" className="flex-1 text-[9px] uppercase font-black tracking-widest py-2.5">Values</TabsTrigger>
                <TabsTrigger value="matrix" className="flex-1 text-[9px] uppercase font-black tracking-widest py-2.5">App Matrix</TabsTrigger>
                <TabsTrigger value="advanced" className="flex-1 text-[9px] uppercase font-black tracking-widest py-2.5">Advanced</TabsTrigger>
              </TabsList>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-8">
              
              {/* identity Tab */}
              <TabsContent value="identity" className="space-y-8 mt-0 animate-in fade-in slide-in-from-right-4 duration-500">
                 {!isBulk && (
                    <>
                      <div className="grid grid-cols-2 gap-6">
                        <div className="space-y-2.5">
                          <Label className="text-[10px] font-black uppercase tracking-widest text-white/30">Display Name</Label>
                          <Input 
                              value={formData.fieldDisplayName || ""} 
                              onChange={e => setFormData(p => ({ ...p, fieldDisplayName: e.target.value }))}
                              placeholder="User facing label..."
                              className="h-12 bg-[#0c0c12] border-white/5 rounded-xl text-[13px] font-bold focus:ring-primary/40 transition-all shadow-inner"
                          />
                        </div>
                        <div className="space-y-2.5">
                          <Label className="text-[10px] font-black uppercase tracking-widest text-white/30">System Key (fieldName)</Label>
                          <Input 
                              value={formData.fieldName || ""} 
                              onChange={e => setFormData(p => ({ ...p, fieldName: e.target.value }))}
                              placeholder="internalIdentifier"
                              className="h-12 bg-[#0c0c12] border-white/5 rounded-xl text-[13px] font-mono text-white/50 focus:ring-primary/40 transition-all shadow-inner"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-6 pt-4">
                        <div className="space-y-2.5">
                          <Label className="text-[10px] font-black uppercase tracking-widest text-white/30">Field Group / Category</Label>
                          <Input 
                              value={formData.fieldGroup || ""} 
                              onChange={e => setFormData(p => ({ ...p, fieldGroup: e.target.value }))}
                              className="h-12 bg-[#0c0c12] border-white/5 rounded-xl text-[13px] shadow-inner"
                          />
                        </div>
                        <div className="space-y-2.5">
                          <Label className="text-[10px] font-black uppercase tracking-widest text-white/30">Internal Comments</Label>
                          <Input 
                              value={formData.comments || ""} 
                              onChange={e => setFormData(p => ({ ...p, comments: e.target.value }))}
                              placeholder="Rationale..."
                              className="h-12 bg-[#0c0c12] border-white/5 rounded-xl text-[13px] shadow-inner"
                          />
                        </div>
                      </div>
                    </>
                 )}

                 {isBulk && (
                    <div className="p-8 bg-amber-500/[0.03] border border-amber-500/10 rounded-[2rem] space-y-4">
                       <div className="flex items-center gap-3 text-amber-500">
                          <Layers size={18} />
                          <span className="text-sm font-black uppercase tracking-widest">Bulk Attributes Update</span>
                       </div>
                       <p className="text-xs text-amber-200/40 leading-relaxed">
                          Applying changes to <strong className="text-amber-400 font-black">{bulkFields.length}</strong> selected nodes. 
                          Only the attributes toggled below will be synchronized across the selection.
                       </p>
                    </div>
                 )}

                 <Separator className="bg-white/5" />

                 <div className="grid grid-cols-2 gap-4">
                    <StatusToggle 
                      label="Active State" 
                      checked={!!formData.isActive} 
                      onChange={v => setFormData(p => ({ ...p, isActive: v }))} 
                      desc="Field is operational in the Leah environment."
                    />
                    <StatusToggle 
                      label="Mandatory" 
                      checked={!!formData.isRequired} 
                      onChange={v => setFormData(p => ({ ...p, isRequired: v }))} 
                      desc="Global default mandatory status."
                    />
                    <StatusToggle 
                      label="Visible Form" 
                      checked={formData.isVisible !== false} 
                      onChange={v => setFormData(p => ({ ...p, isVisible: v }))} 
                      desc="Field appears on initial form load."
                    />
                    <StatusToggle 
                      label="Universal Field" 
                      checked={!!formData.isForAllApplicationTypes} 
                      onChange={v => setFormData(p => ({ ...p, isForAllApplicationTypes: v }))} 
                      desc="Ignore app-type scope restrictions."
                    />
                 </div>
              </TabsContent>

              {/* Logic Architect Tab */}
              <TabsContent value="logic" className="space-y-6 mt-0 animate-in fade-in slide-in-from-right-4 duration-500">
                 <div className="flex items-center justify-between bg-white/[0.03] p-4 rounded-2xl border border-white/5">
                    <div className="flex flex-col">
                       <span className="text-[11px] font-black uppercase tracking-widest text-primary">Logic Engine Mode</span>
                       <span className="text-[9px] text-white/20">Switch between visual tree and raw JSON injection.</span>
                    </div>
                    <div className="flex bg-[#0c0c12] p-1 rounded-xl border border-white/5">
                       <button 
                        onClick={() => setLogicMode("visual")}
                        className={cn(
                          "px-4 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all",
                          logicMode === "visual" ? "bg-primary text-primary-foreground shadow-lg" : "text-white/20 hover:text-white/40"
                        )}
                       >
                         Visual Tree
                       </button>
                       <button 
                        onClick={() => setLogicMode("expert")}
                        className={cn(
                          "px-4 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all",
                          logicMode === "expert" ? "bg-amber-500 text-white shadow-lg" : "text-white/20 hover:text-white/40"
                        )}
                       >
                         Expert JSON
                       </button>
                    </div>
                 </div>

                 {logicMode === "visual" ? (
                   <LogicDecisionTree 
                    logic={logic} 
                    onChange={setLogic} 
                    availableFields={availableFields} 
                   />
                 ) : (
                   <div className="space-y-4">
                      <div className="flex items-center gap-2 text-amber-500">
                         <FileCode size={14} />
                         <span className="text-[10px] font-black uppercase tracking-widest">Raw Logic Payload</span>
                      </div>
                      <textarea
                        value={rawLogicJson}
                        onChange={e => setRawLogicJson(e.target.value)}
                        className="w-full h-[450px] bg-black/40 border border-white/10 rounded-2xl p-6 font-mono text-[11px] text-amber-400/80 focus:ring-1 focus:ring-amber-500/30 outline-none shadow-2xl custom-scrollbar"
                      />
                      <div className="p-4 bg-amber-500/5 border border-amber-500/20 rounded-xl flex items-center gap-3">
                         <AlertTriangle size={16} className="text-amber-500 shrink-0" />
                         <p className="text-[10px] text-amber-200/50 leading-relaxed italic">
                            Expert Mode allows direct injection of conditions. Ensure the JSON schema follows the Leah LogicTree standard to avoid deployment failure.
                         </p>
                      </div>
                   </div>
                 )}
              </TabsContent>

              {/* Values Tab */}
              <TabsContent value="values" className="space-y-6 mt-0 animate-in fade-in slide-in-from-right-4 duration-500">
                 <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                       <span className="text-[11px] font-black uppercase tracking-widest text-blue-400">Option Dictionary</span>
                       <span className="text-[9px] text-white/20">Manage labels and unique values for this control.</span>
                    </div>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="h-8 rounded-lg border-blue-500/20 bg-blue-500/5 text-blue-400 text-[10px] font-black uppercase tracking-widest"
                      onClick={() => {
                        const next = [...(formData.options || [])];
                        next.push({ 
                          fieldOptionId: -Math.random(), 
                          fieldOptionValue: "New Option", 
                          isActive: true,
                          isDefault: false
                        } as any);
                        setFormData(p => ({ ...p, options: next }));
                      }}
                    >
                      <Plus size={12} className="mr-1.5" /> Add Option
                    </Button>
                 </div>
                 
                 <div className="space-y-2">
                    {(formData.options || []).map((opt, idx) => (
                      <div key={idx} className="flex items-center gap-3 p-3 bg-white/[0.03] border border-white/5 rounded-xl group/opt">
                         <div className="h-2 w-2 rounded-full bg-blue-500/40" />
                         <Input 
                            value={opt.fieldOptionValue} 
                            onChange={e => {
                               const next = [...(formData.options || [])];
                               next[idx].fieldOptionValue = e.target.value;
                               setFormData(p => ({ ...p, options: next }));
                            }}
                            className="bg-transparent border-none focus:ring-0 text-[13px] font-bold p-0 h-auto"
                         />
                         <div className="ml-auto flex items-center gap-4">
                            <div className="flex items-center gap-2">
                               <span className="text-[9px] font-black text-white/20 uppercase tracking-widest">Default</span>
                               <Switch 
                                  checked={!!opt.isDefault} 
                                  onCheckedChange={v => {
                                     const next = (formData.options || []).map((o, i) => ({ ...o, isDefault: i === idx ? v : false }));
                                     setFormData(p => ({ ...p, options: next }));
                                  }} 
                               />
                            </div>
                            <Button 
                               variant="ghost" 
                               size="icon" 
                               className="h-8 w-8 text-white/10 hover:text-red-400 hover:bg-red-400/10 rounded-lg opacity-0 group-hover/opt:opacity-100 transition-all"
                               onClick={() => {
                                  const next = [...(formData.options || [])];
                                  next.splice(idx, 1);
                                  setFormData(p => ({ ...p, options: next }));
                               }}
                            >
                               <Trash2 size={12} />
                            </Button>
                         </div>
                      </div>
                    ))}
                    {(formData.options || []).length === 0 && (
                      <div className="py-20 text-center border-2 border-dashed border-white/5 rounded-[2.5rem] opacity-20">
                         <ListOrdered size={32} className="mx-auto mb-4" />
                         <p className="text-[10px] font-black uppercase tracking-[0.3em] italic text-white/40">No Options Defined</p>
                      </div>
                    )}
                 </div>
              </TabsContent>

              {/* Matrix Tab */}
              <TabsContent value="matrix" className="space-y-6 mt-0 animate-in fade-in slide-in-from-right-4 duration-500">
                 <div className="flex flex-col">
                    <span className="text-[11px] font-black uppercase tracking-widest text-violet-400">Application Type Matrix</span>
                    <span className="text-[9px] text-white/20">Configure mandatory status specific to selected application nodes.</span>
                 </div>
                 
                 <div className="space-y-2">
                     {appTypes.map(appType => {
                        const matrixEntry = (formData.applicationTypeMandatoryData || []).find(m => m.applicationTypeId === appType.applicationTypeId);
                        const isAssigned = normalizedAppTypeIds.includes(appType.applicationTypeId);

                        return (
                          <div key={appType.applicationTypeId} className={cn(
                             "flex items-center justify-between p-4 bg-white/[0.03] border border-white/5 rounded-2xl hover:bg-white/[0.05] transition-all group/at",
                             isAssigned && "border-primary/20 bg-primary/[0.02]"
                          )}>
                             <div className="flex flex-col">
                                <span className={cn("text-xs font-bold transition-colors", isAssigned ? "text-primary" : "text-white/80")}>
                                   {appType.applicationTypeName}
                                </span>
                                <span className="text-[9px] font-mono text-white/20 uppercase">ID: {appType.applicationTypeId}</span>
                             </div>
                             <div className="flex items-center gap-6">
                                <div className="flex items-center gap-2 pr-6 border-r border-white/5">
                                   <span className={cn("text-[8px] font-black uppercase tracking-widest transition-colors", isAssigned ? "text-primary" : "text-white/20")}>
                                      {isAssigned ? "Assigned" : "Inactive"}
                                   </span>
                                   <Switch 
                                      checked={isAssigned} 
                                      onCheckedChange={v => {
                                         let nextIds = [...normalizedAppTypeIds];
                                         if (v) {
                                            if (!nextIds.includes(appType.applicationTypeId)) nextIds.push(appType.applicationTypeId);
                                         } else {
                                            nextIds = nextIds.filter(id => id !== appType.applicationTypeId);
                                         }
                                         setFormData(p => ({ ...p, applicationTypeIds: nextIds }));
                                      }}
                                   />
                                </div>
                                <div className="flex items-center gap-2 opacity-50 group-hover/at:opacity-100 transition-opacity">
                                   <span className="text-[9px] font-black text-white/20 uppercase tracking-widest">Required</span>
                                   <Switch 
                                      checked={!!matrixEntry?.isMandatory} 
                                      disabled={!isAssigned}
                                      onCheckedChange={v => {
                                         const current = [...(formData.applicationTypeMandatoryData || [])];
                                         const existingIdx = current.findIndex(m => m.applicationTypeId === appType.applicationTypeId);
                                         if (existingIdx >= 0) {
                                            current[existingIdx].isMandatory = v;
                                         } else {
                                            current.push({ applicationTypeId: appType.applicationTypeId, isMandatory: v, fieldId: field?.fieldId || 0 });
                                         }
                                         setFormData(p => ({ ...p, applicationTypeMandatoryData: current }));
                                      }}
                                   />
                                </div>
                             </div>
                          </div>
                        );
                     })}
                 </div>
              </TabsContent>

              {/* Advanced Tab */}
              <TabsContent value="advanced" className="space-y-6 mt-0 animate-in fade-in slide-in-from-right-4 duration-500">
                <div className="flex flex-col">
                  <span className="text-[11px] font-black uppercase tracking-widest text-emerald-400">Advanced Settings</span>
                  <span className="text-[9px] text-white/20">Configuration flags and old-prod specific fields.</span>
                </div>

                {/* Old prod detail raw viewer */}
                {oldProdDetail && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <StatusToggle
                        label="Allow Custom Options"
                        checked={!!(oldProdDetail?.allowToAddOptionFromRequest)}
                        onChange={() => {}}
                        desc="Let users add options from the request form."
                      />
                      <StatusToggle
                        label="Show in Roles & Permissions"
                        checked={!!(oldProdDetail?.displayInRolesAndPermissions)}
                        onChange={() => {}}
                        desc="Display this field in role-based permissions."
                      />
                      <StatusToggle
                        label="Show Select All"
                        checked={!!(oldProdDetail?.showSelectAll)}
                        onChange={() => {}}
                        desc="Show 'Select All' in multi-select controls."
                      />
                      <StatusToggle
                        label="Evergreen Visible"
                        checked={!!(oldProdDetail?.isEvergreenVisible)}
                        onChange={() => {}}
                        desc="Field visible in evergreen contract mode."
                      />
                    </div>

                    {/* Guidance text */}
                    <div className="space-y-2.5">
                      <Label className="text-[10px] font-black uppercase tracking-widest text-white/30">Guidance Text (HTML)</Label>
                      <textarea
                        value={formData.guidanceText || oldProdDetail?.guidanceText || ""}
                        onChange={e => setFormData(p => ({ ...p, guidanceText: e.target.value }))}
                        rows={5}
                        placeholder="HTML guidance content..."
                        className="w-full bg-[#0c0c12] border border-white/5 rounded-xl px-4 py-3 text-[12px] font-mono text-amber-400/70 focus:ring-1 focus:ring-amber-500/30 outline-none custom-scrollbar resize-y"
                      />
                    </div>

                    {/* Raw old-prod schema */}
                    <div className="p-4 bg-white/[0.02] border border-white/5 rounded-2xl">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-[10px] font-black uppercase tracking-widest text-white/20">Old Prod Schema</span>
                        <button
                          onClick={() => { navigator.clipboard.writeText(JSON.stringify(oldProdDetail, null, 2)); toast.success("Copied"); }}
                          className="text-[9px] text-muted-foreground/40 hover:text-primary transition-colors"
                        >copy</button>
                      </div>
                      <pre className="text-[10px] font-mono text-emerald-400/60 max-h-[300px] overflow-auto leading-relaxed whitespace-pre-wrap break-all custom-scrollbar">
                        {JSON.stringify(oldProdDetail, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}
                {!oldProdDetail && (
                  <div className="py-16 text-center opacity-30">
                    <p className="text-[10px] font-black uppercase tracking-widest">Loading old prod schema...</p>
                  </div>
                )}
              </TabsContent>

            </div>
          </Tabs>
        </div>

        {/* Footer Actions */}
        <div className="p-8 border-t border-white/5 bg-white/[0.012] flex gap-3">
           <Button 
            variant="outline" 
            onClick={onClose}
            className="flex-1 h-14 rounded-2xl border-white/10 bg-white/5 text-[11px] font-black uppercase tracking-[0.2em] text-white/40 hover:text-white"
           >
              Discard Changes
           </Button>
           <Button 
            onClick={handleSave}
            className="flex-1 h-14 rounded-2xl bg-primary hover:bg-primary/80 text-primary-foreground font-black uppercase tracking-[0.2em] text-[11px] shadow-xl shadow-primary/5 gap-2"
           >
              <Save size={18} />
              Save Metadata
           </Button>
        </div>
      </div>
    </>
  );
}

function StatusToggle({ label, checked, onChange, desc }: { label: string; checked: boolean; onChange: (v: boolean) => void; desc: string }) {
  return (
    <div className="p-4 bg-white/[0.03] border border-white/5 rounded-2xl flex items-center justify-between group transition-all hover:bg-white/[0.05]">
       <div className="flex flex-col gap-0.5">
          <span className="text-[11px] font-black uppercase tracking-tight text-white/80">{label}</span>
          <span className="text-[9px] text-white/20 group-hover:text-white/40 transition-colors">{desc}</span>
       </div>
       <Switch checked={checked} onCheckedChange={onChange} className="data-[state=checked]:bg-primary" />
    </div>
  );
}
