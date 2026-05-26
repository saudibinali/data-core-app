import { useEffect, useState } from "react";

import { useTranslation } from "react-i18next";

import { useQueryClient } from "@tanstack/react-query";

import {

  createHrEmployeeProvisionAccount,

  createHrEmployeeProvisionAccountById,

  getHrEmployeeProvisionPreview,

  lookupHrEmployeeProvision,

  useListWorkspaceRoles,

  type HrEmployeeProvisionPreview,

} from "@workspace/api-client-react";

import { useToast } from "@/hooks/use-toast";

import {

  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,

} from "@/components/ui/dialog";

import { Button } from "@/components/ui/button";

import { Input } from "@/components/ui/input";

import { Label } from "@/components/ui/label";

import { Switch } from "@/components/ui/switch";

import { Badge } from "@/components/ui/badge";

import {

  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,

} from "@/components/ui/select";

import { Loader2, Search, UserCheck, KeyRound, Building2, Briefcase } from "lucide-react";

import { cn } from "@/lib/utils";
import { idempotencyRequestInit } from "@/lib/idempotency-key";



type Role = "admin" | "manager" | "member";



interface Props {

  open: boolean;

  onClose: () => void;

  employeeId?: number;

  isAr?: boolean;

  onSuccess?: () => void;

  /** When true, render form only (no Dialog wrapper) for embedding in parent dialogs */

  embedded?: boolean;

}



