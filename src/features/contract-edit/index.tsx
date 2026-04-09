import { useState, useCallback, memo } from "react";
import { toast } from "sonner";
import { Search, Edit3, ChevronRight, FileText, Check, Layers, ArrowRight, Filter, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PageHeader, Spinner } from "@/components/shared/PageHeader";
import { useAppTypes, useContracts, useContractDetail, useIntakeFieldMap, useFieldOptionsMap, useUpdateContractMutation } from "./hooks";
import { ContractEditDrawer } from "./components/ContractEditDrawer";
import { ApplicationType, ContractListItem } from "@/types";
import { fmtDate, stageToBadge, cn } from "@/lib/utils";
import { useApiClients } from "@/hooks/useApiClients";
import { useAuthStore } from "@/store/authStore";
import { bulkUpdateStage } from "@/api/contractRequest";
import { useMutation, useQueryClient } from "@tanstack/react-query";

// Helper to determine if an app type is "Priority" based on common high-volume types
const isPriority = (at: ApplicationType) => {
  const name = (at.applicationTypeName || "").toLowerCase();
  return ["dealer", "distributor", "agent", "vendor", "sales"].some(w => name.includes(w));
};

export default function ContractEditPage() {
  const [selAppType, setSelAppType] = useState<ApplicationType | null>(null);
  const [searchQ, setSearchQ] = useState("");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkStageId, setBulkStageId] = useState<number | null>(null);

  const clients = useApiClients();
  const { tenant } = useAuthStore();
  const queryClient = useQueryClient();

  const { data: appTypes, isLoading: atLoading } = useAppTypes();
  const { data: contracts, isLoading: cLoading } = useContracts(selAppType?.applicationTypeId ?? null, {
    PageNumber: page,
    PageSize: 50,
    RequestIdSearch: searchQ || undefined,
  });
  const { data: detail, isLoading: dLoading } = useContractDetail(openId);
  const intakeMap = useIntakeFieldMap(selAppType?.applicationTypeId ?? null);
  const fieldOptionsMap = useFieldOptionsMap(selAppType?.applicationTypeId ?? null);
  const updateMutation = useUpdateContractMutation();

  const handleSearch = useCallback(() => {
    const q = searchQ.trim();
    if (!q) return;
    if (/^\d+$/.test(q)) {
      setOpenId(Number(q));
    }
  }, [searchQ]);

  const bulkMutation = useMutation({
    mutationFn: (stageId: number) =>
      bulkUpdateStage(clients!.newCloud, tenant, {
        requestId: Array.from(selectedIds),
        workflowStageId: stageId,
      }),
    onSuccess: (res) => {
      toast.success(res.data || "Bulk update successful");
      setSelectedIds(new Set());
      setBulkStageId(null);
      queryClient.invalidateQueries({ queryKey: ["contracts"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === (contracts?.data.length ?? 0)) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(contracts?.data.map((c) => c.id)));
    }
  };

  if (!selAppType) {
    const priority = (appTypes ?? []).filter(isPriority);
    const others = (appTypes ?? []).filter(at => !isPriority(at));

    return (
      <div className="animate-in fade-in duration-500">
        <PageHeader 
          title="Contract Navigator" 
          description="High-fidelity workspace for platform-wide contract synchronization" 
        />
        
        {atLoading && (
          <div className="flex flex-col items-center justify-center py-32 space-y-4">
             <Spinner size={32} className="text-amber-500" />
             <span className="text-[10px] uppercase tracking-[0.2em] font-black text-muted-foreground animate-pulse">Scanning Cloud Instance</span>
          </div>
        )}

        <div className="space-y-10 pb-20">
          <div className="space-y-4">
             <div className="flex items-center gap-3 px-2">
               <Layers size={14} className="text-blue-500" />
               <h3 className="text-[11px] font-black text-blue-500 uppercase tracking-[0.25em]">Global View</h3>
             </div>
             <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                <AppTypeCard 
                  at={{ applicationTypeId: -1, applicationTypeName: "All Frameworks", applicationName: "Global Contract Asset View" } as ApplicationType} 
                  onClick={() => { setSelAppType({ applicationTypeId: -1, applicationTypeName: "All Frameworks" } as ApplicationType); setPage(1); setSearchQ(""); }} 
                />
             </div>
          </div>

          {priority.length > 0 && (
            <div className="space-y-4">
               <div className="flex items-center gap-3 px-2">
                 <Star size={14} className="text-amber-500 fill-amber-500/20" />
                 <h3 className="text-[11px] font-black text-amber-500 uppercase tracking-[0.25em]">Priority Workflows</h3>
               </div>
               <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {priority.map(at => (
                    <AppTypeCard key={at.applicationTypeId} at={at} onClick={() => { setSelAppType(at); setPage(1); setSearchQ(""); }} isPriority />
                  ))}
               </div>
            </div>
          )}

          {others.length > 0 && (
            <div className="space-y-4">
               <div className="flex items-center gap-3 px-2">
                 <Filter size={14} className="text-muted-foreground opacity-50" />
                 <h3 className="text-[11px] font-black text-muted-foreground uppercase tracking-[0.25em]">Standard Frameworks</h3>
               </div>
               <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {others.map(at => (
                    <AppTypeCard key={at.applicationTypeId} at={at} onClick={() => { setSelAppType(at); setPage(1); setSearchQ(""); }} />
                  ))}
               </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="animate-in fade-in duration-500">
      <div className="sticky top-0 bg-background/80 backdrop-blur-md z-20 -mx-4 px-4 pb-4 border-b border-border/50 mb-6">
        <div className="flex items-center justify-between py-4">
           <div className="flex items-center gap-4">
              <button 
                onClick={() => setSelAppType(null)}
                className="p-2 hover:bg-muted rounded-xl transition-all text-muted-foreground hover:text-amber-500"
              >
                <ChevronRight size={20} className="rotate-180" />
              </button>
              <div>
                <h1 className="text-2xl font-black tracking-tight flex items-center gap-3">
                  {selAppType.applicationTypeName}
                </h1>
                <div className="flex items-center gap-3 mt-1.5 font-mono text-[10px]">
                  <span className="text-muted-foreground bg-muted px-2 py-0.5 rounded-lg border border-border/40 uppercase font-bold">TYPE ID {selAppType.applicationTypeId}</span>
                  <span className="text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded-lg border border-amber-500/20 font-bold">{contracts?.totalRecords ?? 0} ASSETS</span>
                </div>
              </div>
           </div>
           <div className="hidden sm:flex items-center gap-3 bg-muted/30 p-1.5 rounded-2xl border border-border/50">
             <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input 
                   className="pl-9 h-10 w-64 bg-background border-none shadow-none rounded-xl focus-visible:ring-1 focus-visible:ring-amber-500/50" 
                   placeholder="Direct Search (Request ID)..." 
                   value={searchQ} 
                   onChange={(e) => setSearchQ(e.target.value)} 
                   onKeyDown={(e) => e.key === "Enter" && handleSearch()} 
                />
             </div>
             <Button onClick={handleSearch} size="sm" className="h-10 rounded-xl px-6 bg-amber-500 text-black hover:bg-amber-400 font-bold">COMMIT SEARCH</Button>
           </div>
        </div>
      </div>

      <div className="space-y-6">
        {!cLoading && (contracts?.data ?? []).length > 0 && (
          <div className="grid grid-cols-[40px_100px_110px_1fr_160px_40px] gap-4 px-6 pb-2 text-[10px] font-black text-muted-foreground uppercase tracking-[0.15em]">
            <input
              type="checkbox"
              checked={selectedIds.size > 0 && selectedIds.size === contracts?.data.length}
              onChange={toggleAll}
              className="rounded border-border accent-amber-500"
            />
            <span>Reference</span><span>Registry ID</span><span>Asset Manifest</span><span>Status</span><span />
          </div>
        )}

        {cLoading && <div className="flex justify-center py-32"><Spinner size={40} className="text-amber-500" /></div>}

        {!cLoading && (contracts?.data ?? []).length === 0 && (
          <div className="bg-muted/10 border border-dashed border-border rounded-3xl py-24 flex flex-col items-center text-center px-6">
             <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-6">
                <FileText size={32} className="text-muted-foreground/40" />
             </div>
             <h3 className="text-lg font-bold">No Records Identified</h3>
             <p className="text-sm text-muted-foreground mt-1 max-w-[280px]">Try targeting a specific Request ID in the global filter above.</p>
          </div>
        )}

        <div className="space-y-3 relative pb-32">
          {(contracts?.data ?? []).map((c) => (
            <ContractRow
              key={c.id}
              contract={c}
              onClick={() => setOpenId(c.id)}
              onSelect={() => toggleSelect(c.id)}
              isSelected={selectedIds.has(c.id)}
            />
          ))}

          {/* Bulk Action Float Bar - Premium Glass styling */}
          {selectedIds.size > 0 && (
            <div className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-[#0b0e14]/90 backdrop-blur-xl border border-white/5 shadow-[0_32px_64px_rgba(0,0,0,0.8)] rounded-3xl px-8 py-5 flex items-center gap-8 animate-in fade-in slide-in-from-bottom-8 duration-500 z-50">
              <div className="flex flex-col">
                <span className="text-[10px] font-black text-amber-500 uppercase tracking-widest leading-none mb-1">Queue Size</span>
                <span className="text-lg font-black text-white leading-none">{selectedIds.size} Assets</span>
              </div>
              <div className="h-8 w-[1px] bg-white/10" />
              <div className="flex gap-4">
                <Button
                  size="lg"
                  className="gap-3 rounded-2xl h-14 px-8 bg-white text-black hover:bg-white/90 font-black tracking-tight"
                  onClick={() => setBulkStageId(0)}
                >
                  <Layers size={18} />
                  COMMIT BULK STAGE CHANGE
                </Button>
                <Button
                  variant="ghost"
                  size="lg"
                  className="rounded-2xl h-14 px-8 text-white hover:bg-white/5 border border-white/10 font-bold"
                  onClick={() => setSelectedIds(new Set())}
                >
                  ABORT
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Global Pagination Context */}
        {(contracts?.totalRecords ?? 0) > 50 && (
          <div className="flex items-center justify-between bg-muted/10 border border-border/50 rounded-2xl p-6 mt-8">
            <div className="text-xs font-bold text-muted-foreground tracking-widest uppercase">
               Batch Overview <span className="text-foreground ml-2">Displaying {contracts?.data.length} of {contracts?.totalRecords} Assets</span>
            </div>
            <div className="flex gap-3">
              <Button 
                variant="outline" 
                size="sm" 
                disabled={page <= 1} 
                onClick={() => { setPage(p => p - 1); window.scrollTo(0,0); }}
                className="rounded-xl border-border px-6 h-10 font-bold"
              >
                PREVIOUS SEGMENT
              </Button>
              <div className="flex items-center justify-center bg-background border border-border px-4 rounded-xl text-xs font-black mono min-w-[60px]">
                {page}
              </div>
              <Button 
                variant="outline" 
                size="sm" 
                disabled={(contracts?.data.length ?? 0) < 50} 
                onClick={() => { setPage(p => p + 1); window.scrollTo(0,0); }}
                className="rounded-xl border-border px-6 h-10 font-bold"
              >
                NEXT SEGMENT
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Edit High-Fidelity Drawer */}
      {openId && (
        <ContractEditDrawer
          detail={detail ?? null}
          loading={dLoading}
          intakeFieldMap={intakeMap}
          fieldOptionsMap={fieldOptionsMap}
          onClose={() => { setOpenId(null); }}
          onSave={async (det, edits, desc) => {
            await updateMutation.mutateAsync({ detail: det, editedFields: edits, editedDescription: desc });
            toast.success("Synchronization successful");
          }}
          saving={updateMutation.isPending}
          saveError={updateMutation.error ? (updateMutation.error as Error).message : null}
        />
      )}

      {/* Bulk Pipeline Modal */}
      {bulkStageId !== null && (
        <div className="fixed inset-0 flex items-center justify-center z-[1001] animate-in fade-in duration-300">
          <div className="fixed inset-0 bg-black/80 backdrop-blur-md" onClick={() => setBulkStageId(null)} />
          <div className="w-full max-w-lg bg-[#0b0e14] border border-[#252d3d] rounded-3xl shadow-[0_50px_100px_rgba(0,0,0,0.9)] p-8 z-[1002] animate-in zoom-in-95 duration-300">
            <div className="flex items-center gap-4 mb-8">
               <div className="p-3 bg-amber-500/10 rounded-2xl">
                  <Layers size={24} className="text-amber-500" />
               </div>
               <div>
                  <h3 className="text-xl font-black text-white tracking-tight leading-none mb-1">Bulk Pipeline Shift</h3>
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-2">
                    Affecting {selectedIds.size} queued objects
                  </p>
               </div>
            </div>
            
            <div className="space-y-8">
              <div className="space-y-4">
                <label className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em] block">New Target Phase</label>
                <div className="relative group">
                    <select
                        className="w-full h-14 bg-[#131820] border border-[#252d3d] group-hover:border-[#3a4a62] rounded-2xl px-5 text-sm font-bold text-white focus:ring-2 focus:ring-amber-500/30 outline-none transition-all appearance-none cursor-pointer"
                        onChange={(e) => setBulkStageId(Number(e.target.value))}
                    >
                        <option value="">Select Target Workflow Phase...</option>
                        {(selAppType.applicationStatuses ?? []).map((s) => (
                            <option key={s.statusId} value={s.statusId} className="bg-[#131820]">{s.statusName}</option>
                        ))}
                    </select>
                    <ChevronRight size={18} className="absolute right-5 top-1/2 -translate-y-1/2 rotate-90 text-[#2d3a52] group-hover:text-amber-500 transition-colors" />
                </div>
              </div>

              <div className="flex gap-4 pt-4">
                <Button 
                    variant="ghost" 
                    onClick={() => setBulkStageId(null)}
                    className="flex-1 h-14 rounded-2xl font-bold border-[#252d3d] text-white hover:bg-white/5"
                >
                    ABORT
                </Button>
                <Button
                  disabled={!bulkStageId || bulkMutation.isPending}
                  onClick={() => bulkMutation.mutate(bulkStageId)}
                  className="flex-[2] h-14 rounded-2xl font-black bg-amber-500 text-black hover:bg-amber-400 gap-3"
                >
                  {bulkMutation.isPending ? <Spinner size={20} className="text-black" /> : <Layers size={20} />}
                  EXECUTE SHIFT
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const AppTypeCard = memo(({ at, onClick, isPriority }: { at: ApplicationType, onClick: () => void, isPriority?: boolean }) => (
  <button 
    onClick={onClick}
    className={cn(
      "text-left bg-card/40 border-1.5 border-[#252d3d] rounded-[24px] p-6 hover:bg-[#131820] transition-all duration-300 group relative overflow-hidden",
      isPriority ? "border-amber-500/30 hover:border-amber-500/60 shadow-[0_10px_30px_rgba(240,165,0,0.05)]" : "hover:border-[#3a4a62]"
    )}
  >
    <div className="flex items-start justify-between relative z-10 mb-6">
       <div className={cn(
         "p-3 rounded-2xl border transition-all duration-300 group-hover:scale-110",
         isPriority ? "bg-amber-500/10 border-amber-500/20 text-amber-500" : "bg-[#181e28] border-[#252d3d] text-muted-foreground group-hover:text-white"
       )}>
          <FileText size={20} />
       </div>
       <div className="flex flex-col items-end">
          <div className="text-[9px] font-black mono text-muted-foreground/60 transition-opacity">ID {at.applicationTypeId}</div>
          <ArrowRight size={14} className="mt-2 text-muted-foreground opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
       </div>
    </div>
    
    <div className="relative z-10 space-y-1">
      <div className="text-sm font-black leading-tight text-[#e2e8f0] group-hover:text-white transition-colors uppercase tracking-tight">{at.applicationTypeName}</div>
      {at.applicationName && <div className="text-[10px] text-muted-foreground font-bold tracking-wide">{at.applicationName}</div>}
    </div>

    {isPriority && (
       <div className="absolute -bottom-6 -right-6 w-24 h-24 bg-amber-500/5 blur-3xl rounded-full" />
    )}
  </button>
));

function ContractRow({
  contract,
  onClick,
  onSelect,
  isSelected
}: {
  contract: ContractListItem;
  onClick: () => void;
  onSelect: () => void;
  isSelected: boolean;
}) {
  const stage = contract.workflowStage ?? "STAGED";
  const party = contract.legalParties?.[0]?.name ?? contract.description ?? `SNAPSHOT #${contract.id}`;
  
  return (
    <div
      className={cn(
        "grid grid-cols-[40px_100px_110px_1fr_160px_40px] gap-4 items-center px-6 py-4.5 bg-[#131820]/40 border-1.5 rounded-[22px] transition-all duration-300 group",
        isSelected 
            ? "border-amber-500/50 bg-amber-500/10 shadow-[0_10px_30px_rgba(240,165,0,0.08)]" 
            : "border-[#252d3d] hover:border-[#3a4a62] hover:bg-[#131820]"
      )}
    >
      <div className="flex justify-center" onClick={(e) => { e.stopPropagation(); onSelect(); }}>
        <div className={cn(
          "w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all duration-300 cursor-pointer",
          isSelected ? "bg-amber-500 border-amber-500 text-black shadow-lg shadow-amber-500/20" : "border-[#252d3d] bg-[#0b0e14] group-hover:border-amber-500/40"
        )}>
          {isSelected && <Check size={14} strokeWidth={4} />}
        </div>
      </div>
      
      <div onClick={onClick} className="contents">
        <span className="mono text-[13px] font-black text-amber-500 tracking-tighter">#{contract.id}</span>
        <span className={cn("mono text-[11px] font-bold", contract.recordId ? "text-blue-400" : "text-[#2d3a52]")}>
          {contract.recordId ? `#REC-${contract.recordId}` : "—"}
        </span>
        
        <div className="min-w-0 pr-4">
          <div className="text-[14px] font-extrabold text-[#e2e8f0] group-hover:text-white truncate transition-colors leading-tight mb-1">{party}</div>
          <div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground/60 uppercase tracking-wide">
             <span className="truncate">{contract.addedByName || 'System Auto'}</span>
             <div className="w-1 h-1 rounded-full bg-muted-foreground/30" />
             <span className="shrink-0">{fmtDate(contract.addedOn)}</span>
          </div>
        </div>

        <div className="justify-self-start">
            <Badge 
                variant={stageToBadge(stage)} 
                className="text-[9px] font-black uppercase tracking-[0.1em] px-2.5 py-1 rounded-lg border-opacity-50"
            >
                {stage}
            </Badge>
        </div>

        <div className="justify-self-end text-muted-foreground/30 group-hover:text-amber-500 transition-all group-hover:scale-125">
            <Edit3 size={16} />
        </div>
      </div>
    </div>
  );
}
