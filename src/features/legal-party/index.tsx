import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Edit2, Trash2, Copy, Building2, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PageHeader, Spinner, EmptyState, ErrorAlert } from "@/components/shared/PageHeader";
import { useApiClients } from "@/hooks/useApiClients";
import { useAuthStore } from "@/store/authStore";
import { listLegalParties, createLegalParty, updateLegalParty, deleteLegalParty, bulkDeleteLegalParties } from "@/api/legalParty";
import { listCountries } from "@/api/departments";
import { QK } from "@/lib/utils";
import { LegalParty, CreateLegalPartyPayload } from "@/types";
import Papa from "papaparse";

export default function LegalPartyPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<LegalParty | null | "new">(null);
  const [csvProgress, setCsvProgress] = useState<{ done: number; total: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const clients = useApiClients();
  const { tenant } = useAuthStore();
  const qc = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: QK.legalParties(tenant, page),
    queryFn: () => listLegalParties(clients!.newCloud, tenant, { pageNo: page, perPage: 50, search: search || undefined }),
    enabled: !!clients,
  });

  const parties = data?.data ?? [];

  const createMut = useMutation({
    mutationFn: (p: CreateLegalPartyPayload) => createLegalParty(clients!.newCloud, tenant, p),
    onSuccess: () => { qc.invalidateQueries({ queryKey: QK.legalParties(tenant, 1) }); toast.success("Legal party created"); setEditing(null); },
    onError: (e) => toast.error((e as Error).message),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, p }: { id: number; p: CreateLegalPartyPayload }) => updateLegalParty(clients!.newCloud, tenant, id, p),
    onSuccess: () => { qc.invalidateQueries({ queryKey: QK.legalParties(tenant, page) }); toast.success("Legal party updated"); setEditing(null); },
    onError: (e) => toast.error((e as Error).message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteLegalParty(clients!.newCloud, tenant, id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: QK.legalParties(tenant, page) }); toast.success("Deleted"); },
    onError: (e) => toast.error((e as Error).message),
  });

  const bulkDeleteMut = useMutation({
    mutationFn: (ids: number[]) => bulkDeleteLegalParties(clients!.newCloud, tenant, ids),
    onSuccess: () => { qc.invalidateQueries({ queryKey: QK.legalParties(tenant, page) }); setSelected(new Set()); toast.success("Bulk deleted"); },
    onError: (e) => toast.error((e as Error).message),
  });

  const handleDelete = (party: LegalParty) => {
    if (!window.confirm(`Delete "${party.name}"? This cannot be undone.`)) return;
    deleteMut.mutate(party.legalPartyId);
  };

  const handleBulkDelete = () => {
    if (!window.confirm(`Delete ${selected.size} legal parties?`)) return;
    bulkDeleteMut.mutate(Array.from(selected));
  };

  const handleCsvImport = (file: File) => {
    Papa.parse(file, {
      header: true,
      complete: async (results) => {
        const rows = results.data as Record<string, string>[];
        const parties = rows
          .filter((r) => r["Name"] || r["name"])
          .map((row) => ({
            name: row["Name"] || row["name"] || "",
            registrationNumber: row["Registration Number"] || row["registrationNumber"] || "",
            placeOfRegistration: row["Place of Registration"] || row["placeOfRegistration"] || "",
            description: row["Description"] || row["description"] || "",
            city: row["City"] || row["city"] || "",
            state: row["State"] || row["state"] || "",
            zipCode: row["Zip Code"] || row["zipCode"] || "",
            isActive: true,
          }));

        setCsvProgress({ done: 0, total: parties.length });
        let done = 0;
        for (const p of parties) {
          try {
            await createLegalParty(clients!.newCloud, tenant, p);
            done++;
            setCsvProgress({ done, total: parties.length });
          } catch {
            // continue on individual errors
          }
        }
        toast.success(`CSV Import: ${done}/${parties.length} records created`);
        setCsvProgress(null);
        qc.invalidateQueries({ queryKey: QK.legalParties(tenant, 1) });
      },
    });
  };

  return (
    <div>
      <PageHeader
        title="Legal Party Manager"
        description="Create, update, and manage legal entity records. Full CRUD via New Cloud API."
        actions={
          <div className="flex gap-2">
            {selected.size > 0 && (
              <Button size="sm" variant="destructive" onClick={handleBulkDelete} className="gap-1.5">
                <Trash2 size={13} />Delete {selected.size}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} className="gap-1.5">
              <Upload size={13} />Import CSV
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => { if (e.target.files?.[0]) handleCsvImport(e.target.files[0]); e.target.value = ""; }}
            />
            <Button size="sm" onClick={() => setEditing("new")} className="gap-1.5">
              <Plus size={13} />New Party
            </Button>
          </div>
        }
      />

      {/* CSV progress */}
      {csvProgress && (
        <div className="mb-4 bg-blue-500/10 border border-blue-500/30 rounded-lg px-4 py-3">
          <div className="flex items-center gap-2 text-sm mb-2">
            <Loader2 size={13} className="animate-spin text-blue-400" />
            Importing CSV… {csvProgress.done}/{csvProgress.total}
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all"
              style={{ width: `${(csvProgress.done / csvProgress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      <div className="flex gap-2 mb-4">
        <Input placeholder="Search by name, registration number…" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && refetch()} className="h-9 max-w-sm" />
        <Button size="sm" variant="outline" onClick={() => refetch()} className="h-9">Search</Button>
      </div>

      {error && <ErrorAlert message={(error as Error).message} onRetry={() => refetch()} />}
      {isLoading && <div className="flex justify-center py-20"><Spinner size={32} /></div>}
      {!isLoading && parties.length === 0 && (
        <EmptyState
          icon={<Building2 size={32} />}
          title="No legal parties found"
          action={<Button size="sm" onClick={() => setEditing("new")} className="gap-1.5 mt-2"><Plus size={13} />Create First Party</Button>}
        />
      )}

      {/* Legal party table */}
      {parties.length > 0 && (
        <div className="border border-border rounded-lg overflow-hidden shadow-sm bg-card">
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-sm min-w-[800px]">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="px-3 py-2 w-8">
                  <input type="checkbox" onChange={(e) => e.target.checked ? setSelected(new Set(parties.map((p) => p.legalPartyId))) : setSelected(new Set())} />
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">ID</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Name</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Reg Number</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Place</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Country</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Status</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {parties.map((p) => (
                <tr key={p.legalPartyId} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <td className="px-3 py-2.5">
                    <input type="checkbox" checked={selected.has(p.legalPartyId)} onChange={(e) => { const n = new Set(selected); e.target.checked ? n.add(p.legalPartyId) : n.delete(p.legalPartyId); setSelected(n); }} />
                  </td>
                  <td className="px-3 py-2.5 mono text-xs text-amber-500">#{p.legalPartyId}</td>
                  <td className="px-3 py-2.5 font-medium">{p.name}</td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground mono">{p.registrationNumber || "—"}</td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">{p.placeOfRegistration || "—"}</td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">{p.countryName || (p.countryId ? `#${p.countryId}` : "—")}</td>
                  <td className="px-3 py-2.5">
                    <Badge variant={p.isActive ? "secondary" : "outline"} className="text-[10px]">{p.isActive ? "Active" : "Inactive"}</Badge>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1 justify-end">
                      <button onClick={() => { navigator.clipboard.writeText(String(p.legalPartyId)); toast.success(`ID ${p.legalPartyId} copied`); }} className="p-1 text-muted-foreground hover:text-foreground rounded" title="Copy ID"><Copy size={12} /></button>
                      <button onClick={() => setEditing(p)} className="p-1 text-muted-foreground hover:text-foreground rounded"><Edit2 size={12} /></button>
                      <button onClick={() => handleDelete(p)} className="p-1 text-muted-foreground hover:text-destructive rounded"><Trash2 size={12} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {(data?.totalRecords ?? 0) > 50 && (
        <div className="flex justify-center gap-2 mt-4">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <span className="text-sm text-muted-foreground self-center">Page {page}</span>
          <Button variant="outline" size="sm" disabled={parties.length < 50} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      )}

      {/* Edit / Create modal */}
      {editing && (
        <LegalPartyModal
          party={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSave={(payload) => {
            if (editing === "new") createMut.mutate(payload);
            else updateMut.mutate({ id: (editing as LegalParty).legalPartyId, p: payload });
          }}
          saving={createMut.isPending || updateMut.isPending}
        />
      )}
    </div>
  );
}

function LegalPartyModal({
  party,
  onClose,
  onSave,
  saving,
}: {
  party: LegalParty | null;
  onClose: () => void;
  onSave: (p: CreateLegalPartyPayload) => void;
  saving: boolean;
}) {
  const clients = useApiClients();
  const { tenant } = useAuthStore();

  const [form, setForm] = useState<CreateLegalPartyPayload>({
    name: party?.name ?? "",
    description: party?.description ?? "",
    registrationNumber: party?.registrationNumber ?? "",
    placeOfRegistration: party?.placeOfRegistration ?? "",
    street1: party?.street1 ?? "",
    city: party?.city ?? "",
    state: party?.state ?? "",
    zipCode: party?.zipCode ?? "",
    countryId: party?.countryId ?? undefined,
    isActive: party?.isActive ?? true,
  });

  const { data: countries, isLoading: countriesLoading } = useQuery({
    queryKey: ["countries", tenant],
    queryFn: () => listCountries(clients!.newCloud, tenant),
    enabled: !!clients,
    staleTime: 10 * 60 * 1000, // 10 min — countries don't change
  });

  const set = (k: keyof CreateLegalPartyPayload, v: unknown) => setForm((p) => ({ ...p, [k]: v }));

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-card border border-border rounded-xl w-full max-w-lg p-6 max-h-[80vh] overflow-y-auto">
          <h3 className="text-base font-semibold mb-4">{party ? "Edit" : "Create"} Legal Party</h3>
          <div className="space-y-3">
            {[
              { k: "name" as const, label: "Name *", placeholder: "Pentair plc" },
              { k: "registrationNumber" as const, label: "Registration Number", placeholder: "12345678" },
              { k: "placeOfRegistration" as const, label: "Place of Registration", placeholder: "Dublin, Ireland" },
              { k: "description" as const, label: "Description", placeholder: "" },
              { k: "street1" as const, label: "Street", placeholder: "" },
              { k: "city" as const, label: "City", placeholder: "" },
              { k: "state" as const, label: "State / Region", placeholder: "" },
              { k: "zipCode" as const, label: "Zip Code", placeholder: "" },
            ].map(({ k, label, placeholder }) => (
              <div key={k}>
                <label className="text-xs text-muted-foreground block mb-1">{label}</label>
                <Input value={String(form[k] ?? "")} onChange={(e) => set(k, e.target.value)} placeholder={placeholder} className="h-8 text-sm" />
              </div>
            ))}

            {/* Country dropdown */}
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Country</label>
              {countriesLoading ? (
                <div className="flex items-center gap-2 h-8 text-xs text-muted-foreground">
                  <Loader2 size={11} className="animate-spin" /> Loading countries…
                </div>
              ) : (
                <select
                  value={form.countryId ?? ""}
                  onChange={(e) => set("countryId", e.target.value ? Number(e.target.value) : undefined)}
                  className="w-full h-8 text-sm bg-background border border-border rounded-md px-2 focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">Select country…</option>
                  {(countries ?? []).map((c) => (
                    <option key={c.countryId} value={c.countryId}>{c.countryName}</option>
                  ))}
                </select>
              )}
            </div>

            <div className="flex items-center gap-2">
              <input type="checkbox" id="isActive" checked={form.isActive} onChange={(e) => set("isActive", e.target.checked)} />
              <label htmlFor="isActive" className="text-sm">Active</label>
            </div>
          </div>
          <div className="flex gap-2 justify-end mt-5">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" disabled={!form.name || saving} onClick={() => onSave(form)}>
              {saving && <Spinner size={12} className="mr-1.5" />}
              {party ? "Update" : "Create"}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
