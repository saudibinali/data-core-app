import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useApiFetch } from "@/hooks/use-api-fetch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  ChevronLeft, UserPlus, Save, Loader2, Users,
  Briefcase, Building2, Phone, Mail, Hash, User,
} from "lucide-react";

interface OrgUnit  { id: number; name: string; type: string }
interface JobTitle { id: number; name: string; gradeName?: string | null }
interface JobGrade { id: number; name: string; code?: string | null }
interface Employee { id: number; fullName: string }

function SectionHeader({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <div className="flex items-center gap-2 py-2">
      <Icon className="w-4 h-4 text-primary shrink-0" />
      <span className="text-sm font-semibold text-foreground">{label}</span>
      <Separator className="flex-1" />
    </div>
  );
}

function FieldGroup({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{children}</div>;
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      {children}
    </div>
  );
}

export default function HrEmployeeNewPage() {
  const { i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [saving, setSaving] = useState(false);
  const [orgUnits, setOrgUnits]   = useState<OrgUnit[]>([]);
  const [jobTitles, setJobTitles] = useState<JobTitle[]>([]);
  const [jobGrades, setJobGrades] = useState<JobGrade[]>([]);
  const [managers, setManagers]   = useState<Employee[]>([]);

  const [form, setForm] = useState({
    // Identity
    fullName: "", firstName: "", lastName: "", email: "", phoneNumber: "", employeeNumber: "",
    // Employment
    employmentType: "full_time", status: "active", hireDate: "", endDate: "", probationEndDate: "",
    position: "", orgUnitId: "", jobTitleId: "", jobGradeId: "", directManagerId: "",
    company: "", branch: "", location: "",
    // Personal
    nationality: "", gender: "", dateOfBirth: "", maritalStatus: "",
    address: "", nationalId: "", passportNumber: "",
    // Emergency
    emergencyContactName: "", emergencyContactPhone: "", emergencyContactRelation: "",
    // Notes
    notes: "",
  });

  function set(field: string, value: string) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  const apiFetch = useApiFetch();

  useEffect(() => {
    apiFetch("/api/hr/org-units").then(r => r.json()).then(d => setOrgUnits(Array.isArray(d) ? d : [])).catch(() => {});
    apiFetch("/api/hr/job-titles").then(r => r.json()).then(d => setJobTitles(Array.isArray(d) ? d : [])).catch(() => {});
    apiFetch("/api/hr/job-grades").then(r => r.json()).then(d => setJobGrades(Array.isArray(d) ? d : [])).catch(() => {});
    apiFetch("/api/hr/employees?limit=200").then(r => r.json()).then((d: any) => setManagers(Array.isArray(d?.employees) ? d.employees : [])).catch(() => {});
  }, [apiFetch]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.fullName.trim()) {
      toast({ title: isAr ? "الاسم مطلوب" : "Full name is required", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(form)) {
        if (v !== "" && v !== null && v !== undefined) {
          if (["orgUnitId", "jobTitleId", "jobGradeId", "directManagerId"].includes(k)) {
            payload[k] = parseInt(v as string);
          } else {
            payload[k] = v;
          }
        }
      }

      const res = await apiFetch("/api/hr/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error ?? `HTTP ${res.status}`);
      }

      const emp = await res.json();
      toast({ title: isAr ? "تم إنشاء الموظف بنجاح" : "Employee created successfully" });
      navigate(`/hr/employees/${emp.id}`);
    } catch (err) {
      toast({
        title: isAr ? "فشل إنشاء الموظف" : "Failed to create employee",
        description: String(err),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  const orgUnitsByType = orgUnits.reduce<Record<string, OrgUnit[]>>((acc, u) => {
    (acc[u.type] ??= []).push(u);
    return acc;
  }, {});

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <Link href="/hr/employees">
          <button className="p-1 rounded-md hover:bg-accent transition-colors text-muted-foreground hover:text-foreground">
            <ChevronLeft className="w-5 h-5" />
          </button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <UserPlus className="w-6 h-6 text-primary" />
            {isAr ? "إضافة موظف جديد" : "Add New Employee"}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {isAr
              ? "يتم إنشاء سجل الموظف بشكل مستقل دون ربطه بحساب دخول"
              : "Creates a standalone employee record - no login account required"}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Identity */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <User className="w-4 h-4 text-primary" />
              {isAr ? "الهوية والمعلومات الشخصية" : "Identity & Personal Info"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FieldGroup>
              <Field label={isAr ? "الاسم الكامل" : "Full Name"} required>
                <Input value={form.fullName} onChange={e => set("fullName", e.target.value)} placeholder={isAr ? "مثال: محمد أحمد السعيد" : "e.g. John Smith"} />
              </Field>
              <Field label={isAr ? "الرقم الوظيفي" : "Employee Number"}>
                <div className="relative">
                  <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input className="pl-9 font-mono" value={form.employeeNumber} onChange={e => set("employeeNumber", e.target.value)} placeholder="EMP-001" />
                </div>
              </Field>
              <Field label={isAr ? "الاسم الأول" : "First Name"}>
                <Input value={form.firstName} onChange={e => set("firstName", e.target.value)} />
              </Field>
              <Field label={isAr ? "الاسم الأخير" : "Last Name"}>
                <Input value={form.lastName} onChange={e => set("lastName", e.target.value)} />
              </Field>
              <Field label={isAr ? "البريد الإلكتروني" : "Email"}>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input className="pl-9" type="email" value={form.email} onChange={e => set("email", e.target.value)} />
                </div>
              </Field>
              <Field label={isAr ? "رقم الهاتف" : "Phone Number"}>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input className="pl-9" type="tel" value={form.phoneNumber} onChange={e => set("phoneNumber", e.target.value)} />
                </div>
              </Field>
              <Field label={isAr ? "الجنسية" : "Nationality"}>
                <Input value={form.nationality} onChange={e => set("nationality", e.target.value)} placeholder={isAr ? "مثال: سعودي" : "e.g. Saudi"} />
              </Field>
              <Field label={isAr ? "الجنس" : "Gender"}>
                <Select value={form.gender || "__none"} onValueChange={v => set("gender", v === "__none" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder={isAr ? "اختر..." : "Select..."} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">{isAr ? "غير محدد" : "Not specified"}</SelectItem>
                    <SelectItem value="male">{isAr ? "ذكر" : "Male"}</SelectItem>
                    <SelectItem value="female">{isAr ? "أنثى" : "Female"}</SelectItem>
                    <SelectItem value="other">{isAr ? "آخر" : "Other"}</SelectItem>
                    <SelectItem value="prefer_not_to_say">{isAr ? "أفضل عدم الإفصاح" : "Prefer not to say"}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label={isAr ? "تاريخ الميلاد" : "Date of Birth"}>
                <Input type="date" value={form.dateOfBirth} onChange={e => set("dateOfBirth", e.target.value)} />
              </Field>
              <Field label={isAr ? "الحالة الاجتماعية" : "Marital Status"}>
                <Select value={form.maritalStatus || "__none"} onValueChange={v => set("maritalStatus", v === "__none" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder={isAr ? "اختر..." : "Select..."} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">{isAr ? "غير محدد" : "Not specified"}</SelectItem>
                    <SelectItem value="single">{isAr ? "أعزب" : "Single"}</SelectItem>
                    <SelectItem value="married">{isAr ? "متزوج" : "Married"}</SelectItem>
                    <SelectItem value="divorced">{isAr ? "مطلق" : "Divorced"}</SelectItem>
                    <SelectItem value="widowed">{isAr ? "أرمل" : "Widowed"}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label={isAr ? "رقم الهوية الوطنية" : "National ID"}>
                <Input value={form.nationalId} onChange={e => set("nationalId", e.target.value)} />
              </Field>
              <Field label={isAr ? "رقم الجواز" : "Passport Number"}>
                <Input value={form.passportNumber} onChange={e => set("passportNumber", e.target.value)} />
              </Field>
              <div className="sm:col-span-2">
                <Field label={isAr ? "العنوان" : "Address"}>
                  <Input value={form.address} onChange={e => set("address", e.target.value)} />
                </Field>
              </div>
            </FieldGroup>
          </CardContent>
        </Card>

        {/* Employment */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Briefcase className="w-4 h-4 text-primary" />
              {isAr ? "بيانات التوظيف" : "Employment Data"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FieldGroup>
              <Field label={isAr ? "حالة الموظف" : "Employee Status"} required>
                <Select value={form.status} onValueChange={v => set("status", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">{isAr ? "نشط" : "Active"}</SelectItem>
                    <SelectItem value="on_leave">{isAr ? "في إجازة" : "On Leave"}</SelectItem>
                    <SelectItem value="suspended">{isAr ? "موقوف" : "Suspended"}</SelectItem>
                    <SelectItem value="terminated">{isAr ? "منتهية خدمته" : "Terminated"}</SelectItem>
                    <SelectItem value="resigned">{isAr ? "مستقيل" : "Resigned"}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label={isAr ? "نوع التوظيف" : "Employment Type"}>
                <Select value={form.employmentType} onValueChange={v => set("employmentType", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="full_time">Full-time</SelectItem>
                    <SelectItem value="part_time">Part-time</SelectItem>
                    <SelectItem value="contractor">Contractor</SelectItem>
                    <SelectItem value="intern">Intern</SelectItem>
                    <SelectItem value="temporary">Temporary</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label={isAr ? "تاريخ الالتحاق" : "Hire Date"}>
                <Input type="date" value={form.hireDate} onChange={e => set("hireDate", e.target.value)} />
              </Field>
              <Field label={isAr ? "تاريخ نهاية فترة التجربة" : "Probation End Date"}>
                <Input type="date" value={form.probationEndDate} onChange={e => set("probationEndDate", e.target.value)} />
              </Field>
              <Field label={isAr ? "تاريخ انتهاء العقد" : "Contract End Date"}>
                <Input type="date" value={form.endDate} onChange={e => set("endDate", e.target.value)} />
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>

        {/* Organizational Structure */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="w-4 h-4 text-primary" />
              {isAr ? "الهيكل التنظيمي والوظيفي" : "Organizational Structure"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FieldGroup>
              <Field label={isAr ? "المسمى الوظيفي" : "Job Title"}>
                {jobTitles.length > 0 ? (
                  <Select value={form.jobTitleId || "__none"} onValueChange={v => set("jobTitleId", v === "__none" ? "" : v)}>
                    <SelectTrigger><SelectValue placeholder={isAr ? "اختر مسمى..." : "Select title..."} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">{isAr ? "- لم يحدد -" : "- None -"}</SelectItem>
                      {jobTitles.map(t => (
                        <SelectItem key={t.id} value={String(t.id)}>
                          {t.name}{t.gradeName ? ` (${t.gradeName})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input value={form.position} onChange={e => set("position", e.target.value)} placeholder={isAr ? "مثال: مهندس برمجيات" : "e.g. Software Engineer"} />
                )}
              </Field>
              <Field label={isAr ? "المسمى الوظيفي (نص حر)" : "Position (free text)"}>
                <Input value={form.position} onChange={e => set("position", e.target.value)} placeholder={isAr ? "إذا لم يوجد في القائمة" : "If not in list above"} />
              </Field>
              <Field label={isAr ? "الدرجة الوظيفية" : "Job Grade"}>
                {jobGrades.length > 0 ? (
                  <Select value={form.jobGradeId || "__none"} onValueChange={v => set("jobGradeId", v === "__none" ? "" : v)}>
                    <SelectTrigger><SelectValue placeholder={isAr ? "اختر الدرجة..." : "Select grade..."} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">{isAr ? "- لم تحدد -" : "- None -"}</SelectItem>
                      {jobGrades.map(g => (
                        <SelectItem key={g.id} value={String(g.id)}>{g.name}{g.code ? ` (${g.code})` : ""}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-xs text-muted-foreground italic py-2">{isAr ? "لا توجد درجات مضافة بعد" : "No job grades added yet"}</p>
                )}
              </Field>
              <Field label={isAr ? "الوحدة التنظيمية / القسم" : "Org Unit / Department"}>
                {orgUnits.length > 0 ? (
                  <Select value={form.orgUnitId || "__none"} onValueChange={v => set("orgUnitId", v === "__none" ? "" : v)}>
                    <SelectTrigger><SelectValue placeholder={isAr ? "اختر القسم..." : "Select unit..."} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">{isAr ? "- لم يحدد -" : "- None -"}</SelectItem>
                      {Object.entries(orgUnitsByType).map(([type, units]) => (
                        <div key={type}>
                          <div className="px-2 py-1 text-xs text-muted-foreground font-medium uppercase tracking-wide">{type}</div>
                          {units.map(u => (
                            <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
                          ))}
                        </div>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-xs text-muted-foreground italic py-2">{isAr ? "لا توجد وحدات تنظيمية بعد" : "No org units added yet"}</p>
                )}
              </Field>
              <Field label={isAr ? "المدير المباشر" : "Direct Manager"}>
                {managers.length > 0 ? (
                  <Select value={form.directManagerId || "__none"} onValueChange={v => set("directManagerId", v === "__none" ? "" : v)}>
                    <SelectTrigger><SelectValue placeholder={isAr ? "اختر المدير..." : "Select manager..."} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">{isAr ? "- لا يوجد -" : "- None -"}</SelectItem>
                      {managers.map(m => (
                        <SelectItem key={m.id} value={String(m.id)}>{m.fullName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-xs text-muted-foreground italic py-2">{isAr ? "لا يوجد موظفون آخرون بعد" : "No other employees yet"}</p>
                )}
              </Field>
              <Field label={isAr ? "الشركة" : "Company"}>
                <Input value={form.company} onChange={e => set("company", e.target.value)} />
              </Field>
              <Field label={isAr ? "الفرع" : "Branch"}>
                <Input value={form.branch} onChange={e => set("branch", e.target.value)} />
              </Field>
              <Field label={isAr ? "الموقع" : "Location"}>
                <Input value={form.location} onChange={e => set("location", e.target.value)} />
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>

        {/* Emergency Contact */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Phone className="w-4 h-4 text-primary" />
              {isAr ? "جهة الاتصال في حالات الطوارئ" : "Emergency Contact"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field label={isAr ? "الاسم" : "Contact Name"}>
                <Input value={form.emergencyContactName} onChange={e => set("emergencyContactName", e.target.value)} />
              </Field>
              <Field label={isAr ? "رقم الهاتف" : "Phone"}>
                <Input type="tel" value={form.emergencyContactPhone} onChange={e => set("emergencyContactPhone", e.target.value)} />
              </Field>
              <Field label={isAr ? "صلة القرابة" : "Relationship"}>
                <Input value={form.emergencyContactRelation} onChange={e => set("emergencyContactRelation", e.target.value)} placeholder={isAr ? "مثال: زوجة، والد" : "e.g. Spouse, Parent"} />
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>

        {/* Notes */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{isAr ? "ملاحظات" : "Notes"}</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              value={form.notes}
              onChange={e => set("notes", e.target.value)}
              placeholder={isAr ? "أي ملاحظات إضافية..." : "Any additional notes..."}
              rows={3}
            />
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pb-6">
          <Button type="button" variant="outline" onClick={() => navigate("/hr/employees")}>
            {isAr ? "إلغاء" : "Cancel"}
          </Button>
          <Button type="submit" disabled={saving || !form.fullName.trim()}>
            {saving ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{isAr ? "جارٍ الحفظ..." : "Saving..."}</>
            ) : (
              <><Save className="w-4 h-4 mr-2" />{isAr ? "حفظ الموظف" : "Save Employee"}</>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
