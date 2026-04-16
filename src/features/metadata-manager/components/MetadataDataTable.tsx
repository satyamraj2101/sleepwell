import React, {
  useMemo,
  useState
} from "react";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
  getSortedRowModel,
  SortingState,
  getFilteredRowModel,
  ColumnFiltersState,
} from "@tanstack/react-table";
import {
  Search,
  ArrowUpDown,
  FilterX,
  ExternalLink,
  BookOpen,
  Edit2,
  MoreHorizontal,
  GitBranch,
  Trash2,
  AlertTriangle
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { FieldDefinition } from "@/types";

interface MetadataDataTableProps {
  data: FieldDefinition[];
  onEdit: (field: FieldDefinition) => void;
  onDelete: (field: FieldDefinition) => void;
  onInspect: (id: number) => void;
  onSelectionChange: (ids: number[]) => void;
  onBulkEdit: () => void;
  onResetFilters: () => void;
  globalSearch: string;
  onSearchChange: (v: string) => void;
  isLoading?: boolean;
}

export function MetadataDataTable({ 
  data, 
  onEdit, 
  onDelete, 
  onInspect, 
  onSelectionChange,
  onBulkEdit,
  onResetFilters,
  globalSearch,
  onSearchChange,
  isLoading: _isLoading
}: MetadataDataTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [rowSelection, setRowSelection] = useState({});
  const [expanded, setExpanded] = useState({});

  // Sync selection to parent
  React.useEffect(() => {
    const selectedIds = Object.keys(rowSelection).map(idx => data[Number(idx)]?.fieldId).filter(Boolean);
    onSelectionChange(selectedIds);
  }, [rowSelection, data, onSelectionChange]);

  const columns = useMemo<ColumnDef<FieldDefinition>[]>(() => [
    {
      id: "select",
      header: ({ table }) => (
        <Checkbox
          checked={table.getIsAllPageRowsSelected()}
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="Select all"
          className="translate-y-[2px] border-white/20"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label="Select row"
          className="translate-y-[2px] border-white/20"
        />
      ),
      enableSorting: false,
      enableHiding: false,
    },
    {
      accessorKey: "fieldDisplayName",
      header: ({ column }) => (
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3 h-8 text-xs font-black uppercase tracking-widest text-muted-foreground/50 hover:text-primary transition-colors"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Field Name
          <ArrowUpDown className="ml-2 h-3 w-3" />
        </Button>
      ),
      cell: ({ row }) => {
         const f = row.original;
         return (
           <div className="flex flex-col min-w-[240px]">
             <span className="text-[13px] font-bold text-white/90 truncate" title={f.fieldDisplayName}>
               {f.fieldDisplayName || f.fieldName}
             </span>
             <span className="text-[10px] font-mono text-muted-foreground/40 lowercase truncate">
               {f.fieldName}
             </span>
           </div>
         );
      },
    },
    {
      accessorKey: "fieldType",
      header: "Type",
      cell: ({ row }) => {
        const type = row.getValue("fieldType") as string;
        const color = typeColor(type);
        return (
          <Badge variant="outline" className={cn("text-[8px] font-black uppercase tracking-widest px-2 py-0.5", color.bg, color.text, color.border)}>
            {type || "—"}
          </Badge>
        );
      },
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => {
        const f = row.original;
        const isRequired = f.isMandatoryField ?? f.isRequired;
        return (
          <TooltipProvider delayDuration={0}>
            <div className="flex items-center gap-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="p-1">
                    <StatusDot active={f.isActive} color={f.isActive ? "green" : "gray"} tooltip={f.isActive ? "Active in Leah" : "Inactive / Draft"} />
                  </div>
                </TooltipTrigger>
                <TooltipContent className="bg-neutral-900 border-white/10 text-[10px] uppercase font-black tracking-widest">
                  {f.isActive ? "Active in Leah" : "Inactive / Draft"}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="p-1">
                    <StatusDot active={isRequired} color={isRequired ? "amber" : "gray"} tooltip={isRequired ? "Mandatory / Required" : "Optional Field"} />
                  </div>
                </TooltipTrigger>
                <TooltipContent className="bg-neutral-900 border-white/10 text-[10px] uppercase font-black tracking-widest text-amber-400">
                  {isRequired ? "Mandatory / Required" : "Optional Field"}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="p-1">
                    <StatusDot active={f.isVisible !== false} color={f.isVisible !== false ? "blue" : "gray"} tooltip={f.isVisible !== false ? "Visible on Forms" : "Hidden from Layout"} />
                  </div>
                </TooltipTrigger>
                <TooltipContent className="bg-neutral-900 border-white/10 text-[10px] uppercase font-black tracking-widest text-blue-400">
                  {f.isVisible !== false ? "Visible on Forms" : "Hidden from Layout"}
                </TooltipContent>
              </Tooltip>
            </div>
          </TooltipProvider>
        );
      },
    },
    {
      id: "metrics",
      header: "Density",
      cell: ({ row }) => {
        const f = row.original;
        const optCount = f.options?.length ?? 0;
        const isDropdown = ["dropdown", "select", "radiobutton", "multiselect"].includes((f.fieldType || "").toLowerCase());
        
        return (
          <div className="flex items-center gap-3">
             <div className="flex flex-col items-center">
                <span className="text-[9px] font-black text-white/20 uppercase tracking-tighter">Opts</span>
                <span className={cn("text-[11px] font-bold tabular-nums", isDropdown && optCount === 0 ? "text-red-400" : "text-white/40")}>
                  {optCount}
                </span>
             </div>
             <div className="h-4 w-px bg-white/5" />
             <div className="flex flex-col items-center">
                <span className="text-[9px] font-black text-white/20 uppercase tracking-tighter">ID</span>
                <span className="text-[10px] font-mono text-white/20">#{f.fieldId}</span>
             </div>
          </div>
        );
      },
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const f = row.original;
        const isExpanded = row.getIsExpanded();
        return (
          <div className="flex items-center justify-end gap-1.5 pr-2">
             <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "h-8 px-3 text-[9px] font-black uppercase tracking-widest rounded-lg border border-white/5 transition-all",
                  isExpanded ? "bg-primary text-primary-foreground border-primary" : "text-white/40 hover:text-white"
                )}
                onClick={() => row.toggleExpanded()}
              >
                {isExpanded ? "Close Info" : "Details"}
              </Button>
             
             <div className="h-4 w-px bg-white/5 mx-1" />

             <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground/40 hover:text-amber-400 hover:bg-amber-400/10 transition-all rounded-lg"
                onClick={() => onInspect(f.fieldId)}
                title="Blueprint"
             >
                <BookOpen size={14} />
             </Button>
             <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground/40 hover:text-primary hover:bg-primary/10 transition-all rounded-lg"
                onClick={() => onEdit(f)}
                title="Edit"
             >
                <Edit2 size={14} />
             </Button>
             <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="h-8 w-8 p-0 text-muted-foreground/20 hover:text-white transition-colors">
                    <span className="sr-only">Open menu</span>
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="bg-[#14141c] border-white/10 text-white/80 backdrop-blur-3xl shadow-2xl">
                  <DropdownMenuLabel className="text-[10px] font-black uppercase tracking-widest text-white/30">Field Node {f.fieldId}</DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => onEdit(f)} className="text-xs hover:bg-white/5 cursor-pointer gap-2">
                    <Edit2 size={12} className="text-primary" /> Edit Architect
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onInspect(f.fieldId)} className="text-xs hover:bg-white/5 cursor-pointer gap-2">
                    <GitBranch size={12} className="text-amber-400" /> Inspect Blueprint
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="bg-white/5" />
                  <DropdownMenuItem 
                    onClick={() => onDelete(f)} 
                    className="text-xs text-red-400 hover:bg-red-400/10 cursor-pointer gap-2"
                  >
                    <Trash2 size={12} /> Delete Permanently
                  </DropdownMenuItem>
                </DropdownMenuContent>
             </DropdownMenu>
          </div>
        );
      },
    },
  ], [onEdit, onDelete, onInspect]);

  const table = useReactTable({
    data,
    columns,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onRowSelectionChange: setRowSelection,
    onExpandedChange: setExpanded,
    state: {
      sorting,
      columnFilters,
      rowSelection,
      expanded,
    },
  });

  return (
    <div className="w-full space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/20" />
          <Input
            placeholder="Search metadata fields..."
            value={globalSearch}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-10 bg-[#0c0c12] border-white/5 text-[13px] h-11 rounded-xl focus:ring-primary/40 focus:border-primary/40 transition-all placeholder:text-white/10"
          />
        </div>
        <div className="flex items-center gap-2">
           <Button 
            variant="outline" 
            size="sm" 
            onClick={onResetFilters}
            className="h-11 px-6 rounded-xl border-white/10 bg-white/[0.02] text-[10px] font-black uppercase tracking-widest text-white/40 hover:text-white hover:bg-white/5 transition-all gap-2"
           >
              <FilterX size={14} />
              Reset All Filters
           </Button>
        </div>
      </div>

      <div className="rounded-[20px] border border-white/5 bg-[#08080c]/50 backdrop-blur-3xl overflow-hidden shadow-2xl">
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-left border-collapse">
            <thead className="bg-white/[0.03] border-b border-white/5">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <th key={header.id} className="px-6 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-white/30 whitespace-nowrap">
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody className="divide-y divide-white/[0.03]">
              {table.getRowModel().rows?.length ? (
                table.getRowModel().rows.map((row) => (
                    <React.Fragment key={row.id}>
                    <tr
                      className={cn(
                        "group transition-colors relative",
                        row.getIsSelected() ? "bg-primary/[0.03]" : "hover:bg-white/[0.02]",
                        row.getIsExpanded() && "bg-primary/[0.05] border-l-2 border-primary"
                      )}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <td key={cell.id} className="px-6 py-4 whitespace-nowrap">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                    {row.getIsExpanded() && (
                      <tr className="bg-primary/[0.02] border-l-2 border-primary/40">
                        <td colSpan={row.getVisibleCells().length} className="px-12 py-6">
                           <div className="grid grid-cols-2 gap-12 animate-in fade-in slide-in-from-top-4 duration-500">
                              <div className="space-y-4">
                                 <div>
                                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/20">Field Guidance</span>
                                    <p className="mt-2 text-sm text-white/60 leading-relaxed italic">
                                       {row.original.helpText || "No platform guidance provided for this metadata node."}
                                    </p>
                                 </div>
                                 <div>
                                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/20">Architect Comments</span>
                                    <p className="mt-2 text-sm text-white/60 leading-relaxed">
                                       {row.original.comments || "No internal comments available."}
                                    </p>
                                 </div>
                              </div>
                              <div className="space-y-6">
                                 <div className="flex flex-col gap-2">
                                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/20">Logical Context</span>
                                    <div className="flex flex-wrap gap-2 mt-1">
                                       {row.original.visibilityConditions ? (
                                          <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 text-[9px] font-black uppercase tracking-widest px-3 py-1">
                                             Active Gating Logic
                                          </Badge>
                                       ) : (
                                          <span className="text-xs text-white/20 italic">No conditional visibility defined.</span>
                                       )}
                                    </div>
                                 </div>
                                 <div className="flex gap-4">
                                    <Button 
                                      size="sm" 
                                      variant="outline" 
                                      className="h-9 px-4 rounded-xl border-white/10 text-[10px] font-black uppercase tracking-widest hover:border-primary/40 transition-all gap-2"
                                      onClick={() => onInspect(row.original.fieldId)}
                                    >
                                       <ExternalLink size={12} /> Full Blueprint
                                    </Button>
                                    <Button 
                                      size="sm" 
                                      className="h-9 px-4 rounded-xl bg-primary text-primary-foreground font-black uppercase tracking-widest text-[10px] shadow-lg shadow-primary/20 gap-2"
                                      onClick={() => onEdit(row.original)}
                                    >
                                       <Edit2 size={12} /> Enter Architect
                                    </Button>
                                 </div>
                              </div>
                           </div>
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                ))
              ) : (
                <tr>
                  <td colSpan={columns.length} className="h-64 text-center">
                    <div className="flex flex-col items-center justify-center space-y-3 opacity-20">
                       <AlertTriangle size={32} />
                       <span className="text-[10px] font-black uppercase tracking-[0.3em] italic">No fields match the current intent</span>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      
      {/* Selection Toolbar */}
      {Object.keys(rowSelection).length > 0 && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 bg-primary/95 text-primary-foreground px-8 py-4 rounded-[2rem] shadow-2xl flex items-center gap-8 animate-in slide-in-from-bottom-8 duration-500 border border-white/20 backdrop-blur-xl">
           <div className="flex items-center gap-3">
              <Badge variant="secondary" className="bg-white/20 text-white border-none font-black h-6 min-w-[24px] flex items-center justify-center">{Object.keys(rowSelection).length}</Badge>
              <div className="flex flex-col">
                 <span className="text-[11px] font-black uppercase tracking-widest">Fields Selected</span>
                 <span className="text-[9px] text-white/60 font-medium">Batch action ready</span>
              </div>
           </div>
           <div className="h-8 w-px bg-white/20" />
           <div className="flex items-center gap-3">
              <Button 
                size="sm" 
                variant="ghost" 
                className="h-10 px-5 text-[10px] font-black uppercase tracking-widest hover:bg-white/10 rounded-xl"
                onClick={onBulkEdit}
              >
                Bulk Edit Architect
              </Button>
              <Button size="sm" variant="ghost" className="h-10 px-5 text-[10px] font-black uppercase tracking-widest text-white/40 hover:text-white rounded-xl" onClick={() => onSelectionChange([])}>Cancel</Button>
           </div>
        </div>
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function StatusDot({ active, color, tooltip }: { active: boolean; color: string; tooltip: string }) {
  const colorMap: Record<string, string> = {
    green: active ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-white/10",
    amber: active ? "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]" : "bg-white/5",
    blue: active ? "bg-sky-500 shadow-[0_0_8px_rgba(14,165,233,0.5)]" : "bg-white/5",
    gray: "bg-white/5",
  };
  return (
    <div 
      className={cn("h-1.5 w-1.5 rounded-full", colorMap[color] || colorMap.gray)} 
      title={tooltip}
    />
  );
}

const TYPE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  dropdown:      { bg: "bg-blue-500/10",    text: "text-blue-400",    border: "border-blue-500/30" },
  select:        { bg: "bg-blue-500/10",    text: "text-blue-400",    border: "border-blue-500/30" },
  multiselect:   { bg: "bg-indigo-500/10",  text: "text-indigo-400",  border: "border-indigo-500/30" },
  radiobutton:   { bg: "bg-purple-500/10",  text: "text-purple-400",  border: "border-purple-500/30" },
  date:          { bg: "bg-orange-500/10",  text: "text-orange-400",  border: "border-orange-500/30" },
  text:          { bg: "bg-zinc-500/10",    text: "text-zinc-400",    border: "border-zinc-500/30" },
  number:        { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/30" },
};

function typeColor(ft: string) {
  return TYPE_COLORS[(ft ?? "").toLowerCase()] ?? { bg: "bg-zinc-500/10", text: "text-zinc-400", border: "border-zinc-500/30" };
}
