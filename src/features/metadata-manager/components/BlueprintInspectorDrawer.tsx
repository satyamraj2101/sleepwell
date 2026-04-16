import { useQuery } from "@tanstack/react-query";
import { X, Network, Database, Zap, BookOpen, Fingerprint, ShieldAlert, FileJson, Copy, Check, Search, ArrowLeftRight, Dna, Info, List as ListIcon } from "lucide-react";
import { useApiClients } from "@/hooks/useApiClients";
import { listFieldDefinitions, getFieldById } from "@/api/metadata";
import { useAuthStore } from "@/store/authStore";
import { Spinner } from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useState, useMemo } from "react";
import { toast } from "sonner";
import { FieldDefinition } from "@/types";

interface BlueprintInspectorDrawerProps {
  fieldId: number | null;
  onClose: () => void;
  rawRules?: any[];
  allFields?: FieldDefinition[];
}

export function BlueprintInspectorDrawer({ fieldId, onClose, rawRules = [], allFields: initialFields = [] }: BlueprintInspectorDrawerProps) {
  const clients = useApiClients();
  const newCloud = clients?.newCloud;
  const { tenant } = useAuthStore();
  const [copied, setCopied] = useState(false);
  const [compareId, setCompareId] = useState<number | null>(null);
  const [search, setSearch] = useState("");

  const { data: field, isLoading, error } = useQuery({
    queryKey: ['field-detail', fieldId, tenant],
    queryFn: () => getFieldById(newCloud!, tenant, fieldId!),
    enabled: !!fieldId && !!tenant && !!newCloud,
  });

  const { data: compareField, isLoading: isCompareLoading } = useQuery({
    queryKey: ['field-detail', compareId, tenant],
    queryFn: () => getFieldById(newCloud!, tenant, compareId!),
    enabled: !!compareId && !!tenant && !!newCloud,
  });

  const { data: searchFields = [] } = useQuery({
    queryKey: ['all-fields-short', tenant],
    queryFn: () => listFieldDefinitions(newCloud!, tenant, { pageSize: 1000 }),
    enabled: !!fieldId && !!tenant && !!newCloud && initialFields.length === 0,
  });

  const availableFields = initialFields.length > 0 ? initialFields : searchFields;

  const filteredFields = useMemo(() => {
    if (!search) return [];
    const q = search.toLowerCase();
    return availableFields.filter(f => 
      (f.fieldName || "").toLowerCase().includes(q) || 
      (f.fieldDisplayName || "").toLowerCase().includes(q) ||
      String(f.fieldId).includes(q)
    ).slice(0, 10);
  }, [availableFields, search]);

  const [activeProbe, setActiveProbe] = useState<string | null>(null);

  const downstreamImpacts = useMemo(() => {
    if (!field || !activeProbe) return [];
    
    // Find the numeric ID of the active option to match against rules that use IDs
    const activeOption = field.options?.find(o => o.fieldOptionValue === activeProbe);
    const probeIdentifiers = [
      String(activeProbe).toLowerCase(),
      activeOption ? String(activeOption.fieldOptionId) : null,
      activeProbe === "Yes" ? "true" : null,
      activeProbe === "No" ? "false" : null,
      activeProbe === "Yes" ? "1" : null,
      activeProbe === "No" ? "0" : null
    ].filter(Boolean);

    const fieldIdentifiers = [
      String(field.fieldId),
      String(field.ctgFieldName || "").toLowerCase(),
      String(field.fieldName || "").toLowerCase()
    ].filter(Boolean);

    const unfiltered = rawRules.filter(r => {
      const ruleSourceId = String(r.sourceId).toLowerCase();
      const matchId = fieldIdentifiers.includes(ruleSourceId) || String(r.sourceInternalId) === String(field.fieldId);
      
      // Match against the array of probe identifiers (Label, ID, Boolean equivalent)
      const ruleVal = String(r.conditionVal).toLowerCase();
      const matchVal = probeIdentifiers.some(p => String(p).toLowerCase() === ruleVal);
      
      return matchId && matchVal;
    });

    // Deduplicate by target (keep unique targets only)
    const seen = new Set();
    return unfiltered.filter(impact => {
      const key = `${impact.target}-${impact.targetType}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [field, activeProbe, rawRules]);

  const copyAsBlueprint = () => {
    if (!field) return;
    const blueprint = `
# Leah Configuration Blueprint: ${field.fieldDisplayName}
- **Metadata Key**: ${field.fieldName}
- **Field ID**: ${field.fieldId}
- **Type**: ${field.fieldType}
- **Mandatory Logic**: ${field.isRequired ? 'Universal' : 'Conditional'}

## Architectural Context
${field.comments || 'No design notes provided.'}

## Target Implementation
- Guidance: ${field.guidanceText || 'None'}
- Category: ${field.fieldGroup || 'Standard'}
- Display In Journey: ${field.displayInRequestJourney ? 'Yes' : 'No'}

## Matrix Configuration
- All App Types: ${field.isForAllApplicationTypes ? 'Yes' : 'No'}
- Associated Types: ${field.applicationTypeIds?.join(', ') || 'Global'}
    `;
    navigator.clipboard.writeText(blueprint.trim());
    setCopied(true);
    toast.success("Blueprint copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      {/* Backdrop */}
      <div 
        className={cn(
          "fixed inset-0 bg-black/60 backdrop-blur-md z-[100] transition-opacity duration-300",
          fieldId ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        onClick={onClose}
      />
      
      {/* Drawer */}
      <div 
        className={cn(
          "fixed right-0 top-0 bottom-0 w-[650px] bg-[#0c0c0e]/95 backdrop-blur-3xl border-l border-white/10 z-[101] shadow-2xl transition-transform duration-500 ease-out flex flex-col",
          fieldId ? "translate-x-0" : "translate-x-full"
        )}
      >
        {/* Header */}
        <div className="p-6 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
           <div className="flex items-center gap-4">
              <div className="h-10 w-10 bg-primary/10 rounded-xl flex items-center justify-center border border-primary/20">
                 <Fingerprint size={20} className="text-primary" />
              </div>
              <div>
                 <h3 className="text-lg font-black text-white tracking-tight">Configuration Blueprint</h3>
                 <p className="text-[10px] text-muted-foreground/40 uppercase font-black tracking-widest">Deep Logic Audit</p>
              </div>
           </div>
           <button onClick={onClose} className="h-8 w-8 rounded-lg hover:bg-white/5 flex items-center justify-center transition-colors">
              <X size={18} className="text-white/20" />
           </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-8">
           {isLoading ? (
             <div className="h-full flex flex-col items-center justify-center space-y-4 opacity-40">
                <Spinner />
                <span className="text-xs font-black uppercase tracking-widest">Inference in progress...</span>
             </div>
           ) : error ? (
             <div className="h-full flex flex-col items-center justify-center p-12 text-center space-y-6">
                <div className="h-20 w-20 bg-destructive/10 rounded-[2.5rem] flex items-center justify-center border border-destructive/20 shadow-[0_0_50px_rgba(239,68,68,0.1)]">
                   <ShieldAlert size={32} className="text-destructive" />
                </div>
                <div className="space-y-2">
                   <p className="text-lg font-black text-white uppercase tracking-tight italic">Node Not Restored</p>
                   <p className="text-[10px] text-white/20 font-black uppercase tracking-[0.2em] leading-relaxed max-w-[240px] mx-auto">
                      The metadata engine identified this field in a logic rule, but it could not be retrieved from the current environment context.
                   </p>
                </div>
                <Button variant="outline" size="sm" onClick={onClose} className="border-white/10 text-white/40 hover:text-white rounded-xl">
                   Back to Matrix
                </Button>
             </div>
           ) : field ? (
             <div className="space-y-8 animate-in fade-in slide-in-from-right-8 duration-700">
                {/* Field ID & Key */}
                <div className="flex items-center gap-3">
                   <div className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg">
                      <code className="text-[11px] font-black text-amber-400">ID: {field.fieldId}</code>
                   </div>
                   <div className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg">
                      <code className="text-[11px] font-bold text-white/40">{field.fieldName}</code>
                   </div>
                   <Badge variant="outline" className={cn("ml-auto px-3 border-emerald-500/20 text-emerald-400 bg-emerald-500/5")}>
                      {field.isActive ? "Active State" : "Suspended"}
                   </Badge>
                </div>

                <div className="space-y-2">
                   <h2 className="text-4xl font-black text-white tracking-tight leading-[1.1]">{field.fieldDisplayName}</h2>
                   <div className="flex items-center gap-3 text-xs text-muted-foreground font-medium">
                      <BookOpen size={14} className="text-primary/40" />
                      {field.fieldType} • {field.fieldGroup || "Uncategorized"}
                   </div>
                </div>

                <Tabs defaultValue="architecture" className="w-full">
                    <TabsList className="bg-white/5 border border-white/5 p-1 rounded-xl w-full">
                       <TabsTrigger value="architecture" className="flex-1 text-[9px] uppercase font-black tracking-widest py-2.5">Audit</TabsTrigger>
                       <TabsTrigger value="options" className="flex-1 text-[9px] uppercase font-black tracking-widest py-2.5">Options</TabsTrigger>
                       <TabsTrigger value="integrity" className="flex-1 text-[9px] uppercase font-black tracking-widest py-2.5">Matrix</TabsTrigger>
                       <TabsTrigger value="compare" className="flex-1 text-[9px] uppercase font-black tracking-widest py-2.5">Compare</TabsTrigger>
                       <TabsTrigger value="logic" className="flex-1 text-[9px] uppercase font-black tracking-widest py-2.5">JSON</TabsTrigger>
                    </TabsList>

                   <TabsContent value="architecture" className="pt-8 space-y-8">
                      <section className="space-y-4">
                         <div className="flex items-center gap-2 text-primary">
                            <Zap size={14} />
                            <span className="text-[10px] font-black uppercase tracking-widest">Implementation Rationale</span>
                         </div>
                         <div className="p-5 bg-primary/5 border border-primary/20 rounded-2xl italic text-sm text-white/70 leading-relaxed shadow-inner">
                            "{field.comments || "No design documentation recorded for this field in the implementation spec."}"
                         </div>
                      </section>

                      <div className="grid grid-cols-2 gap-4">
                         <div className="p-5 bg-white/5 border border-white/5 rounded-3xl space-y-2">
                            <span className="text-[9px] font-black text-white/20 uppercase tracking-[0.2em]">Extraction Engine</span>
                            <div className="text-xs font-bold text-white/50 flex items-center gap-2">
                               <Database size={12} className="text-primary" />
                               {field.metadataExtractionPromptId ? `Prompt Config #${field.metadataExtractionPromptId}` : "Standard Model"}
                            </div>
                         </div>
                         <div className="p-5 bg-white/5 border border-white/5 rounded-3xl space-y-2">
                            <span className="text-[9px] font-black text-white/20 uppercase tracking-[0.2em]">Default Visibility</span>
                            <div className="text-xs font-bold text-white/50 uppercase tracking-tighter">
                               {field.isVisible ? "Visible Default" : "Hidden Default"}
                            </div>
                         </div>
                      </div>

                      <section className="space-y-4">
                         <div className="flex items-center gap-2 text-white/40">
                            <BookOpen size={14} />
                            <span className="text-[10px] font-black uppercase tracking-widest">Guidance & Compliance</span>
                         </div>
                         <div className="p-5 bg-white/[0.02] border border-white/5 rounded-2xl text-xs text-muted-foreground leading-relaxed font-medium rich-text-content">
                            {field.guidanceText || field.helpText ? (
                              <div dangerouslySetInnerHTML={{ __html: field.guidanceText || field.helpText || "" }} />
                            ) : (
                              "No context-sensitive guidance configured for end-users."
                            )}
                         </div>
                      </section>
                   </TabsContent>                     <TabsContent value="options" className="pt-8 space-y-6">
                        <div className="flex items-center justify-between">
                           <div className="flex items-center gap-2 text-blue-400">
                              <ListIcon size={14} />
                              <span className="text-[10px] font-black uppercase tracking-widest">Selection Values</span>
                           </div>
                           <p className="text-[9px] text-white/20 uppercase font-black tracking-widest italic">Click option to probe downstream logic</p>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                           {field.options?.map(opt => (
                             <button 
                              key={opt.fieldOptionId} 
                              onClick={() => setActiveProbe(activeProbe === opt.fieldOptionValue ? null : opt.fieldOptionValue)}
                              className={cn(
                                "flex flex-col gap-2 p-4 border rounded-2xl transition-all duration-300 text-left group/opt relative overflow-hidden",
                                activeProbe === opt.fieldOptionValue 
                                  ? "bg-blue-500/10 border-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.1)]" 
                                  : "bg-white/5 border-white/5 hover:border-white/10"
                              )}
                             >
                                <div className="flex items-center justify-between">
                                   <span className={cn("text-xs font-bold transition-colors", activeProbe === opt.fieldOptionValue ? "text-blue-400" : "text-white/80")}>
                                      {opt.fieldOptionValue}
                                   </span>
                                   {opt.isDefault && <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-[8px] font-black uppercase tracking-widest h-4 px-1">Default</Badge>}
                                </div>
                                <div className="flex items-center gap-2 mt-auto">
                                   <Badge variant="outline" className="text-[8px] font-mono border-white/10 text-white/30 px-1.5 h-4 uppercase">ID: {opt.fieldOptionId}</Badge>
                                   {opt.numericValue !== null && opt.numericValue !== undefined && (
                                     <Badge variant="secondary" className="text-[8px] font-black bg-violet-500/10 text-violet-400 border-none px-1.5 h-4 uppercase">VAL: {opt.numericValue}</Badge>
                                   )}
                                </div>
                                
                                {activeProbe === opt.fieldOptionValue && (
                                  <div className="absolute right-[-10px] bottom-[-10px] opacity-10 rotate-[-15deg]">
                                     <Network size={48} />
                                  </div>
                                )}
                             </button>
                           ))}
                        </div>

                        {activeProbe && (
                          <div className="space-y-4 pt-4 animate-in slide-in-from-bottom-4 duration-500">
                             <div className="flex items-center gap-2 text-amber-400">
                                <Network size={14} />
                                <span className="text-[10px] font-black uppercase tracking-widest">Propagation Trace: {activeProbe}</span>
                             </div>

                             <div className="space-y-2">
                                {downstreamImpacts.length > 0 ? downstreamImpacts.map((impact, idx) => (
                                  <div 
                                    key={idx} 
                                    className={cn(
                                       "p-4 border rounded-2xl flex items-center justify-between group/impact transition-all duration-300",
                                       impact.targetActive 
                                          ? "bg-white/[0.02] border-white/5 hover:bg-white/5" 
                                          : "bg-red-500/5 border-red-500/10 opacity-60 grayscale-[0.5]"
                                    )}
                                  >
                                     <div className="flex items-center gap-4">
                                        <div className="flex flex-col">
                                           <span className={cn(
                                              "text-[10px] font-black uppercase tracking-widest mb-0.5",
                                              impact.targetActive ? "text-white/30" : "text-red-400/40"
                                           )}>
                                              Triggers Display of
                                           </span>
                                           <div className="flex items-center gap-2">
                                              <span className={cn(
                                                "text-sm font-bold",
                                                impact.targetActive ? "text-white/70" : "text-red-400/80 line-through decoration-red-500/50"
                                              )}>
                                                 {impact.target}
                                              </span>
                                              {!impact.targetActive && (
                                                <Badge className="bg-red-500/10 text-red-500 border-red-500/20 text-[8px] font-black px-1.5 h-4 uppercase tracking-widest leading-none">
                                                   Inactive
                                                </Badge>
                                              )}
                                           </div>
                                           {impact.targetType?.toLowerCase().includes("guidance") && impact.targetGuidance && (
                                             <div 
                                               className="mt-2 p-3 bg-white/[0.03] border border-white/5 rounded-xl text-[10px] text-white/40 leading-relaxed italic line-clamp-2 rich-text-content"
                                               dangerouslySetInnerHTML={{ __html: impact.targetGuidance }}
                                             />
                                           )}
                                        </div>
                                     </div>
                                     <div className="flex items-center gap-4">
                                        <div className="flex flex-col items-end">
                                           <span className={cn(
                                              "text-[9px] font-bold uppercase",
                                              impact.targetActive ? "text-blue-400/60" : "text-red-400/40"
                                           )}>
                                              {impact.targetType}
                                           </span>
                                           {impact.targetRequired && (
                                             <span className={cn(
                                                "text-[8px] font-black uppercase",
                                                impact.targetActive ? "text-amber-500/60" : "text-red-500/40"
                                             )}>
                                                Mandatory
                                             </span>
                                           )}
                                        </div>
                                        <div className="h-8 w-8 rounded-lg bg-white/5 flex items-center justify-center opacity-0 group-hover/impact:opacity-100 transition-opacity">
                                           <Zap size={14} className={impact.targetActive ? "text-amber-400" : "text-red-400/40"} />
                                        </div>
                                     </div>
                                  </div>
                                )) : (
                                  <div className="p-8 text-center bg-white/[0.01] border border-dashed border-white/5 rounded-3xl">
                                     <p className="text-[10px] text-white/20 uppercase font-black tracking-widest italic">No direct logic triggers found for this option</p>
                                  </div>
                                )}
                             </div>
                          </div>
                        )}

                        {(!field.options || field.options.length === 0) && (
                          <div className="py-20 text-center bg-white/[0.01] border border-dashed border-white/5 rounded-[2rem]">
                             <ListIcon size={32} className="mx-auto text-white/5 mb-4" />
                             <p className="text-[10px] text-white/20 uppercase font-black tracking-[0.2em]">Zero Options Configured</p>
                          </div>
                        )}
                     </TabsContent>

                    <TabsContent value="integrity" className="pt-8 space-y-8">
                      <div className="flex items-center justify-between">
                         <div className="flex items-center gap-2 text-amber-400">
                            <ShieldAlert size={14} />
                            <span className="text-[10px] font-black uppercase tracking-widest">Configuration Matrix</span>
                         </div>
                         <div className="text-[10px] font-bold text-white/20 uppercase tracking-[0.1em]">
                            {field.applicationTypeMandatoryData?.filter(m => m.isMandatory).length} Contextual Overrides
                         </div>
                      </div>

                      <div className="space-y-2.5">
                         {field.applicationTypeMandatoryData?.map(m => (
                           <div key={m.applicationTypeId} className="flex items-center justify-between p-4 bg-white/5 border border-white/5 rounded-2xl hover:border-white/10 transition-colors">
                              <span className="text-xs font-bold text-white/60">Application Context ID: {m.applicationTypeId}</span>
                              <Badge variant={m.isMandatory ? "default" : "outline"} className={cn("text-[8px] font-black px-3 py-1 uppercase tracking-widest", m.isMandatory ? "bg-amber-500/10 text-amber-500 border-amber-500/20" : "opacity-10")}>
                                {m.isMandatory ? "Mandatory" : "Optional"}
                              </Badge>
                           </div>
                         ))}
                         {(!field.applicationTypeMandatoryData || field.applicationTypeMandatoryData.length === 0) && (
                           <div className="py-20 text-center space-y-4">
                              <ShieldAlert size={32} className="mx-auto text-white/5" />
                              <p className="text-[10px] text-white/10 uppercase font-black tracking-[0.3em] italic">
                                 No Mandatory Matrix Detected
                              </p>
                           </div>
                         )}
                      </div>
                   </TabsContent>

                    <TabsContent value="compare" className="pt-8 space-y-8">
                       <div className="space-y-4">
                          <div className="flex items-center gap-2 text-violet-400">
                             <ArrowLeftRight size={14} />
                             <span className="text-[10px] font-black uppercase tracking-widest">Side-by-Side Audit</span>
                          </div>
                          <div className="relative group">
                             <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20 group-focus-within:text-violet-400 transition-colors" />
                             <Input 
                                placeholder="Search field to compare..." 
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="pl-11 bg-white/5 border-white/10 rounded-2xl h-12 text-sm focus:ring-violet-500/40 transition-all"
                             />
                             {search && filteredFields.length > 0 && (
                               <div className="absolute top-full left-0 right-0 mt-2 bg-[#1a1a1e] border border-white/10 rounded-2xl shadow-2xl z-50 overflow-hidden divide-y divide-white/5">
                                  {filteredFields.map(f => (
                                    <button 
                                      key={f.fieldId} 
                                      onClick={() => { setCompareId(f.fieldId); setSearch(""); }}
                                      className="w-full px-5 py-3 text-left hover:bg-white/5 flex items-center justify-between group/res"
                                    >
                                       <div className="flex flex-col">
                                          <span className="text-xs font-bold text-white/70 group-hover/res:text-white transition-colors">{f.fieldDisplayName}</span>
                                          <span className="text-[9px] font-mono text-white/20 uppercase">{f.fieldName}</span>
                                       </div>
                                       <span className="text-[10px] font-black text-white/10">#{f.fieldId}</span>
                                    </button>
                                  ))}
                               </div>
                             )}
                          </div>
                       </div>

                       {compareId && compareField ? (
                         <div className="grid grid-cols-2 gap-4 animate-in zoom-in-95 duration-500">
                            {/* Left Side: Current */}
                            <div className="space-y-4">
                               <div className="p-3 bg-primary/5 border border-primary/20 rounded-xl text-center">
                                  <span className="text-[9px] font-black text-primary uppercase">Reference Node</span>
                               </div>
                               <div className="space-y-2">
                                  <CompareRow label="System Key" val={field.fieldName} />
                                  <CompareRow label="Type" val={field.fieldType} />
                                  <CompareRow label="Status" val={field.isActive ? "Active" : "Suspended"} />
                                  <CompareRow label="Is Mandatory" val={field.isRequired ? "Universal" : "Conditional"} />
                                  <CompareRow label="Visible" val={field.isVisible ? "Yes" : "No"} />
                                  <div className="p-4 bg-white/5 border border-white/5 rounded-2xl text-[10px] text-white/40 italic leading-relaxed">
                                     {field.comments || "No rationale."}
                                  </div>
                               </div>
                            </div>
                            {/* Right Side: Comparison */}
                            <div className="space-y-4">
                               <div className="p-3 bg-violet-500/5 border border-violet-500/20 rounded-xl text-center relative group">
                                  <span className="text-[9px] font-black text-violet-400 uppercase">Audit Target</span>
                                  <button onClick={() => setCompareId(null)} className="absolute right-2 top-1/2 -translate-y-1/2 text-white/20 hover:text-white transition-colors opacity-0 group-hover:opacity-100">
                                     <X size={10} />
                                  </button>
                               </div>
                               <div className="space-y-2">
                                  <CompareRow label="System Key" val={compareField.fieldName} highlight={field.fieldName !== compareField.fieldName} />
                                  <CompareRow label="Type" val={compareField.fieldType} highlight={field.fieldType !== compareField.fieldType} />
                                  <CompareRow label="Status" val={compareField.isActive ? "Active" : "Suspended"} highlight={field.isActive !== compareField.isActive} />
                                  <CompareRow label="Is Mandatory" val={compareField.isRequired ? "Universal" : "Conditional"} highlight={field.isRequired !== compareField.isRequired} />
                                  <CompareRow label="Visible" val={compareField.isVisible ? "Yes" : "No"} highlight={field.isVisible !== compareField.isVisible} />
                                  <div className={cn("p-4 bg-white/5 border border-white/5 rounded-2xl text-[10px] leading-relaxed", field.comments !== compareField.comments ? "text-violet-400 border-violet-500/20 bg-violet-500/5" : "text-white/40 italic")}>
                                     {compareField.comments || "No rationale."}
                                  </div>
                               </div>
                            </div>
                         </div>
                       ) : (
                         <div className="py-24 text-center space-y-4 bg-white/[0.01] border border-dashed border-white/5 rounded-[3rem]">
                            <Dna size={40} className="mx-auto text-white/5" />
                            <div className="space-y-1">
                               <p className="text-[11px] font-black text-white/30 uppercase tracking-[0.2em]">Select Target to Compare</p>
                               <p className="text-[9px] text-white/10 italic">Audit differences in rationale, matrix, and schema</p>
                            </div>
                         </div>
                       )}
                    </TabsContent>

                   <TabsContent value="logic" className="pt-8 space-y-6">
                      <div className="flex items-center gap-2 text-emerald-400">
                         <FileJson size={14} />
                         <span className="text-[10px] font-black uppercase tracking-widest">Source Configuration Logic</span>
                      </div>
                      <div className="bg-black/80 rounded-3xl border border-white/10 p-6 overflow-hidden relative group">
                         <button 
                          onClick={() => {
                            navigator.clipboard.writeText(JSON.stringify(field.visibilityConditions || field.visibilityCondition || {}, null, 2));
                            toast.success("JSON copied");
                          }}
                          className="absolute top-5 right-5 p-2 bg-white/5 hover:bg-white/10 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                         >
                            <Copy size={12} className="text-white/40" />
                         </button>
                         <code className="text-[10px] text-emerald-400/80 leading-relaxed font-mono block whitespace-pre-wrap break-all">
                            {JSON.stringify(field.visibilityConditions || field.visibilityCondition || {}, null, 2)}
                         </code>
                      </div>
                   </TabsContent>
                </Tabs>
             </div>
           ) : null}
        </div>

        {/* Footer */}
        <div className="p-8 border-t border-white/5 mt-auto bg-white/[0.01]">
           <Button 
            onClick={copyAsBlueprint}
            disabled={!field}
            className="w-full h-14 gap-3 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 font-black uppercase tracking-[0.2em] text-[11px] rounded-2xl shadow-xl shadow-primary/5 transition-all"
           >
              {copied ? <Check size={18} /> : <BookOpen size={18} />}
              {copied ? "Blueprint Copied" : "Generate Implementation Blueprint"}
           </Button>
        </div>
      </div>
    </>
  );
}
function CompareRow({ label, val, highlight }: { label: string; val: string | number; highlight?: boolean }) {
  return (
    <div className={cn(
      "p-3 rounded-xl border border-white/5 flex flex-col gap-0.5",
      highlight ? "bg-amber-500/10 border-amber-500/30" : "bg-white/[0.02]"
    )}>
      <span className="text-[8px] font-black text-white/20 uppercase tracking-widest">{label}</span>
      <span className={cn("text-[11px] font-bold truncate", highlight ? "text-amber-400" : "text-white/60")}>{val}</span>
    </div>
  );
}
