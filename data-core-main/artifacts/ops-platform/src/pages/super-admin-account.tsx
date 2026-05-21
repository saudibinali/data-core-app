import { useCallback, useEffect, useState } from "react";
import { useAppAuth } from "@/lib/auth";
import { useApiFetch } from "@/hooks/use-api-fetch";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ShieldCheck, KeyRound, Mail, User, Loader2, CheckCircle2 } from "lucide-react";

interface PlatformMe {
  id: number;
  email: string;
  displayName: string;
  isRootOwner: boolean;
  isProtected: boolean;
  effectivePlatformRoleCode: string | null;
  jobTitle: string | null;
  department: string | null;
  phone: string | null;
  mustResetPassword: boolean;
}

export default function SuperAdminAccountPage() {
  const { user: authUser, refreshUser } = useAppAuth();
  const apiFetch = useApiFetch();
  const { toast } = useToast();

  const [me, setMe] = useState<PlatformMe | null>(null);
  const [loading, setLoading] = useState(true);

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

  const loadMe = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch("/api/platform/me");
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Failed to load account");
      }
      const data = (await res.json()) as PlatformMe;
      setMe(data);
      setDisplayName(data.displayName ?? "");
      setJobTitle(data.jobTitle ?? "");
      setDepartment(data.department ?? "");
      setPhone(data.phone ?? "");
      setNewEmail(data.email ?? "");
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Could not load account",
        description: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setLoading(false);
    }
  }, [apiFetch, toast]);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  async function saveProfile() {
    setProfileSaving(true);
    try {
      const res = await apiFetch("/api/platform/me/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: displayName.trim(),
          jobTitle: jobTitle.trim() || null,
          department: department.trim() || null,
          phone: phone.trim() || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((body as { error?: string }).error ?? "Profile update failed");
      }
      toast({ title: "Profile updated", description: "Your profile information was saved." });
      await loadMe();
      await refreshUser?.();
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
      const res = await apiFetch("/api/platform/me/email", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: newEmail.trim(),
          currentPassword: emailCurrentPassword,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((body as { error?: string }).error ?? "Email update failed");
      }
      setEmailCurrentPassword("");
      toast({ title: "Email updated", description: "Sign in with your new email on next session." });
      await loadMe();
      await refreshUser?.();
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
      const res = await apiFetch("/api/platform/me/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((body as { error?: string }).error ?? "Password change failed");
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast({ title: "Password updated", description: "Your password was changed successfully." });
      await loadMe();
      await refreshUser?.();
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

  if (loading) {
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
