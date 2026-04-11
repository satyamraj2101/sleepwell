import { Settings, LogOut, Wifi, WifiOff, Menu } from "lucide-react";
import { useAuthStore, useIsConnected } from "@/store/authStore";
import { useConfigStore } from "@/store/configStore";
import { useAppTypes } from "@/hooks/useAppTypes";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SettingsDialog } from "@/components/shared/SettingsDialog";
import { useState } from "react";

interface TopBarProps {
  onMenuClick: () => void;
}

export function TopBar({ onMenuClick }: TopBarProps) {
  const isConnected = useIsConnected();
  const { tenant, username, logout } = useAuthStore();
  const { selectedAppTypeId, setSelectedAppTypeId } = useConfigStore();
  const { data: appTypes, isLoading } = useAppTypes();
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <header className="h-12 border-b border-border bg-card flex items-center justify-between px-4 lg:px-6 flex-shrink-0">
      <div className="flex items-center gap-2 lg:gap-3">
        <button
          onClick={onMenuClick}
          className="p-1.5 rounded-md text-muted-foreground hover:bg-accent lg:hidden"
        >
          <Menu size={18} />
        </button>

        {isConnected ? (
          <div className="flex items-center gap-1.5 lg:gap-2">
            <Badge variant="secondary" className="gap-1 lg:gap-1.5 text-[10px] lg:text-xs font-normal h-8 px-2 lg:px-2.5">
              <Wifi size={10} className="text-green-500 lg:w-[11px]" />
              <span className="mono text-green-500">{tenant}</span>
              <span className="text-muted-foreground hidden sm:inline">·</span>
              <span className="text-muted-foreground truncate max-w-[80px] lg:max-w-[120px] hidden sm:inline">{username}</span>
            </Badge>

            <select
              value={selectedAppTypeId ?? ""}
              onChange={(e) => setSelectedAppTypeId(e.target.value ? Number(e.target.value) : null)}
              className="h-8 text-[10px] lg:text-[11px] bg-background border border-border rounded-md px-1.5 lg:px-2 focus:outline-none focus:ring-1 focus:ring-ring w-[100px] sm:min-w-[160px] sm:max-w-[240px] truncate"
              disabled={isLoading}
            >
              <option value="">{window.innerWidth < 640 ? "Filter" : "Global Filter: All"}</option>
              {(appTypes ?? []).map((at) => (
                <option key={at.applicationTypeId} value={at.applicationTypeId}>
                  {at.applicationTypeName}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <Badge variant="destructive" className="gap-1.5 text-[10px] lg:text-xs h-8">
            <WifiOff size={10} className="lg:w-[11px]" />
            Not connected
          </Badge>
        )}
      </div>

      <div className="flex items-center gap-1 lg:gap-2">
        <Button variant="ghost" size="sm" onClick={() => setSettingsOpen(true)} className="h-8 px-2 lg:px-3 gap-1 lg:gap-1.5">
          <Settings size={14} />
          <span className="text-xs hidden sm:inline">Settings</span>
        </Button>
        {isConnected && (
          <Button variant="ghost" size="sm" onClick={logout} className="h-8 px-2 lg:px-3 gap-1 lg:gap-1.5 text-muted-foreground">
            <LogOut size={14} />
            <span className="text-xs hidden sm:inline">Disconnect</span>
          </Button>
        )}
      </div>

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </header>
  );
}
