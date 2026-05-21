import { useState, useMemo, useEffect, useRef, useId } from "react";
import { format, parse, isValid } from "date-fns";
import { useTranslation } from "react-i18next";
import {
  ChevronLeft, ChevronRight, Plus, Clock, MapPin, Users, AlignLeft,
  Pencil, Trash2, Flag, Loader2, CalendarDays, X, Search, CheckCircle2,
  ChevronDown, ChevronUp, SendHorizonal, FileText, Bell, Users2,
  Building2, Mail, LayoutGrid, Columns3, AlignJustify, Zap,
  Calendar, ArrowRight, MoreHorizontal, Video, Link2, UserCheck, UserX,
  MonitorSmartphone, MapPinned,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
  useListCalendarEvents, useCreateCalendarEvent, useUpdateCalendarEvent,
  useDeleteCalendarEvent, useListUsers, useListGroups, useListDepartments,
  useRsvpCalendarEvent, useGetMe,
} from "@workspace/api-client-react";
import type { CalendarEvent } from "@workspace/api-client-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pad(n: number) { return String(n).padStart(2, "0"); }
function startOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d: Date)   { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
function startOfWeek(d: Date)  { return new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay()); }
function addDays(d: Date, n: number) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
function sameDay(a: Date, b: Date)   {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function formatMonthYear(d: Date) { return d.toLocaleDateString("en-US", { month: "long", year: "numeric" }); }
function formatShortDate(d: Date) { return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }); }
function formatDateFull(d: Date)  { return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }); }
function formatTime(d: Date)      { return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }); }
function toInput(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromInput(s: string) { return new Date(s).toISOString(); }

function formatCountdown(start: Date, end: Date, now: Date) {
  const msStart = start.getTime() - now.getTime();
  const msEnd   = end.getTime()   - now.getTime();
  if (msStart <= 0 && msEnd >= 0) return { label: "Happening now", short: "Now",    pill: "bg-green-500/15 text-green-700 dark:text-green-400 ring-1 ring-green-500/30",   dot: "bg-green-500 animate-pulse" };
  if (msEnd < 0) {
    const days = Math.floor(-msEnd / 86400000);
    return days === 0
      ? { label: "Ended today",       short: "Ended",  pill: "bg-muted text-muted-foreground",                                        dot: "bg-muted-foreground" }
      : { label: `${days}d ago`,      short: `${days}d ago`, pill: "bg-muted text-muted-foreground",                                  dot: "bg-muted-foreground" };
  }
  const mins  = Math.floor(msStart / 60000);
  const hours = Math.floor(mins / 60);
  const days  = Math.floor(hours / 24);
  if (mins < 60)  return { label: `In ${mins}m`,       short: `${mins}m`,  pill: "bg-amber-500/15 text-amber-700 dark:text-amber-400 ring-1 ring-amber-500/30",  dot: "bg-amber-500" };
  if (hours < 24) return { label: `In ${hours}h`,      short: `${hours}h`, pill: "bg-blue-500/15 text-blue-700 dark:text-blue-400 ring-1 ring-blue-500/30",     dot: "bg-blue-500"  };
  if (days === 1) return { label: "Tomorrow",          short: "Tomorrow",  pill: "bg-blue-500/15 text-blue-700 dark:text-blue-400 ring-1 ring-blue-500/30",     dot: "bg-blue-400"  };
  return          { label: formatShortDate(start),     short: formatShortDate(start), pill: "bg-muted text-muted-foreground",                                    dot: "bg-slate-400" };
}

const PRIORITY = {
  low:    { label: "Low",    bar: "bg-slate-400",  bg: "bg-slate-500/10 border-slate-500/20", chip: "border-l-slate-400",  text: "text-slate-600 dark:text-slate-400"  },
  medium: { label: "Medium", bar: "bg-blue-500",   bg: "bg-blue-500/10 border-blue-500/20",   chip: "border-l-blue-500",   text: "text-blue-700 dark:text-blue-400"    },
  high:   { label: "High",   bar: "bg-red-500",    bg: "bg-red-500/10 border-red-500/20",      chip: "border-l-red-500",    text: "text-red-700 dark:text-red-400"      },
};

const STATUS = {
  draft:     { label: "Draft",     badge: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",    chip: "bg-slate-100/80 border-l-slate-400 text-slate-700 dark:bg-slate-800/80 dark:text-slate-300" },
  scheduled: { label: "Scheduled", badge: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",        chip: "bg-blue-50 border-l-blue-500 text-blue-900 dark:bg-blue-950/60 dark:text-blue-100"          },
  active:    { label: "Active",    badge: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",    chip: "bg-green-50 border-l-green-500 text-green-900 dark:bg-green-950/60 dark:text-green-100"    },
  completed: { label: "Completed", badge: "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300",chip: "bg-purple-50 border-l-purple-500 text-purple-900 dark:bg-purple-950/60 dark:text-purple-100"},
  cancelled: { label: "Cancelled", badge: "bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400",            chip: "bg-muted/60 border-l-muted-foreground/30 text-muted-foreground line-through"               },
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);
type ViewMode = "month" | "week" | "day";

// ─── DateTime Input ───────────────────────────────────────────────────────────

function DateTimeInput({ type, value, onChange, btnLabel }: {
  type: "date" | "datetime-local";
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  btnLabel: string;
}) {
  const [open, setOpen] = useState(false);

  /* Parse value → Date for the calendar */
  const selectedDate: Date | undefined = useMemo(() => {
    if (!value) return undefined;
    const d = new Date(value);
    return isValid(d) ? d : undefined;
  }, [value]);

  /* For datetime-local keep a separate time string "HH:mm" */
  const timeStr = value && type === "datetime-local" ? value.slice(11, 16) : "09:00";

  function handleDaySelect(day: Date | undefined) {
    if (!day) return;
    if (type === "date") {
      onChange(format(day, "yyyy-MM-dd"));
      setOpen(false);
    } else {
      const [h, m] = timeStr.split(":").map(Number);
      day.setHours(h, m, 0, 0);
      onChange(format(day, "yyyy-MM-dd'T'HH:mm"));
    }
  }

  function handleTimeChange(t: string) {
    const base = value ? value.slice(0, 10) : format(new Date(), "yyyy-MM-dd");
    onChange(`${base}T${t}`);
  }

  function formatDisplay(val: string) {
    if (!val) return null;
    const d = new Date(val);
    if (!isValid(d)) return null;
    if (type === "date")
      return format(d, "EEE, MMM d, yyyy");
    return format(d, "EEE, MMM d, yyyy  ·  HH:mm");
  }

  const display = formatDisplay(value);

  return (
    <div className="space-y-1.5">
      {/* Trigger - full-width button, always fully clickable */}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="w-full justify-start gap-2 border-dashed border-primary/50 bg-primary/5 text-primary hover:bg-primary/10 hover:text-primary hover:border-primary font-medium"
          >
            <CalendarDays className="w-4 h-4 shrink-0" />
            {btnLabel}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start" side="bottom">
          <CalendarPicker
            mode="single"
            selected={selectedDate}
            onSelect={handleDaySelect}
            initialFocus
          />
          {type === "datetime-local" && (
            <div className="border-t px-3 py-2 flex items-center gap-2">
              <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
              <input
                type="time"
                value={timeStr}
                onChange={e => handleTimeChange(e.target.value)}
                className="flex-1 text-sm bg-transparent outline-none border rounded px-2 py-1 border-input"
              />
            </div>
          )}
        </PopoverContent>
      </Popover>

      {/* Read-only display - shown after a value is selected */}
      {display && (
        <div className="flex items-center gap-2 h-9 w-full rounded-md border border-input bg-muted/40 px-3 text-sm text-foreground select-none">
          <Clock className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
          <span className="flex-1 truncate">{display}</span>
          <button
            type="button"
            onClick={() => onChange("")}
            className="shrink-0 text-muted-foreground hover:text-destructive transition-colors cursor-pointer"
            tabIndex={-1}
            title="مسح"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Participant Selector ─────────────────────────────────────────────────────

interface SelP { id: number; name: string; avatar?: string | null; type: "user" | "group" | "dept" }

function ParticipantSelect({ label, selected, onChange, users, groups, departments, placeholder = "Search users, groups, departments..." }: {
  label: string; selected: SelP[]; onChange: (v: SelP[]) => void;
  users: any[]; groups: any[]; departments: any[]; placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen]   = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const q = query.toLowerCase();
  const filtered = useMemo(() => ({
    users:       users.filter((u: any) => !q || u.fullName?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q)).slice(0, 8),
    groups:      groups.filter((g: any) => !q || g.name?.toLowerCase().includes(q)).slice(0, 5),
    departments: departments.filter((d: any) => !q || d.name?.toLowerCase().includes(q)).slice(0, 5),
  }), [q, users, groups, departments]);

  const isSel = (id: number, type: string) => selected.some(s => s.id === id && s.type === type);

  function toggle(item: SelP) {
    onChange(isSel(item.id, item.type)
      ? selected.filter(s => !(s.id === item.id && s.type === item.type))
      : [...selected, item]);
    // Keep input focused so the popover stays open
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  const hasResults = filtered.users.length + filtered.groups.length + filtered.departments.length > 0;

  const sections = [
    { key: "users",       icon: Users2,    label: "Users",       items: filtered.users,       makeP: (u: any): SelP => ({ id: u.id, name: u.fullName,  avatar: u.avatarUrl, type: "user"  as const }) },
    { key: "groups",      icon: Users,     label: "Groups",      items: filtered.groups,      makeP: (g: any): SelP => ({ id: g.id, name: g.name,      avatar: null,        type: "group" as const }) },
    { key: "departments", icon: Building2, label: "Departments", items: filtered.departments, makeP: (d: any): SelP => ({ id: d.id, name: d.name,      avatar: null,        type: "dept"  as const }) },
  ];

  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>

      {/* Selected chips */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 p-2 border rounded-md bg-muted/20 min-h-9">
          {selected.map(p => (
            <div key={`${p.type}-${p.id}`} className="flex items-center gap-1 bg-background border shadow-sm rounded-full pl-1 pr-2 py-0.5 text-xs">
              <Avatar className="w-4 h-4"><AvatarImage src={p.avatar ?? undefined} /><AvatarFallback className="text-[8px]">{p.name?.[0]}</AvatarFallback></Avatar>
              <span>{p.name}</span>
              {p.type !== "user" && <span className="text-[10px] text-muted-foreground capitalize">({p.type})</span>}
              <button type="button" onMouseDown={e => { e.preventDefault(); e.stopPropagation(); toggle(p); }}
                className="ms-0.5 hover:text-destructive"><X className="w-2.5 h-2.5" /></button>
            </div>
          ))}
        </div>
      )}

      {/* Popover-based search - uses a portal so it's never clipped by Dialog overflow */}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <div className="relative">
            <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <input
              ref={inputRef}
              value={query}
              onChange={e => { setQuery(e.target.value); setOpen(true); }}
              onFocus={() => setOpen(true)}
              placeholder={placeholder}
              className="flex h-9 w-full rounded-md border border-input bg-transparent ps-8 pe-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
        </PopoverTrigger>
        <PopoverContent
          className="p-0 overflow-hidden"
          style={{ width: "var(--radix-popover-trigger-width)" }}
          align="start"
          onOpenAutoFocus={e => e.preventDefault()}
          onInteractOutside={e => {
            // Don't close if clicking on the trigger input
            if (inputRef.current?.contains(e.target as Node)) e.preventDefault();
          }}
        >
          <div className="max-h-64 overflow-y-auto">
            {!hasResults && (
              <p className="text-xs text-muted-foreground px-3 py-4 text-center">No results found</p>
            )}
            {sections.map(({ key, icon: Icon, label: sLabel, items, makeP }) =>
              items.length > 0 && (
                <div key={key}>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-3 py-1.5 border-b bg-muted/30 flex items-center gap-1.5">
                    <Icon className="w-3 h-3" />{sLabel}
                  </p>
                  {(items as any[]).map((item: any) => {
                    const p = makeP(item);
                    const selected_ = isSel(item.id, p.type);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onMouseDown={e => { e.preventDefault(); toggle(p); }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-accent text-sm transition-colors text-start"
                      >
                        {selected_
                          ? <CheckCircle2 className="w-3.5 h-3.5 text-primary shrink-0" />
                          : <div className="w-3.5 h-3.5 rounded border border-border shrink-0" />}
                        <Avatar className="w-6 h-6">
                          <AvatarImage src={item.avatarUrl ?? undefined} />
                          <AvatarFallback className="text-[9px]">{(item.fullName ?? item.name)?.[0]}</AvatarFallback>
                        </Avatar>
                        <span className="flex-1 truncate font-medium">{item.fullName ?? item.name}</span>
                        {item.email && <span className="text-xs text-muted-foreground truncate max-w-[120px]">{item.email}</span>}
                      </button>
                    );
                  })}
                </div>
              )
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

// ─── Event Form ───────────────────────────────────────────────────────────────

function EventForm({ initial, defaultDate, onClose, onSaved, users, groups, departments }: {
  initial?: CalendarEvent | null; defaultDate?: Date; onClose: () => void; onSaved: () => void;
  users: any[]; groups: any[]; departments: any[];
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const editing = !!initial?.id;

  const ds = initial?.startAt ? toInput(initial.startAt) : (() => { const d = defaultDate ?? new Date(); d.setHours(9,0,0,0); return toInput(d.toISOString()); })();
  const de = initial?.endAt   ? toInput(initial.endAt)   : (() => { const d = defaultDate ?? new Date(); d.setHours(10,0,0,0); return toInput(d.toISOString()); })();

  const [form, setForm] = useState({
    title: initial?.title ?? "", description: initial?.description ?? "",
    invitationMessage: initial?.invitationMessage ?? "",
    startAt: ds, endAt: de, isAllDay: initial?.isAllDay ?? false,
    eventType: (initial?.eventType ?? "in_person") as "in_person" | "online",
    location: initial?.location ?? "",
    meetingLink: initial?.meetingLink ?? "",
    priority: initial?.priority ?? "medium",
    status: (initial?.status === "draft" ? "draft" : "scheduled") as "draft" | "scheduled",
    notes: initial?.notes ?? "",
  });

  const [mainP, setMainP] = useState<SelP[]>(() =>
    (initial?.participants ?? []).filter(p => p.participantType === "main")
      .map(p => ({ id: p.userId, name: p.fullName, avatar: p.avatarUrl, type: "user" as const }))
  );
  const [ccP, setCcP] = useState<SelP[]>(() =>
    (initial?.participants ?? []).filter(p => p.participantType === "cc")
      .map(p => ({ id: p.userId, name: p.fullName, avatar: p.avatarUrl, type: "user" as const }))
  );

  const createEvent = useCreateCalendarEvent();
  const updateEvent = useUpdateCalendarEvent();
  const busy = createEvent.isPending || updateEvent.isPending;
  const set = (key: string, val: unknown) => setForm(f => ({ ...f, [key]: val }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) { toast({ title: t("title_required"), variant: "destructive" }); return; }
    const payload = {
      ...form,
      startAt: fromInput(form.startAt), endAt: fromInput(form.endAt),
      description:       form.description       || undefined,
      invitationMessage: form.invitationMessage  || undefined,
      location:          form.eventType === "in_person" ? (form.location    || undefined) : undefined,
      meetingLink:       form.eventType === "online"    ? (form.meetingLink || undefined) : undefined,
      notes:             form.notes || undefined,
      participantUserIds: mainP.filter(p => p.type === "user").map(p => p.id),
      ccUserIds:          ccP.filter(p => p.type === "user").map(p => p.id),
    };
    try {
      if (editing && initial?.id) {
        await updateEvent.mutateAsync({ id: initial.id, data: payload });
        toast({ title: form.status === "scheduled" && initial.status === "draft" ? t("event_sent_to") : t("event_updated") });
      } else {
        await createEvent.mutateAsync({ data: payload });
        toast({ title: form.status === "scheduled" ? t("event_created_sent") : t("event_draft_saved") });
      }
      onSaved();
    } catch { toast({ title: t("failed_save_event"), variant: "destructive" }); }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="ev-title">Title *</Label>
        <Input id="ev-title" value={form.title} onChange={e => set("title", e.target.value)} placeholder="Event title" required className="font-medium" />
      </div>

      <div className="flex gap-2">
        {(["draft", "scheduled"] as const).map(s => (
          <button key={s} type="button" onClick={() => set("status", s)}
            className={cn("flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-all",
              form.status === s ? "border-primary bg-primary/10 text-primary shadow-sm" : "border-border text-muted-foreground hover:bg-muted")}>
            {s === "draft" ? <FileText className="w-4 h-4" /> : <SendHorizonal className="w-4 h-4" />}
            {s === "draft" ? t("save_as_draft") : t("schedule_send")}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 py-0.5">
        <Checkbox id="ev-allday" checked={form.isAllDay} onCheckedChange={v => set("isAllDay", !!v)} />
        <Label htmlFor="ev-allday" className="cursor-pointer font-normal text-sm">{t("all_day")}</Label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <DateTimeInput
          type={form.isAllDay ? "date" : "datetime-local"}
          value={form.isAllDay ? form.startAt.slice(0, 10) : form.startAt}
          onChange={v => set("startAt", form.isAllDay ? v + "T00:00" : v)}
          btnLabel={t("event_start_label")}
          required
        />
        <DateTimeInput
          type={form.isAllDay ? "date" : "datetime-local"}
          value={form.isAllDay ? form.endAt.slice(0, 10) : form.endAt}
          onChange={v => set("endAt", form.isAllDay ? v + "T23:59" : v)}
          btnLabel={t("event_end_label")}
          required
        />
      </div>

      {/* Event Type Toggle */}
      <div className="space-y-1.5">
        <Label>{t("event_type_label")}</Label>
        <div className="flex gap-2">
          {([
            { key: "in_person" as const, label: t("event_type_in_person"), Icon: MapPinned    },
            { key: "online"    as const, label: t("event_type_online"),    Icon: MonitorSmartphone },
          ]).map(({ key, label, Icon }) => (
            <button key={key} type="button" onClick={() => set("eventType", key)}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-all",
                form.eventType === key
                  ? "border-primary bg-primary/10 text-primary shadow-sm"
                  : "border-border text-muted-foreground hover:bg-muted",
              )}>
              <Icon className="w-4 h-4" />{label}
            </button>
          ))}
        </div>
      </div>

      {/* Location (in-person) or Meeting Link (online) */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          {form.eventType === "in_person" ? (
            <>
              <Label className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5 text-muted-foreground" />{t("event_location_label")}</Label>
              <Input value={form.location} onChange={e => set("location", e.target.value)}
                placeholder={t("event_location_inperson_placeholder")} className="text-sm" />
            </>
          ) : (
            <>
              <Label className="flex items-center gap-1.5"><Link2 className="w-3.5 h-3.5 text-muted-foreground" />{t("event_meeting_link_label")}</Label>
              <Input value={form.meetingLink} onChange={e => set("meetingLink", e.target.value)}
                placeholder={t("event_meeting_link_placeholder")} className="text-sm" type="url" />
            </>
          )}
        </div>
        <div className="space-y-1.5">
          <Label>{t("event_priority_label")}</Label>
          <Select value={form.priority} onValueChange={v => set("priority", v)}>
            <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(["low", "medium", "high"] as const).map(p => (
                <SelectItem key={p} value={p}>
                  <div className="flex items-center gap-2"><span className={cn("w-2 h-2 rounded-full", PRIORITY[p].bar)} />{PRIORITY[p].label}</div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>{t("event_desc_label")}</Label>
        <Textarea value={form.description} onChange={e => set("description", e.target.value)} placeholder={t("event_desc_placeholder")} rows={2} className="text-sm resize-none" />
      </div>

      <div className="space-y-1.5">
        <Label className="flex items-center gap-2">
          <Mail className="w-3.5 h-3.5 text-muted-foreground" />{t("invitation_msg_label")}
          <span className="text-xs text-muted-foreground font-normal">{t("invitation_msg_note")}</span>
        </Label>
        <Textarea value={form.invitationMessage} onChange={e => set("invitationMessage", e.target.value)}
          placeholder={t("invitation_msg_placeholder")} rows={3} className="text-sm resize-none" />
      </div>

      <ParticipantSelect label={t("participants_to")} selected={mainP} onChange={setMainP} users={users} groups={groups} departments={departments} />
      <ParticipantSelect label={t("participants_cc")} selected={ccP} onChange={setCcP} users={users} groups={groups} departments={departments} placeholder={t("add_cc_recipients")} />

      <div className="space-y-1.5">
        <Label>{t("notes_label")} <span className="text-xs text-muted-foreground font-normal">{t("notes_private")}</span></Label>
        <Textarea value={form.notes} onChange={e => set("notes", e.target.value)} placeholder={t("notes_placeholder")} rows={2} className="text-sm resize-none" />
      </div>

      <div className="flex justify-end gap-2 pt-1 border-t">
        <Button type="button" variant="outline" onClick={onClose} disabled={busy}>{t("cancel")}</Button>
        <Button type="submit" disabled={busy} className="min-w-[120px]">
          {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          {editing
            ? (form.status === "scheduled" && initial?.status === "draft" ? t("send_event_btn") : t("save_changes_btn"))
            : (form.status === "draft" ? t("save_draft_btn") : t("create_send_btn"))}
        </Button>
      </div>
    </form>
  );
}

// ─── Event Detail ─────────────────────────────────────────────────────────────

function EventDetail({ event, onClose, onEdit, onDeleted, onRsvpDone }: {
  event: CalendarEvent; onClose: () => void; onEdit: () => void;
  onDeleted: () => void; onRsvpDone: (updated: CalendarEvent) => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const deleteEvent = useDeleteCalendarEvent();
  const rsvp        = useRsvpCalendarEvent();
  const { data: me } = useGetMe({});

  const [now, setNow]               = useState(new Date());
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineNote, setDeclineNote] = useState("");
  const [changingRsvp, setChangingRsvp] = useState(false);

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(t); }, []);

  const start = new Date(event.startAt);
  const end   = new Date(event.endAt);
  const p     = event.priority as keyof typeof PRIORITY;
  const s     = event.status   as keyof typeof STATUS;
  const cd    = formatCountdown(start, end, now);
  const mainP = event.participants.filter(p => p.participantType === "main");
  const ccP   = event.participants.filter(p => p.participantType === "cc");

  const isCreator = me?.id === event.createdByUserId;
  const myStatus  = event.currentUserStatus ?? null;
  const isParticipant = event.participants.some(p => p.userId === me?.id);
  const showRsvp  = !isCreator && isParticipant && (myStatus === "invited" || changingRsvp);

  async function handleDelete() {
    if (!confirm(t("delete_event_confirm"))) return;
    try { await deleteEvent.mutateAsync({ id: event.id }); toast({ title: t("event_deleted") }); onDeleted(); }
    catch { toast({ title: t("failed_delete_event"), variant: "destructive" }); }
  }

  async function handleAccept() {
    try {
      const updated = await rsvp.mutateAsync({ id: event.id, data: { status: "accepted" } });
      toast({ title: t("rsvp_success_accepted") });
      setChangingRsvp(false);
      onRsvpDone(updated as CalendarEvent);
    } catch { toast({ title: t("rsvp_error"), variant: "destructive" }); }
  }

  async function handleDeclineSubmit() {
    if (!declineNote.trim()) { toast({ title: t("rsvp_note_required"), variant: "destructive" }); return; }
    try {
      const updated = await rsvp.mutateAsync({ id: event.id, data: { status: "declined", note: declineNote } });
      toast({ title: t("rsvp_success_declined") });
      setDeclineOpen(false);
      setDeclineNote("");
      setChangingRsvp(false);
      onRsvpDone(updated as CalendarEvent);
    } catch { toast({ title: t("rsvp_error"), variant: "destructive" }); }
  }

  return (
    <>
    <div className="space-y-4">
      {/* Header band */}
      <div className={cn("rounded-lg p-4 border", PRIORITY[p]?.bg ?? "bg-muted")}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold leading-tight mb-2">{event.title}</h2>
            <div className="flex flex-wrap gap-1.5">
              <span className={cn("inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-full", STATUS[s]?.badge ?? "bg-muted text-muted-foreground")}>
                {STATUS[s]?.label ?? s}
              </span>
              <span className={cn("inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full", PRIORITY[p]?.bg ?? "bg-muted")}>
                <span className={cn("w-1.5 h-1.5 rounded-full", PRIORITY[p]?.bar)} />{PRIORITY[p]?.label ?? p} Priority
              </span>
              <span className={cn("inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full", cd.pill)}>
                <span className={cn("w-1.5 h-1.5 rounded-full", cd.dot)} />{cd.label}
              </span>
              {/* Event type badge */}
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-muted text-muted-foreground">
                {event.eventType === "online"
                  ? <><MonitorSmartphone className="w-3 h-3" />{t("event_type_online")}</>
                  : <><MapPinned className="w-3 h-3" />{t("event_type_in_person")}</>}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Details */}
      <div className="space-y-3">
        <div className="flex items-start gap-3 text-sm">
          <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
            <CalendarDays className="w-4 h-4 text-muted-foreground" />
          </div>
          <div className="pt-1">
            {event.isAllDay
              ? <p>{formatDateFull(start)}{!sameDay(start,end) && ` - ${formatDateFull(end)}`} · {t("all_day_label")}</p>
              : <p>{formatDateFull(start)}<br /><span className="font-semibold">{formatTime(start)} - {formatTime(end)}</span></p>}
          </div>
        </div>

        {event.location && (
          <div className="flex items-center gap-3 text-sm">
            <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0"><MapPin className="w-4 h-4 text-muted-foreground" /></div>
            <span>{event.location}</span>
          </div>
        )}

        {/* Meeting link for online events */}
        {event.eventType === "online" && event.meetingLink && (
          <div className="flex items-center gap-3 text-sm">
            <div className="w-8 h-8 rounded-lg bg-violet-50 dark:bg-violet-950/30 flex items-center justify-center shrink-0">
              <Video className="w-4 h-4 text-violet-500" />
            </div>
            <div className="flex-1 min-w-0">
              <a href={event.meetingLink} target="_blank" rel="noopener noreferrer"
                className="text-primary font-medium hover:underline truncate block">
                {t("join_meeting_link")}
              </a>
              <p className="text-xs text-muted-foreground truncate">{event.meetingLink}</p>
            </div>
            <a href={event.meetingLink} target="_blank" rel="noopener noreferrer">
              <Button size="sm" variant="outline" className="gap-1.5 shrink-0 border-violet-200 text-violet-700 hover:bg-violet-50 dark:border-violet-800 dark:text-violet-400">
                <Video className="w-3.5 h-3.5" />{t("join_meeting")}
              </Button>
            </a>
          </div>
        )}

        {event.description && (
          <div className="flex items-start gap-3 text-sm">
            <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0 mt-0.5"><AlignLeft className="w-4 h-4 text-muted-foreground" /></div>
            <p className="whitespace-pre-wrap leading-relaxed pt-1">{event.description}</p>
          </div>
        )}
      </div>

      {/* ── RSVP Section ── */}
      {isParticipant && !isCreator && (
        <div className={cn(
          "rounded-lg border p-3 space-y-2",
          myStatus === "accepted" ? "bg-green-50/60 dark:bg-green-950/20 border-green-200 dark:border-green-800" :
          myStatus === "declined" ? "bg-red-50/60 dark:bg-red-950/20 border-red-200 dark:border-red-800" :
          "bg-primary/5 border-primary/20"
        )}>
          <p className="text-xs font-semibold flex items-center gap-1.5 text-foreground">
            {myStatus === "accepted" ? <UserCheck className="w-3.5 h-3.5 text-green-600" /> :
             myStatus === "declined" ? <UserX    className="w-3.5 h-3.5 text-red-500"   /> :
             <Bell className="w-3.5 h-3.5 text-primary" />}
            {t("rsvp_section_title")}
          </p>

          {myStatus === "accepted" && !changingRsvp && (
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-green-700 dark:text-green-400">{t("rsvp_accepted_badge")}</span>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setChangingRsvp(true)}>{t("rsvp_change")}</Button>
            </div>
          )}

          {myStatus === "declined" && !changingRsvp && (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-red-600 dark:text-red-400">{t("rsvp_declined_badge")}</span>
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setChangingRsvp(true)}>{t("rsvp_change")}</Button>
              </div>
              {event.currentUserNote && (
                <p className="text-xs text-muted-foreground italic">"{event.currentUserNote}"</p>
              )}
            </div>
          )}

          {showRsvp && (
            <div className="flex gap-2">
              {myStatus !== "invited" && (
                <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={() => setChangingRsvp(false)}>{t("cancel")}</Button>
              )}
              <Button size="sm" onClick={handleAccept} disabled={rsvp.isPending}
                className="flex-1 h-8 gap-1.5 bg-green-600 hover:bg-green-700 text-white">
                {rsvp.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserCheck className="w-3.5 h-3.5" />}
                {t("rsvp_accept")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setDeclineOpen(true)} disabled={rsvp.isPending}
                className="flex-1 h-8 gap-1.5 border-red-200 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/30">
                <UserX className="w-3.5 h-3.5" />{t("rsvp_decline")}
              </Button>
            </div>
          )}

          {myStatus === "invited" && !showRsvp && (
            <p className="text-xs text-muted-foreground">{t("rsvp_pending_badge")}</p>
          )}
        </div>
      )}

      {event.invitationMessage && (
        <div className="rounded-lg border bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800 p-3">
          <p className="text-xs font-semibold text-blue-700 dark:text-blue-400 flex items-center gap-1.5 mb-1.5">
            <Mail className="w-3.5 h-3.5" />{t("invitation_message_section")}
          </p>
          <p className="text-sm whitespace-pre-wrap text-blue-900 dark:text-blue-200">{event.invitationMessage}</p>
        </div>
      )}

      {event.notes && (
        <div className="rounded-lg border bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800 p-3">
          <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-1">{t("private_notes")}</p>
          <p className="text-sm whitespace-pre-wrap">{event.notes}</p>
        </div>
      )}

      {/* Participants */}
      {mainP.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5" />{t("participants_label", { count: mainP.length })}
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {mainP.map(participant => (
              <div key={participant.id} className="flex items-center gap-2 p-1.5 rounded-lg bg-muted/40">
                <Avatar className="w-6 h-6"><AvatarImage src={participant.avatarUrl ?? undefined} /><AvatarFallback className="text-[9px]">{participant.fullName?.[0]}</AvatarFallback></Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{participant.fullName}</p>
                  <p className={cn("text-[10px]",
                    participant.status === "accepted" ? "text-green-600 dark:text-green-400" :
                    participant.status === "declined" ? "text-red-500" : "text-muted-foreground")}>
                    {participant.status}
                    {participant.status === "declined" && participant.rsvpNote && (
                      <span className="italic"> · "{participant.rsvpNote}"</span>
                    )}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {ccP.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{t("cc_participants", { count: ccP.length })}</p>
          <div className="flex flex-wrap gap-1.5">
            {ccP.map(participant => (
              <div key={participant.id} className="flex items-center gap-1.5 bg-muted/30 border border-dashed rounded-full pl-0.5 pr-2.5 py-0.5">
                <Avatar className="w-5 h-5"><AvatarImage src={participant.avatarUrl ?? undefined} /><AvatarFallback className="text-[9px]">{participant.fullName?.[0]}</AvatarFallback></Avatar>
                <span className="text-xs text-muted-foreground">{participant.fullName}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1">
        <Avatar className="w-5 h-5"><AvatarImage src={event.creatorAvatar ?? undefined} /><AvatarFallback className="text-[9px]">{event.creatorName?.[0]}</AvatarFallback></Avatar>
        {t("created_by_label")} <span className="font-medium text-foreground">{event.creatorName}</span>
      </div>

      <Separator />
      <div className="flex items-center justify-between">
        {isCreator ? (
          <Button variant="outline" size="sm" onClick={handleDelete} disabled={deleteEvent.isPending}
            className="text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30">
            {deleteEvent.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Trash2 className="w-4 h-4 me-1.5" />{t("delete")}</>}
          </Button>
        ) : <div />}
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>{t("close")}</Button>
          {isCreator && <Button size="sm" onClick={onEdit}><Pencil className="w-4 h-4 me-1.5" />{t("edit")}</Button>}
        </div>
      </div>
    </div>

    {/* Decline note dialog */}
    <Dialog open={declineOpen} onOpenChange={setDeclineOpen}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("rsvp_decline_note_title")}</DialogTitle>
          <DialogDescription>{t("rsvp_decline_note_desc")}</DialogDescription>
        </DialogHeader>
        <Textarea
          value={declineNote}
          onChange={e => setDeclineNote(e.target.value)}
          placeholder={t("rsvp_decline_note_placeholder")}
          rows={3}
          className="resize-none"
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => setDeclineOpen(false)}>{t("cancel")}</Button>
          <Button variant="destructive" onClick={handleDeclineSubmit} disabled={rsvp.isPending || !declineNote.trim()}>
            {rsvp.isPending ? <Loader2 className="w-4 h-4 me-2 animate-spin" /> : <UserX className="w-4 h-4 me-2" />}
            {t("rsvp_decline_confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}

// ─── Event Chip (calendar grid) ───────────────────────────────────────────────

function EventChip({ event, onClick, compact = false }: { event: CalendarEvent; onClick: () => void; compact?: boolean }) {
  const p = event.priority as keyof typeof PRIORITY;
  const s = event.status   as keyof typeof STATUS;
  const start = new Date(event.startAt);

  return (
    <button
      onClick={e => { e.stopPropagation(); onClick(); }}
      className={cn(
        "w-full text-left rounded-md border-l-[3px] px-1.5 transition-all hover:opacity-80 hover:shadow-sm group",
        compact ? "py-0.5" : "py-1",
        STATUS[s]?.chip ?? "bg-muted border-l-muted-foreground text-foreground",
      )}
    >
      <div className="flex items-center gap-1 min-w-0">
        <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", PRIORITY[p]?.bar)} />
        {!event.isAllDay && !compact && (
          <span className="text-[10px] opacity-70 shrink-0 tabular-nums">{formatTime(start)}</span>
        )}
        <span className={cn("truncate font-medium", compact ? "text-[10px]" : "text-xs")}>{event.title}</span>
      </div>
    </button>
  );
}

// ─── Sidebar Event Card ───────────────────────────────────────────────────────

function SidebarEventCard({ event, now, onClick }: { event: CalendarEvent; now: Date; onClick: () => void }) {
  const { t } = useTranslation();
  const start = new Date(event.startAt);
  const end   = new Date(event.endAt);
  const p     = event.priority as keyof typeof PRIORITY;
  const cd    = formatCountdown(start, end, now);
  const mainCount = event.participants.filter(p => p.participantType === "main").length;

  return (
    <button onClick={onClick}
      className="w-full text-left group rounded-xl border bg-card hover:bg-accent/40 hover:border-border/80 transition-all duration-150 shadow-sm hover:shadow-md overflow-hidden">
      <div className={cn("h-1 w-full", PRIORITY[p]?.bar ?? "bg-slate-400")} />
      <div className="p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-semibold leading-tight flex-1 truncate">{event.title}</p>
          <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0", cd.pill)}>{cd.short}</span>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Clock className="w-3 h-3 shrink-0" />
          <span>{event.isAllDay ? t("all_day_label") : formatTime(start)}</span>
          {event.location && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <MapPin className="w-3 h-3 shrink-0" />
              <span className="truncate">{event.location}</span>
            </>
          )}
        </div>
        {mainCount > 0 && (
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Users className="w-3 h-3 shrink-0" />
            <span>{t("participants_count", { count: mainCount })}</span>
          </div>
        )}
      </div>
    </button>
  );
}

// ─── Sidebar Section ──────────────────────────────────────────────────────────

function SidebarSection({ label, icon: Icon, events, now, onSelect, defaultOpen = true, accent = "bg-primary" }: {
  label: string; icon: any; events: CalendarEvent[]; now: Date;
  onSelect: (e: CalendarEvent) => void; defaultOpen?: boolean; accent?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (!events.length) return null;
  return (
    <div>
      <button className="w-full flex items-center justify-between px-1 py-2 group" onClick={() => setOpen(o => !o)}>
        <div className="flex items-center gap-2">
          <div className={cn("w-1.5 h-4 rounded-full", accent)} />
          <Icon className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold text-foreground">{label}</span>
          <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full font-medium">{events.length}</span>
        </div>
        {open ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
      </button>
      {open && (
        <div className="space-y-2 pb-3">
          {events.slice(0, 6).map(ev => <SidebarEventCard key={ev.id} event={ev} now={now} onClick={() => onSelect(ev)} />)}
          {events.length > 6 && (
            <button className="w-full text-xs text-muted-foreground hover:text-foreground flex items-center justify-center gap-1 py-1">
              +{events.length - 6} more <ArrowRight className="w-3 h-3" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Today Schedule Strip ─────────────────────────────────────────────────────

function TodayStrip({ events, now, onSelect }: { events: CalendarEvent[]; now: Date; onSelect: (e: CalendarEvent) => void }) {
  const { t } = useTranslation();
  const today = events.filter(ev => sameDay(new Date(ev.startAt), now)).sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
  if (!today.length) return (
    <div className="mx-1 mb-4 rounded-xl border border-dashed bg-muted/20 p-4 text-center">
      <Calendar className="w-8 h-8 text-muted-foreground/40 mx-auto mb-1" />
      <p className="text-xs text-muted-foreground">{t("no_events_today")}</p>
    </div>
  );
  return (
    <div className="mb-4">
      <div className="space-y-1.5">
        {today.slice(0, 4).map(ev => {
          const p = ev.priority as keyof typeof PRIORITY;
          const start = new Date(ev.startAt);
          const cd = formatCountdown(start, new Date(ev.endAt), now);
          return (
            <button key={ev.id} onClick={() => onSelect(ev)}
              className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-accent transition-colors group text-left">
              <div className={cn("w-1 h-6 rounded-full shrink-0", PRIORITY[p]?.bar ?? "bg-slate-400")} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{ev.title}</p>
                <p className="text-[10px] text-muted-foreground">{ev.isAllDay ? t("all_day_label") : formatTime(start)}</p>
              </div>
              <span className={cn("text-[9px] font-semibold px-1.5 py-0.5 rounded-full shrink-0", cd.pill)}>{cd.short}</span>
            </button>
          );
        })}
        {today.length > 4 && <p className="text-[10px] text-muted-foreground px-2">+{today.length - 4} {t("more_events_today")}</p>}
      </div>
    </div>
  );
}

// ─── Month View ───────────────────────────────────────────────────────────────

function MonthView({ current, events, today, onDateClick, onEventClick }: {
  current: Date; events: CalendarEvent[]; today: Date;
  onDateClick: (d: Date) => void; onEventClick: (e: CalendarEvent) => void;
}) {
  const gridStart = startOfWeek(startOfMonth(current));
  const days: Date[] = [];
  for (let d = new Date(gridStart); days.length < 42; d = addDays(d, 1)) days.push(new Date(d));

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      {/* Day headers */}
      <div className="grid grid-cols-7 border-b bg-muted/20">
        {DAY_NAMES.map(d => (
          <div key={d} className="py-2.5 text-center text-xs font-semibold text-muted-foreground tracking-wide uppercase">{d}</div>
        ))}
      </div>
      {/* Grid */}
      <div className="flex-1 grid grid-cols-7 grid-rows-6">
        {days.map((day, i) => {
          const isToday    = sameDay(day, today);
          const isCurMonth = day.getMonth() === current.getMonth();
          const dayEvs     = events.filter(ev => sameDay(new Date(ev.startAt), day));
          const isWeekend  = day.getDay() === 0 || day.getDay() === 6;
          return (
            <div key={i}
              className={cn(
                "border-b border-r flex flex-col cursor-pointer transition-colors group min-h-[100px]",
                !isCurMonth && "bg-muted/10",
                isWeekend && isCurMonth && "bg-muted/5",
                "hover:bg-accent/30",
              )}
              onClick={() => onDateClick(day)}
            >
              <div className="flex items-center justify-between px-2 pt-1.5 pb-1">
                <span className={cn(
                  "text-sm font-medium w-7 h-7 flex items-center justify-center rounded-full transition-colors",
                  isToday && "bg-primary text-primary-foreground font-bold shadow-md",
                  !isToday && !isCurMonth && "text-muted-foreground/50",
                  !isToday && isCurMonth && "text-foreground group-hover:bg-primary/10",
                )}>{day.getDate()}</span>
                {dayEvs.length > 0 && !isToday && (
                  <span className="text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">+add</span>
                )}
              </div>
              <div className="flex-1 px-1 pb-1 flex flex-col gap-0.5 overflow-hidden">
                {dayEvs.slice(0, 4).map(ev => (
                  <EventChip key={ev.id} event={ev} onClick={() => onEventClick(ev)} compact={dayEvs.length > 3} />
                ))}
                {dayEvs.length > 4 && (
                  <div className="text-[10px] text-muted-foreground pl-1 flex items-center gap-0.5">
                    <MoreHorizontal className="w-3 h-3" />{dayEvs.length - 4} more
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Week View ────────────────────────────────────────────────────────────────

function WeekView({ current, events, today, onSlotClick, onEventClick }: {
  current: Date; events: CalendarEvent[]; today: Date;
  onSlotClick: (d: Date) => void; onEventClick: (e: CalendarEvent) => void;
}) {
  const { t } = useTranslation();
  const ws   = startOfWeek(current);
  const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));

  return (
    <div className="flex-1 overflow-auto">
      <div className="min-w-[700px]">
        {/* Header */}
        <div className="grid grid-cols-[64px_repeat(7,1fr)] border-b sticky top-0 bg-background z-10 shadow-sm">
          <div />
          {days.map((d, i) => {
            const isT = sameDay(d, today);
            return (
              <div key={i} className={cn("py-3 text-center border-l", isT && "bg-primary/5")}>
                <p className="text-xs font-medium text-muted-foreground uppercase">{DAY_NAMES[d.getDay()]}</p>
                <p className={cn("text-xl font-bold w-10 h-10 flex items-center justify-center rounded-full mx-auto mt-0.5",
                  isT && "bg-primary text-primary-foreground shadow-lg")}>{d.getDate()}</p>
              </div>
            );
          })}
        </div>
        {/* All-day row */}
        <div className="grid grid-cols-[64px_repeat(7,1fr)] border-b">
          <div className="py-1 px-2 text-[10px] text-muted-foreground text-right pt-2 font-medium">{t("all_day_label")}</div>
          {days.map((d, i) => (
            <div key={i} className={cn("border-l min-h-[32px] p-1 flex flex-col gap-0.5", sameDay(d, today) && "bg-primary/5")}>
              {events.filter(ev => ev.isAllDay && sameDay(new Date(ev.startAt), d)).map(ev => (
                <EventChip key={ev.id} event={ev} onClick={() => onEventClick(ev)} />
              ))}
            </div>
          ))}
        </div>
        {/* Hours */}
        {HOURS.map(h => (
          <div key={h} className="grid grid-cols-[64px_repeat(7,1fr)] border-b">
            <div className="text-[11px] text-muted-foreground text-right px-2 -translate-y-2.5 tabular-nums font-medium">
              {h === 0 ? "" : `${h}:00`}
            </div>
            {days.map((d, i) => {
              const slot = events.filter(ev => !ev.isAllDay && sameDay(new Date(ev.startAt), d) && new Date(ev.startAt).getHours() === h);
              return (
                <div key={i} className={cn("border-l h-16 p-1 flex flex-col gap-0.5 cursor-pointer hover:bg-accent/30 transition-colors",
                  sameDay(d, today) && "bg-primary/5")}
                  onClick={() => { const nd = new Date(d); nd.setHours(h,0,0,0); onSlotClick(nd); }}>
                  {slot.map(ev => <EventChip key={ev.id} event={ev} onClick={() => onEventClick(ev)} />)}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Day View ─────────────────────────────────────────────────────────────────

function DayView({ current, events, onSlotClick, onEventClick }: {
  current: Date; events: CalendarEvent[]; onSlotClick: (d: Date) => void; onEventClick: (e: CalendarEvent) => void;
}) {
  const { t } = useTranslation();
  const allDay = events.filter(ev => ev.isAllDay && sameDay(new Date(ev.startAt), current));
  const timed  = events.filter(ev => !ev.isAllDay && sameDay(new Date(ev.startAt), current));

  return (
    <div className="flex-1 overflow-auto">
      <div className="min-w-[360px] max-w-3xl mx-auto">
        <div className="px-6 py-4 border-b">
          <h2 className="text-xl font-bold">{formatDateFull(current)}</h2>
          <p className="text-sm text-muted-foreground mt-0.5">{timed.length + allDay.length} event{timed.length + allDay.length !== 1 ? "s" : ""}</p>
        </div>
        {allDay.length > 0 && (
          <div className="px-6 py-3 border-b">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{t("all_day_label")}</p>
            <div className="flex flex-col gap-1">{allDay.map(ev => <EventChip key={ev.id} event={ev} onClick={() => onEventClick(ev)} />)}</div>
          </div>
        )}
        {HOURS.map(h => {
          const slot = timed.filter(ev => new Date(ev.startAt).getHours() === h);
          const isWorkHour = h >= 8 && h <= 18;
          return (
            <div key={h} className={cn("grid grid-cols-[80px_1fr] border-b min-h-[60px] cursor-pointer transition-colors",
              isWorkHour ? "hover:bg-accent/30" : "hover:bg-muted/20 bg-muted/5")}
              onClick={() => { const nd = new Date(current); nd.setHours(h,0,0,0); onSlotClick(nd); }}>
              <div className="text-[11px] text-muted-foreground text-right px-4 -translate-y-2.5 tabular-nums font-medium pt-3">
                {h === 0 ? "" : `${h}:00`}
              </div>
              <div className="p-1.5 flex flex-col gap-1">
                {slot.map(ev => <EventChip key={ev.id} event={ev} onClick={() => onEventClick(ev)} />)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CalendarPage() {
  const { t } = useTranslation();
  const [view, setView]        = useState<ViewMode>("month");
  const [current, setCurrent]  = useState(() => new Date());
  const today                  = useMemo(() => new Date(), []);
  const [now, setNow]          = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(t);
  }, []);

  const [formOpen,    setFormOpen]    = useState(false);
  const [detailOpen,  setDetailOpen]  = useState(false);
  const [editing,     setEditing]     = useState<CalendarEvent | null>(null);
  const [viewing,     setViewing]     = useState<CalendarEvent | null>(null);
  const [defaultDate, setDefaultDate] = useState<Date | undefined>();

  function handleRsvpDone(updated: CalendarEvent) {
    setViewing(updated);
    refetchAll();
    refetchGrid();
  }

  const { data: allEvents = [], refetch: refetchAll } = useListCalendarEvents(
    {}, { query: { queryKey: ["calendar-events-all"] } }
  );

  const fetchRange = useMemo(() => {
    if (view === "month") {
      const s = startOfMonth(current); s.setDate(s.getDate() - 7);
      const e = endOfMonth(current);   e.setDate(e.getDate() + 7);
      return { start: s.toISOString(), end: e.toISOString() };
    }
    if (view === "week") {
      const s = startOfWeek(current);
      return { start: s.toISOString(), end: addDays(s, 7).toISOString() };
    }
    const s = new Date(current); s.setHours(0,0,0,0);
    const e = new Date(current); e.setHours(23,59,59,999);
    return { start: s.toISOString(), end: e.toISOString() };
  }, [current, view]);

  const { data: gridEvents = [], isLoading, refetch: refetchGrid } = useListCalendarEvents(
    { start: fetchRange.start, end: fetchRange.end },
    { query: { queryKey: ["calendar-events-grid", fetchRange.start, fetchRange.end] } }
  );

  const { data: users = [] }       = useListUsers({});
  const { data: groups = [] }      = useListGroups({});
  const { data: departments = [] } = useListDepartments({});

  const categorized = useMemo(() => {
    const n = now.getTime();
    const activeNow: CalendarEvent[] = [], upcoming: CalendarEvent[] = [],
          previous: CalendarEvent[] = [], cancelled: CalendarEvent[] = [], drafts: CalendarEvent[] = [];
    for (const ev of allEvents) {
      const s = new Date(ev.startAt).getTime(), e = new Date(ev.endAt).getTime();
      if (ev.status === "draft")     { drafts.push(ev);    continue; }
      if (ev.status === "cancelled") { cancelled.push(ev); continue; }
      if (s <= n && e >= n)          { activeNow.push(ev); continue; }
      if (e < n)                     { previous.push(ev);  continue; }
      upcoming.push(ev);
    }
    upcoming.sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
    previous.sort((a, b) => new Date(b.startAt).getTime() - new Date(a.startAt).getTime());
    return { activeNow, upcoming, previous, cancelled, drafts };
  }, [allEvents, now]);

  function navigate(dir: -1 | 1) {
    setCurrent(prev => {
      if (view === "month") return new Date(prev.getFullYear(), prev.getMonth() + dir, 1);
      if (view === "week")  return addDays(prev, 7 * dir);
      return addDays(prev, dir);
    });
  }

  function headerLabel() {
    if (view === "month") return formatMonthYear(current);
    if (view === "week") {
      const ws = startOfWeek(current), we = addDays(ws, 6);
      return `${formatShortDate(ws)} - ${formatShortDate(we)}, ${we.getFullYear()}`;
    }
    return formatDateFull(current);
  }

  function openCreate(date?: Date) { setEditing(null); setDefaultDate(date); setFormOpen(true); }
  function openEdit(ev: CalendarEvent) { setEditing(ev); setDetailOpen(false); setFormOpen(true); }
  function openDetail(ev: CalendarEvent) { setViewing(ev); setDetailOpen(true); }
  function afterSave() { setFormOpen(false); setEditing(null); refetchAll(); refetchGrid(); }
  function afterDelete() { setDetailOpen(false); setViewing(null); refetchAll(); refetchGrid(); }

  // Stats bar
  const stats = useMemo(() => ({
    today:   allEvents.filter(ev => sameDay(new Date(ev.startAt), today)).length,
    active:  categorized.activeNow.length,
    upcoming:categorized.upcoming.length,
    drafts:  categorized.drafts.length,
  }), [allEvents, categorized, today]);

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      {/* ── Top Toolbar ── */}
      <div className="shrink-0 border-b bg-card shadow-sm">
        {/* Stats strip */}
        <div className="flex items-center gap-6 px-5 py-2 border-b border-border/50 bg-muted/20">
          <div className="flex items-center gap-1.5 text-xs">
            <Zap className="w-3.5 h-3.5 text-green-500" />
            <span className="text-muted-foreground">{t("event_stat_active")}:</span>
            <span className="font-semibold text-green-600 dark:text-green-400">{stats.active}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <CalendarDays className="w-3.5 h-3.5 text-blue-500" />
            <span className="text-muted-foreground">{t("event_stat_today")}:</span>
            <span className="font-semibold text-foreground">{stats.today}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">{t("event_stat_upcoming")}:</span>
            <span className="font-semibold text-foreground">{stats.upcoming}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <FileText className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">{t("event_stat_drafts")}:</span>
            <span className="font-semibold text-foreground">{stats.drafts}</span>
          </div>
          {isLoading && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground ml-auto">
              <Loader2 className="w-3 h-3 animate-spin" />{t("syncing")}
            </div>
          )}
        </div>
        {/* Navigation */}
        <div className="flex items-center justify-between px-5 py-3">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => setCurrent(new Date())} className="font-medium">{t("today_btn")}</Button>
            <div className="flex items-center gap-0.5">
              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={() => navigate(-1)}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={() => navigate(1)}>
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
            <h1 className="text-lg font-bold tracking-tight min-w-[200px]">{headerLabel()}</h1>
          </div>
          <div className="flex items-center gap-3">
            {/* View switcher */}
            <div className="flex items-center rounded-lg border bg-muted/40 p-0.5 gap-0.5">
              {([
                { v: "month" as const, icon: LayoutGrid,   label: t("month_view") },
                { v: "week"  as const, icon: Columns3,     label: t("week_view")  },
                { v: "day"   as const, icon: AlignJustify, label: t("day_view")   },
              ]).map(({ v, icon: Icon, label }) => (
                <button key={v} onClick={() => setView(v)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all",
                    view === v ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}>
                  <Icon className="w-3.5 h-3.5" />{label}
                </button>
              ))}
            </div>
            <Button size="sm" onClick={() => openCreate()} className="gap-1.5 shadow-sm font-semibold">
              <Plus className="w-4 h-4" />{t("new_event")}
            </Button>
          </div>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex flex-1 min-w-0 overflow-hidden flex-col xl:flex-row">
        {/* ── Calendar Grid (75%) ── */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0 xl:border-r border-b xl:border-b-0">
          {view === "month" && (
            <MonthView current={current} events={gridEvents} today={today}
              onDateClick={openCreate} onEventClick={openDetail} />
          )}
          {view === "week" && (
            <WeekView current={current} events={gridEvents} today={today}
              onSlotClick={openCreate} onEventClick={openDetail} />
          )}
          {view === "day" && (
            <DayView current={current} events={gridEvents}
              onSlotClick={openCreate} onEventClick={openDetail} />
          )}
        </div>

        {/* ── Right Sidebar (25%) — desktop / large tablet landscape ── */}
        <div className="hidden xl:flex w-72 xl:w-80 shrink-0 flex-col overflow-hidden bg-card/50 min-h-0">
          {/* Today header */}
          <div className="px-4 pt-4 pb-3 border-b">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-sm font-bold">{t("today_schedule")}</h3>
              <span className="text-xs text-muted-foreground">{today.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}</span>
            </div>
          </div>
          <div className="px-3 pt-3">
            <TodayStrip events={allEvents} now={now} onSelect={openDetail} />
          </div>

          <Separator />

          {/* Event sections */}
          <ScrollArea className="flex-1">
            <div className="px-3 py-3 space-y-1">
              {categorized.activeNow.length > 0 && (
                <SidebarSection label={t("calendar_active_now")} icon={Zap} events={categorized.activeNow} now={now} onSelect={openDetail} accent="bg-green-500" />
              )}
              <SidebarSection label={t("calendar_upcoming")} icon={CalendarDays} events={categorized.upcoming} now={now} onSelect={openDetail} accent="bg-blue-500" />
              <SidebarSection label={t("calendar_drafts")} icon={FileText} events={categorized.drafts} now={now} onSelect={openDetail} defaultOpen={false} accent="bg-slate-400" />
              <SidebarSection label={t("calendar_previous")} icon={Clock} events={categorized.previous} now={now} onSelect={openDetail} defaultOpen={false} accent="bg-muted-foreground" />
              <SidebarSection label={t("calendar_cancelled")} icon={X} events={categorized.cancelled} now={now} onSelect={openDetail} defaultOpen={false} accent="bg-red-400" />

              {/* Empty state */}
              {allEvents.length === 0 && (
                <div className="text-center py-12">
                  <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-4">
                    <Calendar className="w-8 h-8 text-muted-foreground/40" />
                  </div>
                  <p className="text-sm font-medium text-muted-foreground">{t("no_events_yet")}</p>
                  <p className="text-xs text-muted-foreground/70 mt-1">{t("create_first_event")}</p>
                  <Button variant="outline" size="sm" className="mt-4" onClick={() => openCreate()}>
                    <Plus className="w-3.5 h-3.5 mr-1.5" />{t("create_first_event")}
                  </Button>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Mobile / tablet agenda */}
        <div className="xl:hidden shrink-0 border-t bg-card/50 max-h-[40vh] overflow-y-auto min-w-0">
          <div className="px-4 pt-3 pb-2 border-b flex items-center justify-between gap-2">
            <h3 className="text-sm font-bold">{t("today_schedule")}</h3>
            <span className="text-xs text-muted-foreground shrink-0">
              {today.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
            </span>
          </div>
          <div className="px-3 py-3">
            <TodayStrip events={allEvents} now={now} onSelect={openDetail} />
          </div>
        </div>
      </div>

      {/* ── Create / Edit Modal ── */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-lg">{editing ? t("edit_event") : t("create_event_title")}</DialogTitle>
          </DialogHeader>
          <EventForm
            initial={editing} defaultDate={defaultDate}
            onClose={() => setFormOpen(false)} onSaved={afterSave}
            users={users} groups={groups} departments={departments}
          />
        </DialogContent>
      </Dialog>

      {/* ── Detail Modal ── */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto">
          {viewing && (
            <EventDetail event={viewing}
              onClose={() => setDetailOpen(false)}
              onEdit={() => openEdit(viewing)}
              onDeleted={afterDelete}
              onRsvpDone={handleRsvpDone}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
