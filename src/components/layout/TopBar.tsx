import { Settings, LogOut, Wifi, WifiOff } from "lucide-react";
import { useAuthStore, useIsConnected } from "@/store/authStore";
import { useConfigStore } from "@/store/configStore";
import { useAppTypes } from "@/hooks/useAppTypes";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SettingsDialog } from "@/components/shared/SettingsDialog";
import { useState } from "react";

export function TopBar() {
  const isConnected = useIsConnected();
  const { tenant, username, logout } = useAuthStore();
  const { selectedAppTypeId, setSelectedAppTypeId } = useConfigStore();
  const { data: appTypes, isLoading } = useAppTypes();
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <header className="h-12 border-b border-border bg-card flex items-center justify-between px-6 flex-shrink-0">
      <div className="flex items-center gap-3">
        {isConnected ? (
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="gap-1.5 text-xs font-normal h-8">
              <Wifi size={11} className="text-green-500" />
              <span className="mono text-green-500">{tenant}</span>
              <span className="text-muted-foreground">·</span>
              <span className="text-muted-foreground truncate max-w-[120px]">{username}</span>
            </Badge>

            <select
              value={selectedAppTypeId ?? ""}
              onChange={(e) => setSelectedAppTypeId(e.target.value ? Number(e.target.value) : null)}
              className="h-8 text-[11px] bg-background border border-border rounded-md px-2 focus:outline-none focus:ring-1 focus:ring-ring min-w-[160px] max-w-[240px] truncate"
              disabled={isLoading}
            >
              <option value="">Global Filter: All Types</option>
              {(appTypes ?? []).map((at) => (
                <option key={at.applicationTypeId} value={at.applicationTypeId}>
                  {at.applicationTypeName}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <Badge variant="destructive" className="gap-1.5 text-xs">
            <WifiOff size={11} />
            Not connected
          </Badge>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => setSettingsOpen(true)} className="h-8 gap-1.5">
          <Settings size={14} />
          <span className="text-xs">Settings</span>
        </Button>
        {isConnected && (
          <Button variant="ghost" size="sm" onClick={logout} className="h-8 gap-1.5 text-muted-foreground">
            <LogOut size={14} />
            <span className="text-xs">Disconnect</span>
          </Button>
        )}
      </div>

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </header>
  );
}