export default function EmployeeAccountProvisionDialog({

  open, onClose, employeeId, isAr: isArProp, onSuccess, embedded = false,

}: Props) {

  const { t, i18n } = useTranslation();

  const isAr = isArProp ?? i18n.language.startsWith("ar");

  const { toast } = useToast();

  const queryClient = useQueryClient();

  const { data: workspaceRoles = [] } = useListWorkspaceRoles({});



  const [employeeNumber, setEmployeeNumber] = useState("");

  const [preview, setPreview] = useState<HrEmployeeProvisionPreview | null>(null);

  const [lookupError, setLookupError] = useState<string | null>(null);

  const [lookingUp, setLookingUp] = useState(false);

  const [password, setPassword] = useState("");

  const [role, setRole] = useState<Role>("member");

  const [customRoleId, setCustomRoleId] = useState("__none__");

  const [mustResetPassword, setMustResetPassword] = useState(true);

  const [submitting, setSubmitting] = useState(false);



  function reset() {

    setEmployeeNumber("");

    setPreview(null);

    setLookupError(null);

    setPassword("");

    setRole("member");

    setCustomRoleId("__none__");

    setMustResetPassword(true);

  }



  function handleClose() {

    reset();

    onClose();

  }



  async function loadPreviewById(id: number) {

    setLookingUp(true);

    setLookupError(null);

    try {

      const data = await getHrEmployeeProvisionPreview(id);

      setPreview(data);

    } catch (e: unknown) {

      setPreview(null);

      setLookupError(e instanceof Error ? e.message : "Lookup failed");

    } finally {

      setLookingUp(false);

    }

  }



  async function lookupByNumber() {

    const num = employeeNumber.trim();

    if (!num) return;

    setLookingUp(true);

    setLookupError(null);

    try {

      const data = await lookupHrEmployeeProvision({ employeeNumber: num });

      setPreview(data);

    } catch (e: unknown) {

      setPreview(null);

      setLookupError(e instanceof Error ? e.message : t("provision_lookup_failed"));

    } finally {

      setLookingUp(false);

    }

  }



  useEffect(() => {

    if (open && employeeId) void loadPreviewById(employeeId);

    if (!open) reset();

    // eslint-disable-next-line react-hooks/exhaustive-deps

  }, [open, employeeId]);



  async function submit() {

    if (!password || password.length < 8) {

      toast({ title: t("provision_password_short"), variant: "destructive" });

      return;

    }

    if (!preview?.canProvision) return;



    const body = {

      password,

      role,

      customRoleId: customRoleId !== "__none__" ? Number(customRoleId) : null,

      mustResetPassword,

    };



    setSubmitting(true);

    try {

      const idem = idempotencyRequestInit();

      if (employeeId) {

        await createHrEmployeeProvisionAccountById(employeeId, body, idem);

      } else {

        await createHrEmployeeProvisionAccount({

          ...body,

          employeeNumber: preview.employeeNumber,

        }, idem);

      }



      toast({

        title: t("provision_success"),

        description: preview.fullName,

      });

      queryClient.invalidateQueries({ queryKey: ["/api/users"] });

      onSuccess?.();

      handleClose();

    } catch (e: unknown) {

      toast({

        title: t("provision_failed"),

        description: e instanceof Error ? e.message : undefined,

        variant: "destructive",

      });

    } finally {

      setSubmitting(false);

    }

  }



  const canSubmit = Boolean(preview?.canProvision && password.length >= 8);



  const formBody = (

    <>

      {!employeeId && (

        <div className="space-y-2">

          <Label>{t("provision_emp_number")}</Label>

          <div className="flex gap-2">

            <Input

              value={employeeNumber}

              onChange={(e) => { setEmployeeNumber(e.target.value); setPreview(null); setLookupError(null); }}

              placeholder={t("provision_emp_number_ph")}

              className="font-mono"

              onKeyDown={(e) => e.key === "Enter" && void lookupByNumber()}

            />

            <Button type="button" variant="outline" onClick={() => void lookupByNumber()} disabled={lookingUp || !employeeNumber.trim()}>

              {lookingUp ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}

            </Button>

          </div>

          {lookupError && <p className="text-xs text-destructive">{lookupError}</p>}

        </div>

      )}



      {lookingUp && !preview && (

        <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">

          <Loader2 className="w-4 h-4 animate-spin" />

          {t("provision_loading")}

        </div>

      )}



      {preview && (

        <div className={cn(

          "rounded-lg border p-4 space-y-2 text-sm",

          preview.canProvision ? "bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800" : "bg-destructive/5 border-destructive/30",

        )}>

          <div className="flex items-start justify-between gap-2">

            <div>

              <p className="font-semibold">{preview.fullName}</p>

              <p className="text-xs font-mono text-muted-foreground">#{preview.employeeNumber}</p>

            </div>

            <Badge variant={preview.canProvision ? "secondary" : "destructive"}>{preview.status}</Badge>

          </div>

          {preview.email && <p className="text-xs text-muted-foreground">{preview.email}</p>}

          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground pt-1">

            {preview.orgUnitName && (

              <span className="flex items-center gap-1"><Building2 className="w-3 h-3" />{preview.orgUnitName}</span>

            )}

            {(preview.jobTitleName || preview.position) && (

              <span className="flex items-center gap-1"><Briefcase className="w-3 h-3" />{preview.jobTitleName ?? preview.position}</span>

            )}

            {preview.managerName && <span>{t("provision_manager")} {preview.managerName}</span>}

          </div>

          {!preview.canProvision && preview.blockReason && (

            <p className="text-xs text-destructive pt-1">{preview.blockReason}</p>

          )}

        </div>

      )}



      {preview?.canProvision && (

        <>

          <div className="space-y-1.5">

            <Label>{t("provision_initial_password")} <span className="text-destructive">*</span></Label>

            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("provision_password_min")} />

          </div>

          <div className="grid grid-cols-2 gap-3">

            <div className="space-y-1.5">

              <Label>{t("provision_platform_role")}</Label>

              <Select value={role} onValueChange={(v) => setRole(v as Role)}>

                <SelectTrigger><SelectValue /></SelectTrigger>

                <SelectContent>

                  <SelectItem value="member">{t("provision_role_member")}</SelectItem>

                  <SelectItem value="manager">{t("provision_role_manager")}</SelectItem>

                  <SelectItem value="admin">{t("provision_role_admin")}</SelectItem>

                </SelectContent>

              </Select>

            </div>

            {workspaceRoles.length > 0 && (

              <div className="space-y-1.5">

                <Label>{t("provision_custom_role")}</Label>

                <Select value={customRoleId} onValueChange={setCustomRoleId}>

                  <SelectTrigger><SelectValue /></SelectTrigger>

                  <SelectContent>

                    <SelectItem value="__none__">{t("provision_custom_none")}</SelectItem>

                    {workspaceRoles.map((r: { id: number; name: string }) => (

                      <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>

                    ))}

                  </SelectContent>

                </Select>

              </div>

            )}

          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">

            <div className="flex items-center gap-2">

              <KeyRound className="w-4 h-4 text-amber-500" />

              <div>

                <p className="text-sm font-medium">{t("provision_force_reset")}</p>

                <p className="text-xs text-muted-foreground">{isAr ? "عند أول تسجيل دخول" : "On first login"}</p>

              </div>

            </div>

            <Switch checked={mustResetPassword} onCheckedChange={setMustResetPassword} />

          </div>

        </>

      )}

    </>

  );



  const footer = (

    <>

      <Button variant="outline" onClick={handleClose}>{t("cancel")}</Button>

      <Button onClick={() => void submit()} disabled={!canSubmit || submitting}>

        {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}

        {t("provision_create_link")}

      </Button>

    </>

  );



  if (embedded) {

    if (!open) return null;

    return (

      <div className="space-y-4 py-1">

        {formBody}

        <DialogFooter className="pt-2">{footer}</DialogFooter>

      </div>

    );

  }



  return (

    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>

      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">

        <DialogHeader>

          <DialogTitle className="flex items-center gap-2">

            <UserCheck className="w-4 h-4 text-primary" />

            {t("users_tab_existing_employee")}

          </DialogTitle>

          <DialogDescription>

            {t("provision_dialog_desc")}

          </DialogDescription>

        </DialogHeader>



        <div className="space-y-4 py-1">{formBody}</div>



        <DialogFooter>{footer}</DialogFooter>

      </DialogContent>

    </Dialog>

  );

}


