import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { useCreateTicket, useListDepartments, useListUsers } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const ticketSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]),
  departmentId: z.coerce.number().optional(),
  assigneeUserId: z.coerce.number().optional(),
});

type TicketFormValues = z.infer<typeof ticketSchema>;

export default function NewTicketPage() {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  const createTicket = useCreateTicket();
  const { data: departments } = useListDepartments();
  const { data: users } = useListUsers({});

  const form = useForm<TicketFormValues>({
    resolver: zodResolver(ticketSchema),
    defaultValues: {
      title: "",
      description: "",
      priority: "medium",
    }
  });

  const onSubmit = (data: TicketFormValues) => {
    createTicket.mutate({
      data: {
        title: data.title,
        description: data.description,
        priority: data.priority,
        departmentId: data.departmentId,
        assigneeUserId: data.assigneeUserId,
      }
    }, {
      onSuccess: (ticket) => {
        toast({ title: t("ticket_created") });
        setLocation(`/tickets/${ticket.id}`);
      },
      onError: () => {
        toast({ title: t("ticket_create_failed"), variant: "destructive" });
      }
    });
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">{t("new_ticket_title")}</h2>
        <p className="text-muted-foreground">{t("new_ticket_subtitle")}</p>
      </div>

      <Card className="border-border shadow-sm">
        <CardContent className="p-6">
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t("ticket_title_label")}</label>
              <Input {...form.register("title")} placeholder={t("ticket_title_placeholder")} />
              {form.formState.errors.title && (
                <p className="text-xs text-destructive">{t("title_required")}</p>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">{t("ticket_desc_label")}</label>
              <Textarea 
                {...form.register("description")} 
                placeholder={t("ticket_desc_placeholder")}
                className="min-h-[150px]"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("ticket_priority_label")}</label>
                <Controller
                  control={form.control}
                  name="priority"
                  render={({ field }) => (
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <SelectTrigger>
                        <SelectValue placeholder={t("select_priority")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">{t("priority_low")}</SelectItem>
                        <SelectItem value="medium">{t("priority_medium")}</SelectItem>
                        <SelectItem value="high">{t("priority_high")}</SelectItem>
                        <SelectItem value="urgent">{t("priority_urgent")}</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">{t("ticket_dept_label")}</label>
                <Controller
                  control={form.control}
                  name="departmentId"
                  render={({ field }) => (
                    <Select onValueChange={field.onChange} value={field.value?.toString() || ""}>
                      <SelectTrigger>
                        <SelectValue placeholder={t("select_department")} />
                      </SelectTrigger>
                      <SelectContent>
                        {departments?.map(d => (
                          <SelectItem key={d.id} value={d.id.toString()}>{d.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">{t("ticket_assignee_optional")}</label>
              <Controller
                control={form.control}
                name="assigneeUserId"
                render={({ field }) => (
                  <Select onValueChange={field.onChange} value={field.value?.toString() || ""}>
                    <SelectTrigger>
                      <SelectValue placeholder={t("select_assignee")} />
                    </SelectTrigger>
                    <SelectContent>
                      {users?.map(u => (
                        <SelectItem key={u.id} value={u.id.toString()}>{u.fullName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="pt-4 flex justify-end gap-2 border-t">
              <Button type="button" variant="outline" onClick={() => setLocation("/tickets")}>
                {t("cancel")}
              </Button>
              <Button type="submit" disabled={createTicket.isPending}>
                {createTicket.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                {t("create_ticket_btn")}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
