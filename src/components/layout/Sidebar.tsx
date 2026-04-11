import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  Users, FileEdit, ScrollText, CheckSquare, Building2,
  Database, Layers, Calendar, BarChart3, Scale, Download,
  FlaskConical, Zap, X
} from "lucide-react";

const NAV = [
  { label: "Go-live Tools", isSection: true },
  { path: "/user-mask",      icon: Users,       label: "Email Mask / Unmask",    badge: "critical" },
  { path: "/contract-edit",  icon: FileEdit,    label: "Contract Quick-Edit",    badge: "fixed" },
  { label: "Data & Config", isSection: true },
  { path: "/legal-party",    icon: Building2,   label: "Legal Party Manager" },
  { path: "/metadata",       icon: Database,    label: "Field (Metadata) Mgr" },
  { path: "/app-types",      icon: Layers,      label: "App Type Builder" },
  { path: "/date-rules",     icon: Calendar,    label: "Date Rule Manager" },
  { label: "Compliance & AI", isSection: true },
  { path: "/audit-log",      icon: ScrollText,  label: "Audit Log Viewer" },
  { path: "/approvals",      icon: CheckSquare, label: "Approval Checker" },
  { path: "/compare-comply", icon: Scale,       label: "Compare & Comply" },
  { label: "Reporting", isSection: true },
  { path: "/reports",        icon: BarChart3,   label: "Report Builder" },
  { path: "/bulk-import",    icon: Download,    label: "Bulk Import Tool" },
  { label: "Testing", isSection: true },
  { path: "/testing",        icon: FlaskConical, label: "Scenario Runner" },
  { path: "/bulk-test",      icon: Zap,          label: "Bulk Test Creator" },
];

const BADGE_STYLES: Record<string, string> = {
  critical: "bg-red-500/20 text-red-400 text-[10px] px-1.5 py-0.5 rounded",
  fixed:    "bg-amber-500/20 text-amber-400 text-[10px] px-1.5 py-0.5 rounded",
  new:      "bg-green-500/20 text-green-400 text-[10px] px-1.5 py-0.5 rounded",
};

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  return (
    <>
      {/* Mobile Overlay */}
      <div 
        className={cn(
          "fixed inset-0 bg-black/60 backdrop-blur-sm z-40 transition-opacity lg:hidden",
          isOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        onClick={onClose}
      />

      <aside className={cn(
        "fixed inset-y-0 left-0 w-64 lg:w-56 flex-shrink-0 flex flex-col border-r border-border bg-card z-50 transition-transform lg:translate-x-0 lg:static lg:block h-full overflow-y-auto",
        isOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        {/* Logo & Close button */}
        <div className="px-4 py-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 bg-amber-500 rounded-lg flex items-center justify-center flex-shrink-0">
              <Zap size={14} className="text-black" />
            </div>
            <div>
              <div className="text-sm font-semibold leading-tight">Leah Toolkit</div>
              <div className="text-[10px] text-muted-foreground mono leading-tight">Integreon</div>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 rounded-md text-muted-foreground hover:bg-accent lg:hidden"
          >
            <X size={18} />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
          {NAV.map((item, i) => {
            if ("isSection" in item) {
              return (
                <div key={i} className="pt-4 pb-1.5 px-2">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    {item.label}
                  </span>
                </div>
              );
            }
            const Icon = item.icon!;
            return (
              <NavLink
                key={item.path}
                to={item.path!}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm transition-colors",
                    isActive
                      ? "bg-accent text-accent-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                  )
                }
              >
                <Icon size={15} className="flex-shrink-0" />
                <span className="flex-1 truncate">{item.label}</span>
                {item.badge && (
                  <span className={BADGE_STYLES[item.badge]}>
                    {item.badge}
                  </span>
                )}
              </NavLink>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
