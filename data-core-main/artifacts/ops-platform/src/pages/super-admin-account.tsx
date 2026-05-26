import { useCallback, useEffect, useState } from "react";
import { useAppAuth } from "@/lib/auth";
import {
  authChangePassword,
  getAuthMe,
  patchAuthMeEmail,
  patchAuthMeProfile,
  type AuthSessionUser,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ShieldCheck, KeyRound, Mail, User, Loader2, CheckCircle2 } from "lucide-react";

interface AuthMeResponse extends AuthSessionUser {
  role: string;
}

interface AccountView {
  id: number;
  email: string;
  displayName: string;
  isRootOwner: boolean;
  jobTitle: string;
  department: string;
  phone: string;
  mustResetPassword: boolean;
}

function mapAuthMe(data: AuthMeResponse): AccountView {
  const isLegacyRoot =
    data.role === "super_admin" &&
    (data.platformRoleCode === null || data.platformRoleCode === undefined) &&
    !data.isRootOwner;
  return {
    id: data.id,
    email: data.email ?? "",
    displayName: data.fullName ?? "",
    isRootOwner: Boolean(data.isRootOwner) || isLegacyRoot,
    jobTitle: data.platformJobTitle ?? "",
    department: data.platformDepartment ?? "",
    phone: data.platformPhone ?? data.phoneNumber ?? "",
    mustResetPassword: Boolean(data.mustResetPassword),
  };
}

export default function SuperAdminAccountPage() {
  const { user: authUser, refreshUser } = useAppAuth();
  const { toast } = useToast();

  const [me, setMe] = useState<AccountView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [department, setDepartment] = useState("");
  const [phone, setPhone] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);

  const [newEmail, setNewEmail] = useState("");
  const [emailCurrentPassword, setEmailCurrentPassword] = useState("");
  const [emailSaving, setEmailSaving] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);

  const applyAccount = useCallback((account: AccountView) => {
    setMe(account);
    setDisplayName(account.displayName);
    setJobTitle(account.jobTitle);
    setDepartment(account.department);
    setPhone(account.phone);
    setNewEmail(account.email);
    setLoadError(null);
  }, []);

  const loadMe = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await getAuthMe();
      if (data.role !== "super_admin") {
        throw new Error("Forbidden — My Account is for the platform super administrator only. (SUPER_ADMIN_ONLY)");
      }
      applyAccount(mapAuthMe(data as AuthMeResponse));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setLoadError(msg);
      if (authUser?.role === "super_admin") {
        applyAccount({
          id: authUser.id,
          email: authUser.email ?? "",
          displayName: authUser.fullName ?? "",
          isRootOwner: Boolean(authUser.isRootOwner),
          jobTitle: "",
          department: "",
          phone: authUser.phoneNumber ?? "",
          mustResetPassword: Boolean(authUser.mustResetPassword),
        });
      }
      toast({
        variant: "destructive",
        title: "Could not load full account",
        description: msg,
      });
    } finally {
      setLoading(false);
    }
  }, [toast, applyAccount, authUser]);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  async function saveProfile() {
    setProfileSaving(true);
    try {
      await patchAuthMeProfile({
        displayName: displayName.trim(),
        jobTitle: jobTitle.trim() || null,
        department: department.trim() || null,
        phone: phone.trim() || null,
      });
      toast({ title: "Profile updated", description: "Your profile information was saved." });
      await loadMe();
      await refreshUser();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Profile update failed",
        description: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setProfileSaving(false);
    }
  }

  async function saveEmail() {
    setEmailSaving(true);
    try {
      await patchAuthMeEmail({
        email: newEmail.trim(),
        currentPassword: emailCurrentPassword,
      });
      setEmailCurrentPassword("");
      toast({ title: "Email updated", description: "Your sign-in email was updated." });
      await loadMe();
      await refreshUser();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Email update failed",
        description: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setEmailSaving(false);
    }
  }

  async function changePassword() {
    if (newPassword !== confirmPassword) {
      toast({
        variant: "destructive",
        title: "Passwords do not match",
        description: "Confirm password must match the new password.",
      });
      return;
    }
    setPasswordSaving(true);
    try {
      await authChangePassword({ currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast({ title: "Password updated", description: "Your password was changed successfully." });
      await loadMe();
      await refreshUser();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Password change failed",
        description: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setPasswordSaving(false);
    }
  }

  if (loading && !me) {
    return (
      <div className="flex items-center justify-center min-h-[40vh] text-muted-foreground gap-2">
        <Loader2 className="w-5 h-5 animate-spin" />
        Loading account…
      </div>
    );
  }

  const isRoot = me?.isRootOwner ?? authUser?.isRootOwner;

  return (
    <div className="max-w-3xl mx-auto w-full px-4 py-6 sm:px-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">My Account</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your platform sign-in credentials and profile. Only you can change this account.
        </p>
      </div>

      {loadError && me ? (
        <Alert className="border-amber-300 bg-amber-50 dark:bg-amber-950/30">
          <AlertDescription>
            Some account details could not be refreshed from the server. You can still edit and save below. ({loadError})
          </AlertDescription>
        </Alert>
      ) : null}

      {me?.mustResetPassword && (
        <Alert className="border-amber-300 bg-amber-50 dark:bg-amber-950/30">
          <KeyRound className="h-4 w-4" />
          <AlertDescription>
            You must change your password before continuing. Use the form below.
          </AlertDescription>
        </Alert>
      )}

      {isRoot && (
        <Alert className="border-violet-300 bg-violet-50 dark:bg-violet-950/30">
          <ShieldCheck className="h-4 w-4 text-violet-600" />
          <AlertDescription>
            Root Platform Owner account. Other administrators cannot modify your credentials; use this page for
            password, email, and profile updates.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <User className="w-4 h-4" />
            Profile
          </CardTitle>
          <CardDescription>Display name and contact details visible within the platform.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="displayName">Display name</Label>
              <Input
                id="displayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                data-testid="account-display-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="jobTitle">Job title</Label>
              <Input id="jobTitle" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="department">Department</Label>
              <Input id="department" value={department} onChange={(e) => setDepartment(e.target.value)} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
          <Button onClick={() => void saveProfile()} disabled={profileSaving} data-testid="account-save-profile">
            {profileSaving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
            Save profile
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Mail className="w-4 h-4" />
            Email address
          </CardTitle>
          <CardDescription>Current: {me?.email ?? authUser?.email}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="newEmail">New email</Label>
            <Input
              id="newEmail"
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              data-testid="account-new-email"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="emailCurrentPassword">Current password</Label>
            <Input
              id="emailCurrentPassword"
              type="password"
              autoComplete="current-password"
              value={emailCurrentPassword}
              onChange={(e) => setEmailCurrentPassword(e.target.value)}
              data-testid="account-email-current-password"
            />
          </div>
          <Button onClick={() => void saveEmail()} disabled={emailSaving} data-testid="account-save-email">
            {emailSaving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Update email
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <KeyRound className="w-4 h-4" />
            Change password
          </CardTitle>
          <CardDescription>
            Enter your current password, then choose a strong new password that meets platform security rules.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="currentPassword">Current password</Label>
            <Input
              id="currentPassword"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              data-testid="account-current-password"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="newPassword">New password</Label>
            <Input
              id="newPassword"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              data-testid="account-new-password"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm new password</Label>
            <Input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              data-testid="account-confirm-password"
            />
          </div>
          <Button onClick={() => void changePassword()} disabled={passwordSaving} data-testid="account-change-password">
            {passwordSaving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Change password
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
