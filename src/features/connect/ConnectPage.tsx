import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { useAuthStore } from "@/store/authStore";
import { fetchToken } from "@/api/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Zap, KeyRound } from "lucide-react";

const schema = z.object({
  cloudInstance: z.string().min(1, "Required"),
  newCloudApi:   z.string().min(1, "Required"),
  tenant:        z.string().min(1, "Required"),
  username:      z.string().email("Valid email required"),
  password:      z.string().min(1, "Required"),
  securityCheck: z.string().min(1, "Master Code Required"),
});
type FormValues = z.infer<typeof schema>;

export default function ConnectPage() {
  const store = useAuthStore();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  const today = new Date().toISOString().split("T")[0];

  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      cloudInstance: store.cloudInstance || "cloudstaging5.contractpod.com",
      newCloudApi:   store.newCloudApi   || "cpai-productapi-stg5.azurewebsites.net",
      tenant:        store.tenant        || "integreonpg",
      username:      store.username      || "",
      password:      "",
      securityCheck: "",
    },
  });

  const onSubmit = async (values: FormValues) => {
    // Master Code Security
    if (values.securityCheck !== "12069") {
      toast.error("Access Denied", {
        description: "Invalid Master Code. Please contact your administrator.",
      });
      return;
    }

    setLoading(true);
    try {
      store.setConfig({ cloudInstance: values.cloudInstance, newCloudApi: values.newCloudApi, tenant: values.tenant, username: values.username });
      const auth = await fetchToken(values.cloudInstance, values.tenant, values.username, values.password);
      store.setToken(auth.access_token, auth.expires_in);
      toast.success(`Connected to ${values.tenant}`);
      navigate("/user-mask");
    } catch (err) {
      toast.error("Connection failed", { description: err instanceof Error ? err.message : "Check your credentials" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-amber-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Zap size={28} className="text-black" />
          </div>
          <h1 className="text-2xl font-semibold mb-1">Leah CLM Toolkit</h1>
          <p className="text-sm text-muted-foreground">Integreon implementation tooling</p>
        </div>

        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex items-center gap-2 mb-5">
            <KeyRound size={15} className="text-muted-foreground" />
            <span className="text-sm font-medium">Connect to Leah CLM</span>
          </div>

          <div className="bg-muted rounded-md p-2.5 mb-5 mono text-[11px] text-muted-foreground leading-relaxed">
            <div>Auth:    https://&#123;cloud&#125;/cpaimt_auth/auth/token</div>
            <div>Old API: https://&#123;cloud&#125;/cpaimt_api/api/&#123;tenant&#125;/v1/</div>
            <div>New API: https://&#123;newCloud&#125;/api/&#123;tenant&#125;/</div>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
            {[
              { name: "cloudInstance" as const, label: "Cloud Instance",  placeholder: "cloud20.contractpod.com" },
              { name: "newCloudApi"   as const, label: "New Cloud API",   placeholder: "cpai-productapi-pus20.azurewebsites.net" },
              { name: "tenant"        as const, label: "Tenant",          placeholder: "pentair" },
              { name: "username"      as const, label: "Username",        placeholder: "yashraj.singh@integreon.com" },
              { name: "password"      as const, label: "Password",        placeholder: "••••••••", type: "password" },
              { name: "securityCheck" as const, label: "Master Verification Code", type: "password", placeholder: "•••••" },
            ].map(({ name, label, placeholder, type }) => (
              <div key={name}>
                <Label htmlFor={name} className="text-xs mb-1 block">{label}</Label>
                <Input id={name} type={type ?? "text"} placeholder={placeholder} autoComplete={name === "password" ? "current-password" : "off"} {...register(name)} className={errors[name] ? "border-destructive" : ""} />
                {errors[name] && <p className="text-[11px] text-destructive mt-1">{errors[name]?.message}</p>}
              </div>
            ))}
            <Button type="submit" className="w-full mt-1" disabled={loading}>
              {loading && <Loader2 size={14} className="animate-spin mr-2" />}
              Connect
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
