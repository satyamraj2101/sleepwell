import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuthStore } from "@/store/authStore";
import { fetchToken } from "@/api/auth";
import { Loader2, KeyRound } from "lucide-react";

const schema = z.object({
  cloudInstance: z.string().min(1, "Required"),
  newCloudApi:   z.string().min(1, "Required"),
  tenant:        z.string().min(1, "Required"),
  username:      z.string().email("Must be a valid email"),
  password:      z.string().min(1, "Required"),
  securityCheck: z.string().min(1, "Required"),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onClose: () => void;
}

export function SettingsDialog({ open, onClose }: Props) {
  const store = useAuthStore();
  const [loading, setLoading] = useState(false);

  const today = new Date().toISOString().split("T")[0];

  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      cloudInstance: store.cloudInstance,
      newCloudApi:   store.newCloudApi,
      tenant:        store.tenant,
      username:      store.username,
      password:      "",
      securityCheck: today,
    },
  });

  const onSubmit = async (values: FormValues) => {
    // Security check: must be exactly currentYear + 2
    const d = new Date(values.securityCheck);
    const expected = new Date().getFullYear() + 2;
    if (d.getFullYear() !== expected) {
      toast.error("Oh ho", {
        description: "You need to take permission from him to access this.",
      });
      return;
    }

    setLoading(true);
    try {
      store.setConfig({
        cloudInstance: values.cloudInstance,
        newCloudApi:   values.newCloudApi,
        tenant:        values.tenant,
        username:      values.username,
      });
      const auth = await fetchToken(values.cloudInstance, values.tenant, values.username, values.password);
      store.setToken(auth.access_token, auth.expires_in);
      toast.success(`Connected to ${values.tenant}`, {
        description: `Token expires in ${Math.floor(auth.expires_in / 60)} min`,
      });
      onClose();
    } catch (err) {
      toast.error("Connection failed", {
        description: err instanceof Error ? err.message : "Check credentials and try again",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound size={16} />
            API Connection Settings
          </DialogTitle>
        </DialogHeader>

        <div className="text-xs text-muted-foreground bg-muted rounded-md p-3 mono leading-relaxed">
          <div>Auth: https://&#123;Cloud Instance&#125;/cpaimt_auth/auth/token</div>
          <div>API:  https://&#123;New Cloud API&#125;/api/&#123;tenant&#125;/...</div>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3 mt-1">
          {[
            { name: "cloudInstance" as const, label: "Cloud Instance",    placeholder: "cloud20.contractpod.com" },
            { name: "newCloudApi"   as const, label: "New Cloud API",     placeholder: "cpai-productapi-pus20.azurewebsites.net" },
            { name: "tenant"        as const, label: "Tenant",            placeholder: "pentair" },
            { name: "username"      as const, label: "Username",          placeholder: "user@domain.com" },
            { name: "password"      as const, label: "Password",          placeholder: "••••••••", type: "password" },
            { name: "securityCheck" as const, label: "Security Verification", type: "date" },
          ].map(({ name, label, placeholder, type }) => (
            <div key={name} className="space-y-1">
              <Label htmlFor={name} className="text-xs font-medium">{label}</Label>
              <Input
                id={name}
                type={type ?? "text"}
                placeholder={placeholder}
                autoComplete={name === "password" ? "current-password" : "off"}
                {...register(name)}
                className={errors[name] ? "border-destructive" : ""}
              />
              {errors[name] && (
                <p className="text-[11px] text-destructive">{errors[name]?.message}</p>
              )}
            </div>
          ))}

          <div className="flex gap-2 justify-end pt-1">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button type="submit" size="sm" disabled={loading}>
              {loading && <Loader2 size={13} className="animate-spin mr-1" />}
              Save & Connect
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
