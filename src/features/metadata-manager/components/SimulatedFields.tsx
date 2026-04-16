
import React from 'react';
import { IntakeFormField } from '@/types';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Info, HelpCircle } from 'lucide-react';
import { Input } from '@/components/ui/input';

interface SimulatedFieldProps {
  field: IntakeFormField;
  value: any;
  onChange: (val: any) => void;
  isMandatory?: boolean;
  isGhost?: boolean;
}

export const IntakeRadioGroup: React.FC<SimulatedFieldProps> = ({ field, value, onChange, isMandatory: _isMandatory, isGhost }) => {
  const options = field.selectOptions ? Object.entries(field.selectOptions) : [];
  
  return (
    <div className={cn("space-y-3 transition-all duration-300", isGhost && "opacity-40 grayscale-[0.5]")}>
      <div className="flex flex-wrap gap-2">
        {options.map(([optVal, optLabel]) => {
          const isActive = String(value) === String(optVal);
          return (
            <button
              key={optVal}
              onClick={() => onChange(optVal)}
              className={cn(
                "px-5 py-2.5 rounded-2xl border transition-all duration-300 text-sm font-medium relative overflow-hidden group/opt",
                isActive 
                  ? "bg-primary/20 border-primary text-primary shadow-[0_0_20px_rgba(var(--primary),0.1)]" 
                  : "bg-white/[0.03] border-white/5 text-white/50 hover:border-white/20 hover:text-white"
              )}
            >
              {optLabel}
              {isActive && (
                <div className="absolute inset-0 bg-primary/5 animate-pulse" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export const IntakeSelect: React.FC<SimulatedFieldProps> = ({ field, value, onChange, isGhost }) => {
  const options = field.selectOptions ? Object.entries(field.selectOptions) : [];
  
  return (
    <div className={cn("transition-all duration-300", isGhost && "opacity-40 grayscale-[0.5]")}>
      <select
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-white/[0.03] border border-white/10 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all appearance-none cursor-pointer"
      >
        <option value="" disabled className="bg-[#0b0b1a]">Select an option...</option>
        {options.map(([optVal, optLabel]) => (
          <option key={optVal} value={optVal} className="bg-[#0b0b1a]">
            {optLabel}
          </option>
        ))}
      </select>
    </div>
  );
};

export const IntakeTextField: React.FC<SimulatedFieldProps> = ({ field, value, onChange, isGhost }) => {
  return (
    <div className={cn("transition-all duration-300", isGhost && "opacity-40 grayscale-[0.5]")}>
      <Input
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`Enter ${(field.displayName || field.fieldName || "value").toLowerCase()}...`}
        className="h-12 bg-white/[0.03] border-white/10 rounded-2xl px-4 text-sm focus:ring-primary/50"
      />
    </div>
  );
};

export const IntakeMultilineField: React.FC<SimulatedFieldProps> = ({ field, value, onChange, isGhost }) => {
  return (
    <div className={cn("transition-all duration-300", isGhost && "opacity-40 grayscale-[0.5]")}>
      <textarea
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        placeholder={`Enter ${(field.displayName || field.fieldName || "value").toLowerCase()}...`}
        className="w-full bg-white/[0.03] border border-white/10 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all resize-none"
      />
    </div>
  );
};

export const IntakeGuidance: React.FC<{ field: IntakeFormField; isGhost?: boolean }> = ({ field, isGhost }) => {
  return (
    <div className={cn(
      "p-5 bg-amber-500/5 border border-amber-500/20 rounded-3xl space-y-3 transition-all duration-500",
      isGhost && "opacity-30 grayscale saturate-0"
    )}>
      <div className="flex items-center gap-2 text-amber-500">
        <div className="p-1.5 bg-amber-500/10 rounded-lg">
          <Info size={14} />
        </div>
        <span className="text-[10px] font-black uppercase tracking-[0.2em]">Platform Guidance</span>
      </div>
      <div 
        className="text-xs text-amber-200/60 leading-relaxed italic rich-text-content"
        dangerouslySetInnerHTML={{ __html: field.helpText || field.displayName || field.fieldName || "" }}
      />
    </div>
  );
};

export const SimulatedField: React.FC<SimulatedFieldProps> = (props) => {
  const { field, isMandatory } = props;
  const type = (field.fieldType || "").toLowerCase();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <label className="text-sm font-bold text-white/80 flex items-center gap-2">
          {field.displayName || field.fieldName}
          {isMandatory && <span className="text-amber-500 text-lg leading-none">*</span>}
        </label>
        <div className="flex items-center gap-2">
          {isMandatory && (
            <Badge className="bg-amber-500/10 text-amber-500 border-amber-500/20 text-[8px] font-black px-1.5 h-4 uppercase tracking-tighter">
              Mandatory
            </Badge>
          )}
          <span className="text-[10px] font-mono text-white/20 uppercase">#{field.fieldId}</span>
        </div>
      </div>

      {type.includes('radio') ? (
        <IntakeRadioGroup {...props} />
      ) : type.includes('dropdown') || type.includes('select') ? (
        <IntakeSelect {...props} />
      ) : type.includes('multiline') ? (
        <IntakeMultilineField {...props} />
      ) : type.includes('guidance') ? (
        <IntakeGuidance field={field} isGhost={props.isGhost} />
      ) : (
        <IntakeTextField {...props} />
      )}

      {field.helpText && !type.includes('guidance') && (
        <div className="flex items-start gap-2 text-muted-foreground/50">
          <HelpCircle size={12} className="mt-0.5 shrink-0" />
          <p className="text-[11px] leading-relaxed italic">{field.helpText}</p>
        </div>
      )}
    </div>
  );
};
