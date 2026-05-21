import { useTranslation } from "react-i18next";
import { useListUsers, useListDepartments } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, Info } from "lucide-react";
import {
  type EventFieldDef,
  type EventSchema,
  type Operator,
  OPERATOR_LABELS,
} from "./event-field-types";

// ── Condition data shapes ─────────────────────────────────────────────────────

export interface ConditionRule {
  field: string;
  operator: Operator;
  value: string;         // always stored as string; engine coerces
}

export interface ConditionGroup {
  logic: "and" | "or";
  conditions: ConditionRule[];
}

// ── Single rule row ───────────────────────────────────────────────────────────

function RuleValueInput({
  field,
  operator,
  value,
  onChange,
  isAr,
}: {
  field: EventFieldDef;
  operator: Operator;
  value: string;
  onChange: (v: string) => void;
  isAr: boolean;
}) {
  const { data: users   } = useListUsers();
  const { data: departments } = useListDepartments();

  // multi-select operators expect comma-separated values
  const isMulti = operator === "in" || operator === "not_in";

  // ── enum ──────────────────────────────────────────────────────────────────
  if (field.type === "enum" && field.enumValues) {
    if (isMulti) {
      // render a compact multi-badge toggle
      const selected = value ? value.split(",") : [];
      const toggle = (v: string) => {
        const next = selected.includes(v)
          ? selected.filter((x) => x !== v)
          : [...selected, v];
        onChange(next.join(","));
      };
      return (
        <div className="flex flex-wrap gap-1 flex-1">
          {field.enumValues.map((ev) => (
            <button
              key={ev.value}
              type="button"
              onClick={() => toggle(ev.value)}
              className={`px-2 py-0.5 rounded text-[11px] border transition-colors ${
                selected.includes(ev.value)
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:border-primary/50"
              }`}
            >
              {isAr ? ev.labelAr : ev.label}
            </button>
          ))}
        </div>
      );
    }
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-7 text-xs flex-1">
          <SelectValue placeholder={isAr ? "اختر قيمة" : "Select value"} />
        </SelectTrigger>
        <SelectContent>
          {field.enumValues.map((ev) => (
            <SelectItem key={ev.value} value={ev.value} className="text-xs">
              {isAr ? ev.labelAr : ev.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  // ── boolean ───────────────────────────────────────────────────────────────
  if (field.type === "boolean") {
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-7 text-xs flex-1">
          <SelectValue placeholder={isAr ? "اختر" : "Select"} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="true"  className="text-xs">{isAr ? "نعم" : "Yes"}</SelectItem>
          <SelectItem value="false" className="text-xs">{isAr ? "لا"  : "No"}</SelectItem>
        </SelectContent>
      </Select>
    );
  }

  // ── user ──────────────────────────────────────────────────────────────────
  if (field.type === "user") {
    const userList = Array.isArray(users) ? users : (users as { data?: unknown[] } | undefined)?.data ?? [];
    if (isMulti) {
      const selected = value ? value.split(",") : [];
      const toggle = (id: string) => {
        const next = selected.includes(id)
          ? selected.filter((x) => x !== id)
          : [...selected, id];
        onChange(next.join(","));
      };
      return (
        <div className="flex flex-wrap gap-1 flex-1 max-h-24 overflow-y-auto">
          {(userList as Array<{ id: number; fullName?: string; employeeNumber?: string }>).map((u) => (
            <button
              key={u.id}
              type="button"
              onClick={() => toggle(String(u.id))}
              className={`px-2 py-0.5 rounded text-[11px] border transition-colors ${
                selected.includes(String(u.id))
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:border-primary/50"
              }`}
            >
              {u.fullName ?? u.employeeNumber ?? `#${u.id}`}
            </button>
          ))}
        </div>
      );
    }
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-7 text-xs flex-1">
          <SelectValue placeholder={isAr ? "اختر مستخدماً" : "Select user"} />
        </SelectTrigger>
        <SelectContent>
          {(userList as Array<{ id: number; fullName?: string; employeeNumber?: string }>).map((u) => (
            <SelectItem key={u.id} value={String(u.id)} className="text-xs">
              {u.fullName ?? u.employeeNumber ?? `#${u.id}`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  // ── department ────────────────────────────────────────────────────────────
  if (field.type === "department") {
    const deptList = Array.isArray(departments)
      ? departments
      : (departments as { data?: unknown[] } | undefined)?.data ?? [];
    if (isMulti) {
      const selected = value ? value.split(",") : [];
      const toggle = (id: string) => {
        const next = selected.includes(id)
          ? selected.filter((x) => x !== id)
          : [...selected, id];
        onChange(next.join(","));
      };
      return (
        <div className="flex flex-wrap gap-1 flex-1">
          {(deptList as Array<{ id: number; name?: string }>).map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => toggle(String(d.id))}
              className={`px-2 py-0.5 rounded text-[11px] border transition-colors ${
                selected.includes(String(d.id))
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:border-primary/50"
              }`}
            >
              {d.name ?? `#${d.id}`}
            </button>
          ))}
        </div>
      );
    }
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-7 text-xs flex-1">
          <SelectValue placeholder={isAr ? "اختر قسماً" : "Select department"} />
        </SelectTrigger>
        <SelectContent>
          {(deptList as Array<{ id: number; name?: string }>).map((d) => (
            <SelectItem key={d.id} value={String(d.id)} className="text-xs">
              {d.name ?? `#${d.id}`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  // ── date ──────────────────────────────────────────────────────────────────
  if (field.type === "date") {
    return (
      <Input
        type="date"
        className="h-7 text-xs flex-1"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  // ── number ────────────────────────────────────────────────────────────────
  if (field.type === "number") {
    return (
      <Input
        type="number"
        className="h-7 text-xs flex-1"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0"
      />
    );
  }

  // ── text (default) ────────────────────────────────────────────────────────
  return (
    <Input
      className="h-7 text-xs flex-1"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={isAr ? "القيمة" : "Value"}
    />
  );
}

// ── Rule row ──────────────────────────────────────────────────────────────────

function RuleRow({
  rule,
  fields,
  onChange,
  onRemove,
  isAr,
}: {
  rule: ConditionRule;
  fields: EventFieldDef[];
  onChange: (r: ConditionRule) => void;
  onRemove: () => void;
  isAr: boolean;
}) {
  const selectedField = fields.find((f) => f.name === rule.field) ?? null;

  function handleFieldChange(name: string) {
    const field = fields.find((f) => f.name === name);
    if (!field) return;
    onChange({ field: name, operator: field.operators[0]!, value: "" });
  }

  function handleOperatorChange(op: string) {
    onChange({ ...rule, operator: op as Operator, value: "" });
  }

  function handleValueChange(val: string) {
    onChange({ ...rule, value: val });
  }

  const isMulti = rule.operator === "in" || rule.operator === "not_in";
  const needsWrap = isMulti && selectedField && (
    selectedField.type === "enum" ||
    selectedField.type === "user" ||
    selectedField.type === "department"
  );

  return (
    <div className={`flex gap-1.5 ${needsWrap ? "flex-col" : "items-center"}`}>
      <div className={`flex gap-1.5 items-center ${needsWrap ? "" : "flex-1"}`}>
        {/* Field selector */}
        <Select value={rule.field} onValueChange={handleFieldChange}>
          <SelectTrigger className="h-7 text-xs w-40 shrink-0">
            <SelectValue placeholder={isAr ? "الحقل" : "Field"} />
          </SelectTrigger>
          <SelectContent>
            {fields.map((f) => (
              <SelectItem key={f.name} value={f.name} className="text-xs">
                <span className="flex items-center gap-1.5">
                  <FieldTypePill type={f.type} />
                  {isAr ? f.labelAr : f.label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Operator selector - only shown once field is selected */}
        {selectedField && (
          <Select value={rule.operator} onValueChange={handleOperatorChange}>
            <SelectTrigger className="h-7 text-xs w-32 shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {selectedField.operators.map((op) => (
                <SelectItem key={op} value={op} className="text-xs">
                  {isAr ? OPERATOR_LABELS[op].labelAr : OPERATOR_LABELS[op].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {!needsWrap && selectedField && (
          <RuleValueInput
            field={selectedField}
            operator={rule.operator}
            value={rule.value}
            onChange={handleValueChange}
            isAr={isAr}
          />
        )}

        <button
          type="button"
          onClick={onRemove}
          className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>

      {needsWrap && selectedField && (
        <div className="pl-[10.5rem]">
          <RuleValueInput
            field={selectedField}
            operator={rule.operator}
            value={rule.value}
            onChange={handleValueChange}
            isAr={isAr}
          />
        </div>
      )}
    </div>
  );
}

// ── Field type pill ───────────────────────────────────────────────────────────

const PILL_COLORS: Record<string, string> = {
  text:       "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  number:     "bg-blue-100  text-blue-700  dark:bg-blue-950  dark:text-blue-300",
  boolean:    "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  enum:       "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  user:       "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  department: "bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300",
  date:       "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
};

function FieldTypePill({ type }: { type: string }) {
  return (
    <span className={`inline-block px-1 py-0 rounded text-[9px] font-mono uppercase leading-4 ${PILL_COLORS[type] ?? PILL_COLORS["text"]}`}>
      {type}
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  schema: EventSchema | null;
  conditions: ConditionGroup;
  onChange: (c: ConditionGroup) => void;
}

export default function DynamicConditionBuilder({ schema, conditions, onChange }: Props) {
  const { i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");

  const fields = schema?.fields ?? [];
  const hasFields = fields.length > 0;

  function addRule() {
    if (!hasFields) return;
    const first = fields[0]!;
    onChange({
      ...conditions,
      conditions: [
        ...conditions.conditions,
        { field: first.name, operator: first.operators[0]!, value: "" },
      ],
    });
  }

  function updateRule(i: number, rule: ConditionRule) {
    const next = [...conditions.conditions];
    next[i] = rule;
    onChange({ ...conditions, conditions: next });
  }

  function removeRule(i: number) {
    onChange({
      ...conditions,
      conditions: conditions.conditions.filter((_, idx) => idx !== i),
    });
  }

  // ── No event selected yet ────────────────────────────────────────────────
  if (!schema) {
    return (
      <div className="flex items-center gap-2 py-3 px-3 rounded-md bg-muted/40 text-xs text-muted-foreground">
        <Info className="w-3.5 h-3.5 shrink-0" />
        {isAr
          ? "اختر حدث التشغيل أولاً لتظهر الحقول المتاحة"
          : "Select a trigger event above to see available condition fields"}
      </div>
    );
  }

  // ── Event selected but has no conditionable fields ───────────────────────
  if (!hasFields) {
    return (
      <div className="flex items-center gap-2 py-3 px-3 rounded-md bg-muted/40 text-xs text-muted-foreground">
        <Info className="w-3.5 h-3.5 shrink-0" />
        {isAr
          ? "لا توجد حقول متاحة للشروط لهذا الحدث"
          : "This event has no condition fields - workflow runs on every occurrence"}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Available fields legend */}
      <div className="flex flex-wrap gap-1.5">
        {fields.map((f) => (
          <span key={f.name} className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border border-border bg-muted/30">
            <FieldTypePill type={f.type} />
            <span className="font-mono text-[10px] text-muted-foreground">{f.name}</span>
            <span className="text-foreground/70">{isAr ? f.labelAr : f.label}</span>
          </span>
        ))}
      </div>

      {/* Logic toggle */}
      {conditions.conditions.length >= 2 && (
        <div className="flex items-center gap-2">
          <Label className="text-xs shrink-0">{isAr ? "ربط الشروط بـ" : "Match"}</Label>
          <div className="flex rounded-md border border-border overflow-hidden text-xs">
            {(["and", "or"] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => onChange({ ...conditions, logic: l })}
                className={`px-3 py-1 transition-colors ${
                  conditions.logic === l
                    ? "bg-primary text-primary-foreground"
                    : "bg-background text-muted-foreground hover:bg-muted"
                }`}
              >
                {l.toUpperCase()}
              </button>
            ))}
          </div>
          <span className="text-xs text-muted-foreground">
            {conditions.logic === "and"
              ? (isAr ? "- يجب تحقق جميع الشروط" : "- all conditions must match")
              : (isAr ? "- يكفي تحقق شرط واحد"   : "- any condition matches")}
          </span>
        </div>
      )}

      {/* Empty state */}
      {conditions.conditions.length === 0 && (
        <p className="text-xs text-muted-foreground italic">
          {isAr
            ? "لا توجد شروط - سيعمل سير العمل على كل حدث مطابق"
            : "No conditions - workflow runs on every matching event"}
        </p>
      )}

      {/* Rules */}
      <div className="space-y-2">
        {conditions.conditions.map((rule, i) => (
          <RuleRow
            key={i}
            rule={rule}
            fields={fields}
            onChange={(r) => updateRule(i, r)}
            onRemove={() => removeRule(i)}
            isAr={isAr}
          />
        ))}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 text-xs gap-1.5"
        onClick={addRule}
        disabled={!hasFields}
      >
        <Plus className="w-3 h-3" />
        {isAr ? "إضافة شرط" : "Add Condition"}
      </Button>
    </div>
  );
}
