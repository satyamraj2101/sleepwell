import { useState, useCallback, memo } from "react";
import {
  X, Save, AlertCircle, CheckCircle2, FileText, User, Calendar,
  Layers, Shield, Briefcase, ChevronDown, RotateCcw, Building2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/shared/PageHeader";
import { ContractDetail, IntakeFormField, FieldOption } from "@/types";
import { cn, fmtDate, toInputDate } from "@/lib/utils";

interface Props {
  detail: ContractDetail | null;
  loading: boolean;
  intakeFieldMap: Record<number, IntakeFormField>;
  fieldOptionsMap: Record<number, FieldOption[]>;
  onClose: () => void;
  onSave: (detail: ContractDetail, edits: Record<number, string>, desc?: string) => Promise<void>;
  saving: boolean;
  saveError: string | null;
}

export function ContractEditDrawer({
  detail, loading, intakeFieldMap, fieldOptionsMap,
  onClose, onSave, saving, saveError,
}: Props) {
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [desc, setDesc] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);

  const set = useCallback((id: number, v: string) => setEdits((p) => ({ ...p, [id]: v })), []);
  const reset = useCallback((id: number) => setEdits((p) => { const n = { ...p }; delete n[id]; return n; }), []);
  const dirtyCount = Object.keys(edits).length + (desc !== undefined ? 1 : 0);

  const handleSave = async () => {
    if (!detail) return;
    try {
      await onSave(detail, edits, desc);
      setSaved(true);
      setTimeout(() => setSaved(false), 4000);
    } catch {}
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 backdrop-blur-[2px] z-[999]" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed right-0 top-0 h-full w-full max-w-[680px] bg-[#0f1117] border-l border-white/[0.07] z-[1000] flex flex-col shadow-2xl">

        {/* ── Header ───────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-white/[0.07] bg-[#0f1117]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/25 flex items-center justify-center flex-shrink-0">
              <FileText size={15} className="text-amber-400" />
            </div>
            <div>
              <h2 className="text-[15px] font-bold text-white leading-none mb-1">Contract Editor</h2>
              {detail && (
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-mono font-semibold text-amber-400">#{detail.id}</span>
                  {detail.recordId > 0 && (
                    <span className="text-[11px] font-mono text-blue-400">· REC {detail.recordId}</span>
                  )}
                  <span className="text-[11px] text-white/30">·</span>
                  <span className="text-[11px] text-white/50 font-medium">{detail.workflowStage || "—"}</span>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {dirtyCount > 0 && (
              <span className="text-[11px] font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 rounded-full">
                {dirtyCount} change{dirtyCount !== 1 ? "s" : ""}
              </span>
            )}
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-white/40 hover:text-white hover:bg-white/[0.06] transition-all"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* ── Body ─────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">

          {/* Loading */}
          {loading && (
            <div className="flex flex-col items-center justify-center py-32 gap-4">
              <Spinner size={32} className="text-amber-400" />
              <span className="text-[12px] text-white/30 font-medium tracking-wide uppercase">Loading contract…</span>
            </div>
          )}

          {!loading && detail && (
            <div className="p-6 space-y-6">

              {/* Meta grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {[
                  { icon: Layers, label: "App Type", value: detail.applicationTypeName },
                  { icon: FileText, label: "Request Type", value: detail.requestType },
                  { icon: User, label: "Added By", value: detail.addedByName },
                  { icon: Calendar, label: "Added On", value: fmtDate(detail.addedOn) },
                  { icon: Shield, label: "Confidential", value: detail.isConfidential ? "Yes" : "No" },
                ].map(({ icon: Icon, label, value }) => (
                  <div key={label} className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-3">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <Icon size={11} className="text-white/30" />
                      <span className="text-[10px] font-semibold text-white/30 uppercase tracking-wider">{label}</span>
                    </div>
                    <p className="text-[13px] font-medium text-white/80 truncate" title={value ?? ""}>{value || "—"}</p>
                  </div>
                ))}
              </div>

              {/* Clients */}
              {detail.clients?.length > 0 && (
                <div>
                  <SectionLabel icon={Building2}>Clients</SectionLabel>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {detail.clients.map((c, i) => (
                      <div key={i} className="flex items-center gap-2 text-[12px] font-medium bg-amber-500/8 border border-amber-500/20 text-amber-300 px-3 py-1.5 rounded-lg">
                        {c.clientName ?? `Client #${c.clientId}`}
                        {c.isPrimary && <span className="text-[9px] font-bold text-amber-400/80 uppercase">Primary</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Legal parties */}
              {detail.legalParties?.length > 0 && (
                <div>
                  <SectionLabel icon={Briefcase}>Parties</SectionLabel>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {detail.legalParties.map((lp, i) => (
                      <div key={i} className="flex items-center gap-2 text-[12px] font-medium bg-blue-500/8 border border-blue-500/20 text-blue-300 px-3 py-1.5 rounded-lg">
                        {lp.name ?? `Party #${lp.legalPartyId}`}
                        {lp.isPrimary && <span className="text-[9px] font-bold text-amber-400/80 uppercase">Primary</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Description */}
              <div>
                <SectionLabel>Description</SectionLabel>
                <div className={cn(
                  "mt-2 rounded-xl border transition-colors",
                  desc !== undefined ? "border-amber-500/40 bg-amber-500/[0.03]" : "border-white/[0.08] bg-white/[0.02]"
                )}>
                  <textarea
                    rows={3}
                    className="w-full bg-transparent text-[13px] text-white/80 placeholder:text-white/20 px-4 py-3 resize-none focus:outline-none leading-relaxed"
                    value={desc ?? detail.description ?? ""}
                    placeholder="Contract description…"
                    onChange={(e) => setDesc(e.target.value)}
                  />
                </div>
              </div>

              {/* Custom field groups */}
              {(detail.customFieldGroups ?? []).map((group) => (
                <div key={group.id}>
                  <SectionLabel>{group.name}</SectionLabel>
                  <div className="mt-2 rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden divide-y divide-white/[0.05]">
                    {(group.customFields ?? []).map((field) => {
                      const cur = edits[field.customFieldId] !== undefined
                        ? edits[field.customFieldId]
                        : (field.customFieldValue ?? "");
                      const isDirty = edits[field.customFieldId] !== undefined;
                      const intakeField = intakeFieldMap[field.customFieldId];
                      const metaOpts = fieldOptionsMap[field.customFieldId];

                      return (
                        <div
                          key={field.customFieldId}
                          className={cn(
                            "px-4 py-3 transition-colors",
                            isDirty ? "bg-amber-500/[0.04]" : "hover:bg-white/[0.02]"
                          )}
                        >
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex-1 min-w-0 pr-3">
                              <label className={cn(
                                "text-[12.5px] font-semibold leading-snug block",
                                isDirty ? "text-amber-400" : "text-white/70"
                              )}>
                                {field.customFieldDisplayName}
                              </label>
                              {field.customFieldHelpText && (
                                <p className="text-[11px] text-white/30 mt-0.5 leading-snug">{field.customFieldHelpText}</p>
                              )}
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0 mt-0.5">
                              {isDirty && (
                                <>
                                  <button
                                    onClick={() => reset(field.customFieldId)}
                                    className="text-white/25 hover:text-white/60 transition-colors"
                                    title="Reset to original"
                                  >
                                    <RotateCcw size={11} />
                                  </button>
                                  <span className="text-[9px] font-bold text-amber-400 bg-amber-500/15 px-1.5 py-0.5 rounded uppercase tracking-wide">edited</span>
                                </>
                              )}
                              <span className="text-[10px] font-mono text-white/15">#{field.customFieldId}</span>
                            </div>
                          </div>
                          <FieldInput
                            fieldType={field.type}
                            value={cur}
                            intakeField={intakeField}
                            metadataOptions={metaOpts}
                            onChange={(v) => set(field.customFieldId, v)}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Footer ───────────────────────────────────────────────── */}
        <div className="flex-shrink-0 border-t border-white/[0.07] bg-[#0f1117] px-6 py-4">
          {saveError && (
            <div className="flex items-start gap-3 text-[12px] text-red-400 bg-red-500/8 border border-red-500/20 rounded-xl px-4 py-3 mb-3">
              <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
              <span className="leading-snug">{saveError}</span>
            </div>
          )}
          {saved && (
            <div className="flex items-center gap-3 text-[12px] text-emerald-400 bg-emerald-500/8 border border-emerald-500/20 rounded-xl px-4 py-3 mb-3">
              <CheckCircle2 size={14} className="flex-shrink-0" />
              Contract saved successfully.
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <span className="text-[12px] text-white/25">
              {dirtyCount > 0 ? `${dirtyCount} unsaved change${dirtyCount !== 1 ? "s" : ""}` : "No changes"}
            </span>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={onClose} className="text-white/50 hover:text-white border-white/10 h-9">
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={saving || dirtyCount === 0 || !detail}
                onClick={handleSave}
                className={cn(
                  "h-9 gap-2 font-semibold transition-all",
                  dirtyCount > 0
                    ? "bg-amber-500 hover:bg-amber-400 text-black"
                    : "bg-white/5 text-white/30 border border-white/10"
                )}
              >
                {saving ? <Spinner size={14} className="text-black" /> : <Save size={13} />}
                Save Changes
              </Button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Section label ─────────────────────────────────────────────────────────────
function SectionLabel({ children, icon: Icon }: { children: React.ReactNode; icon?: React.ElementType }) {
  return (
    <div className="flex items-center gap-2">
      {Icon && <Icon size={12} className="text-white/30" />}
      <span className="text-[11px] font-bold text-white/40 uppercase tracking-widest">{children}</span>
      <div className="flex-1 h-px bg-white/[0.06]" />
    </div>
  );
}

// ── Field Input ───────────────────────────────────────────────────────────────
const FieldInput = memo(({
  fieldType,
  value,
  intakeField,
  metadataOptions,
  onChange,
}: {
  fieldType: string;
  value: string;
  intakeField?: IntakeFormField;
  metadataOptions?: FieldOption[];
  onChange: (v: string) => void;
}) => {
  const type = (fieldType ?? "").toLowerCase();

  // ── Resolve options from all possible sources ────────────────────────────
  const options: Array<{ value: string; label: string }> = (() => {
    // 1. Intake form selectOptions (normalized Record<string, string>)
    if (intakeField?.selectOptions && Object.keys(intakeField.selectOptions).length > 0) {
      return Object.entries(intakeField.selectOptions).map(([k, v]) => ({
        value: k,
        label: v || k,
      }));
    }
    // 2. Intake form values array
    if (intakeField?.values && intakeField.values.length > 0) {
      return intakeField.values.map((v) => ({ value: v.value, label: v.label || v.value }));
    }
    // 3. Metadata API options
    // fieldOptionValue is normalized in listFieldDefinitions; (o as any).value is a safety fallback
    if (metadataOptions && metadataOptions.length > 0) {
      return metadataOptions.map((o) => {
        const v = o.fieldOptionValue || (o as any).value || (o as any).optionName || "";
        return { value: v, label: v };
      });
    }
    return [];
  })();

  // ── Dropdown ─────────────────────────────────────────────────────────────
  if (type === "dropdown" || type === "select") {
    if (options.length > 0) {
      return (
        <div className="relative">
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full text-[13px] bg-[#1a1f2e] text-white/80 border border-white/[0.1] rounded-lg px-3 py-2.5 appearance-none focus:outline-none focus:ring-1 focus:ring-amber-500/50 focus:border-amber-500/40 cursor-pointer pr-9 transition-colors hover:border-white/20"
          >
            <option value="" className="bg-[#1a1f2e] text-white/40">Select an option…</option>
            {options.map((o) => (
              <option key={o.value} value={o.label} className="bg-[#1a1f2e] text-white/80 py-1">
                {o.label}
              </option>
            ))}
          </select>
          <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-white/30" />
        </div>
      );
    }
    // No options — render text with hint
    return (
      <div className="relative">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="bg-[#1a1f2e] border-white/[0.1] text-white/80 placeholder:text-white/20 h-9 text-[13px] rounded-lg focus:ring-amber-500/50 focus:border-amber-500/40 pr-24"
          placeholder="Enter value…"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-white/20 font-medium pointer-events-none">free text</span>
      </div>
    );
  }

  // ── Radio ─────────────────────────────────────────────────────────────────
  if (type === "radiobutton" || type === "radio") {
    const opts = options.length > 0
      ? options.map((o) => o.label)
      : ["Yes", "No"];
    return (
      <div className="flex flex-wrap gap-2">
        {opts.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(value === opt ? "" : opt)}
            className={cn(
              "flex items-center gap-2 text-[12px] font-medium px-3 py-1.5 rounded-lg border transition-all",
              value === opt
                ? "border-amber-500/50 bg-amber-500/10 text-amber-400"
                : "border-white/10 bg-white/[0.03] text-white/50 hover:border-white/20 hover:text-white/70"
            )}
          >
            <span className={cn(
              "w-3 h-3 rounded-full border flex-shrink-0 transition-all",
              value === opt ? "border-amber-400 bg-amber-400" : "border-white/25"
            )} />
            {opt}
          </button>
        ))}
      </div>
    );
  }

  // ── Date ──────────────────────────────────────────────────────────────────
  if (type === "date") {
    return (
      <Input
        type="date"
        value={toInputDate(value)}
        onChange={(e) => onChange(e.target.value)}
        className="bg-[#1a1f2e] border-white/[0.1] text-white/80 h-9 text-[13px] rounded-lg focus:ring-amber-500/50 focus:border-amber-500/40 cursor-pointer"
      />
    );
  }

  // ── Multiline ─────────────────────────────────────────────────────────────
  if (type === "multilinetext" || type === "longtext" || type === "textarea") {
    return (
      <textarea
        rows={3}
        className="w-full text-[13px] bg-[#1a1f2e] text-white/80 border border-white/[0.1] rounded-lg px-3 py-2.5 resize-y focus:outline-none focus:ring-1 focus:ring-amber-500/50 focus:border-amber-500/40 placeholder:text-white/20 leading-relaxed transition-colors hover:border-white/20"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Enter text…"
      />
    );
  }

  // ── Number / Currency ─────────────────────────────────────────────────────
  if (type === "number" || type === "currency" || type === "decimal") {
    return (
      <Input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-[#1a1f2e] border-white/[0.1] text-white/80 h-9 text-[13px] rounded-lg focus:ring-amber-500/50 focus:border-amber-500/40 placeholder:text-white/20"
        placeholder="0"
      />
    );
  }

  // ── Text (default) ────────────────────────────────────────────────────────
  return (
    <Input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-[#1a1f2e] border-white/[0.1] text-white/80 h-9 text-[13px] rounded-lg focus:ring-amber-500/50 focus:border-amber-500/40 placeholder:text-white/20 transition-colors hover:border-white/20"
      placeholder="Enter value…"
    />
  );
});
