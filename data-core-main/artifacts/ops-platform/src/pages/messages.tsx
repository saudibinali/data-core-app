import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  useListMessages, useCreateMessage, useGetMessage, useUpdateMessage,
  useDeleteMessage, useReplyToMessage, useListUsers, useGetMe,
  useMarkNotificationRead,
  type MessageAttachment,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import RichEditor from "@/components/rich-editor";
import {
  Inbox, Send, FileText, Star, Archive, Trash2,
  Reply, Pin, AlertCircle, Plus, Search, RefreshCw,
  X, Circle, Mail, Paperclip, FileIcon, ImageIcon, FileVideo,
  FileAudio, Upload, Pencil,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";

// ─── Attachment helpers ───────────────────────────────────────────────────────

interface AttachedFile {
  id: string;
  file: File;
  previewUrl?: string;
}

interface StoredAttachment {
  id: string;
  name: string;
  size: number;
  type: string;
  data: string; // base64
}

function fileIcon(type: string, size?: string) {
  const cls = size ?? "w-3.5 h-3.5";
  if (type.startsWith("image/")) return <ImageIcon className={`${cls} text-blue-500`} />;
  if (type.startsWith("video/")) return <FileVideo className={`${cls} text-purple-500`} />;
  if (type.startsWith("audio/")) return <FileAudio className={`${cls} text-green-500`} />;
  return <FileIcon className={`${cls} text-muted-foreground`} />;
}

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function attachedFilesToStored(files: AttachedFile[]): Promise<StoredAttachment[]> {
  return Promise.all(
    files.map(async (f) => ({
      id: f.id,
      name: f.file.name,
      size: f.file.size,
      type: f.file.type || "application/octet-stream",
      data: await fileToBase64(f.file),
    }))
  );
}

// ─── Attachment Display (read-only, shown in email detail pane) ───────────────

function AttachmentsDisplay({ attachments }: { attachments: MessageAttachment[] }) {
  const { t } = useTranslation();
  if (!attachments || attachments.length === 0) return null;

  const downloadAttachment = (att: MessageAttachment) => {
    const mime = att.type || "application/octet-stream";
    const byteChars = atob(att.data);
    const byteNums = new Array(byteChars.length).fill(0).map((_, i) => byteChars.charCodeAt(i));
    const blob = new Blob([new Uint8Array(byteNums)], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = att.name; a.click();
    URL.revokeObjectURL(url);
  };

  const isImage = (type: string) => type.startsWith("image/");

  return (
    <div className="px-6 py-3 border-b bg-muted/10">
      <div className="flex items-center gap-1.5 mb-2">
        <Paperclip className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          {attachments.length > 1
            ? t("attachments_count_plural", { count: attachments.length })
            : t("attachments_count", { count: attachments.length })}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {attachments.map((att) => (
          <button
            key={att.id}
            onClick={() => downloadAttachment(att)}
            title={`Download ${att.name}`}
            className="group flex items-center gap-2 border rounded-lg bg-background hover:bg-accent hover:border-primary/40 transition-all px-3 py-2 max-w-[220px] text-left"
          >
            {isImage(att.type) ? (
              <img
                src={`data:${att.type};base64,${att.data}`}
                className="w-8 h-8 rounded object-cover shrink-0 border"
                alt={att.name}
              />
            ) : (
              <span className="w-8 h-8 rounded bg-muted flex items-center justify-center shrink-0">
                {fileIcon(att.type, "w-4 h-4")}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium truncate group-hover:text-primary transition-colors">{att.name}</p>
              <p className="text-[11px] text-muted-foreground">{formatBytes(att.size)}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function AttachmentsBar({ files, onAdd, onRemove }: {
  files: AttachedFile[];
  onAdd: (f: AttachedFile[]) => void;
  onRemove: (id: string) => void;
}) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const handleFiles = useCallback((raw: FileList | null) => {
    if (!raw) return;
    const newFiles: AttachedFile[] = Array.from(raw).map(f => ({
      id: `${Date.now()}-${Math.random()}`,
      file: f,
      previewUrl: f.type.startsWith("image/") ? URL.createObjectURL(f) : undefined,
    }));
    onAdd(newFiles);
  }, [onAdd]);

  return (
    <div
      onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={e => { e.preventDefault(); setIsDragOver(false); handleFiles(e.dataTransfer.files); }}
      className={cn(
        "border-t px-3 py-2 flex flex-wrap items-center gap-2 transition-colors",
        isDragOver ? "bg-primary/5 border-primary" : "bg-muted/10"
      )}
    >
      <input ref={inputRef} type="file" multiple accept="*/*" className="hidden" onChange={e => handleFiles(e.target.files)} />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-0.5"
      >
        <Paperclip className="w-3.5 h-3.5" />
        {t("attach_files")}
      </button>

      {files.length > 0 && (
        <>
          <div className="w-px h-4 bg-border" />
          {files.map(f => (
            <div key={f.id} className="flex items-center gap-1.5 bg-background border rounded-md px-2 py-1 text-xs max-w-[200px]">
              {f.previewUrl ? (
                <img src={f.previewUrl} className="w-4 h-4 rounded object-cover shrink-0" alt="" />
              ) : fileIcon(f.file.type)}
              <span className="truncate flex-1 max-w-[120px]">{f.file.name}</span>
              <span className="text-muted-foreground shrink-0">{formatBytes(f.file.size)}</span>
              <button onClick={() => onRemove(f.id)} className="shrink-0 text-muted-foreground hover:text-destructive ml-0.5">
                <X className="w-2.5 h-2.5" />
              </button>
            </div>
          ))}
        </>
      )}

      {isDragOver && (
        <span className="flex items-center gap-1 text-xs text-primary font-medium ms-auto">
          <Upload className="w-3 h-3" /> {t("drop_files_here")}
        </span>
      )}
    </div>
  );
}

type Folder = "inbox" | "sent" | "drafts" | "important" | "archived";
type View = "none" | "email" | "compose" | "reply" | "edit-draft";

// ─── Inline Compose Pane ──────────────────────────────────────────────────────

function RecipientField({ label, input, setInput, userIds, onAdd, onRemove, suggestions, getUserName }: {
  label: string; input: string; setInput: (v: string) => void;
  userIds: number[]; type: "to" | "cc";
  onAdd: (id: number) => void; onRemove: (id: number) => void;
  suggestions: any[]; getUserName: (id: number) => string;
}) {
  return (
    <div className="flex items-start border-b px-4 py-2 gap-3 min-h-[40px]">
      <span className="text-sm font-medium text-muted-foreground w-8 pt-1.5 shrink-0">{label}</span>
      <div className="flex-1 flex flex-wrap gap-1.5 items-center">
        {userIds.map(id => (
          <Badge key={id} variant="secondary" className="gap-1 pe-1 h-6 text-xs font-normal">
            {getUserName(id)}
            <button onClick={() => onRemove(id)} className="hover:text-destructive ml-0.5">
              <X className="w-2.5 h-2.5" />
            </button>
          </Badge>
        ))}
        <div className="relative flex-1 min-w-28">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder={userIds.length === 0 ? "Search people..." : "Add more..."}
            className="w-full text-sm bg-transparent outline-none placeholder:text-muted-foreground/50 py-1"
          />
          {suggestions.length > 0 && (
            <div className="absolute top-full left-0 mt-1 w-64 bg-popover border rounded-lg shadow-lg z-50 overflow-hidden">
              {suggestions.map((u: any) => (
                <button key={u.id} onClick={() => onAdd(u.id)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-center gap-2.5 transition-colors">
                  <img src={u.avatarUrl || `https://api.dicebear.com/7.x/initials/svg?seed=${u.fullName}`}
                    className="w-7 h-7 rounded-full border shrink-0" alt="" />
                  <div className="min-w-0">
                    <p className="font-medium truncate">{u.fullName}</p>
                    <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

type EditingDraft = { id: number; subject: string; body: string; toUserIds: number[]; ccUserIds: number[] };

function InlineComposePan({ onDiscard, replyTo, editingDraft }: {
  onDiscard: () => void;
  replyTo?: { id: number; subject: string; recipientIds: number[] } | null;
  editingDraft?: EditingDraft | null;
}) {
  const { t } = useTranslation();
  const [subject, setSubject] = useState(
    replyTo ? `Re: ${replyTo.subject}` : (editingDraft?.subject ?? "")
  );
  const [body, setBody] = useState(editingDraft?.body ?? "");
  const [toInput, setToInput] = useState("");
  const [ccInput, setCcInput] = useState("");
  const [toUserIds, setToUserIds] = useState<number[]>(
    replyTo?.recipientIds ?? (editingDraft?.toUserIds ?? [])
  );
  const [ccUserIds, setCcUserIds] = useState<number[]>(editingDraft?.ccUserIds ?? []);
  const [isImportant, setIsImportant] = useState(false);
  const [attachments, setAttachments] = useState<AttachedFile[]>([]);

  const { data: allUsers } = useListUsers({});
  const createMessage = useCreateMessage();
  const updateMessage = useUpdateMessage();
  const replyMutation = useReplyToMessage();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const getSuggestions = (input: string) =>
    !input.trim() ? [] : (allUsers ?? [])
      .filter(u =>
        u.fullName.toLowerCase().includes(input.toLowerCase()) ||
        (u.email ?? "").toLowerCase().includes(input.toLowerCase())
      ).slice(0, 6);

  const getUserName = (id: number) => allUsers?.find(u => u.id === id)?.fullName ?? `User #${id}`;

  const addTo = (id: number) => { setToUserIds(ids => ids.includes(id) ? ids : [...ids, id]); setToInput(""); };
  const addCc = (id: number) => { setCcUserIds(ids => ids.includes(id) ? ids : [...ids, id]); setCcInput(""); };
  const removeTo = (id: number) => setToUserIds(ids => ids.filter(i => i !== id));
  const removeCc = (id: number) => setCcUserIds(ids => ids.filter(i => i !== id));

  const isBodyEmpty = !body || body === "<p></p>" || body.trim() === "";

  const handleSend = async (status: "sent" | "draft" = "sent") => {
    const bodyText = body;
    let storedAttachments: Awaited<ReturnType<typeof attachedFilesToStored>> = [];
    try {
      storedAttachments = await attachedFilesToStored(attachments);
    } catch {
      toast({ title: t("failed_read_attach"), description: t("failed_read_attach_desc"), variant: "destructive" });
      return;
    }

    // ── Editing an existing draft ──────────────────────────────────────────────
    if (editingDraft) {
      updateMessage.mutate({
        id: editingDraft.id,
        data: { status, subject: subject || t("no_subject"), body: bodyText, toUserIds, ccUserIds, attachments: storedAttachments } as any,
      }, {
        onSuccess: () => {
          toast({ title: status === "sent" ? t("draft_sent") : t("draft_saved") });
          queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
          onDiscard();
        },
        onError: (e: any) => toast({ title: t("error"), description: e?.response?.data?.error, variant: "destructive" }),
      });
      return;
    }

    // ── Replying ───────────────────────────────────────────────────────────────
    if (replyTo) {
      replyMutation.mutate({ id: replyTo.id, data: { body: bodyText, attachments: storedAttachments } }, {
        onSuccess: () => {
          toast({ title: t("reply_sent") });
          queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
          onDiscard();
        },
        onError: (e: any) => toast({ title: t("error"), description: e?.response?.data?.error, variant: "destructive" }),
      });
      return;
    }

    // ── New message ────────────────────────────────────────────────────────────
    createMessage.mutate({ data: { subject: subject || t("no_subject"), body: bodyText, toUserIds, ccUserIds, status, isImportant, attachments: storedAttachments } }, {
      onSuccess: () => {
        toast({ title: status === "sent" ? t("email_sent") : t("draft_saved") });
        queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
        onDiscard();
      },
      onError: (e: any) => toast({ title: t("error"), description: e?.response?.data?.error, variant: "destructive" }),
    });
  };

  const isPending = createMessage.isPending || replyMutation.isPending || updateMessage.isPending;

  const composerTitle = editingDraft
    ? t("edit_draft_title", { subject: editingDraft.subject || t("no_subject") })
    : replyTo
      ? t("reply_title", { subject: replyTo.subject })
      : t("compose_title");

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header bar */}
      <div className="flex items-center gap-2 px-4 h-11 border-b bg-muted/20 shrink-0">
        <h2 className="text-sm font-semibold flex-1 text-foreground">{composerTitle}</h2>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className={cn("h-7 w-7", isImportant && "text-amber-500")}
              onClick={() => setIsImportant(v => !v)}>
              <AlertCircle className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{isImportant ? t("remove_importance") : t("mark_important")}</TooltipContent>
        </Tooltip>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onDiscard}>
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Recipient fields */}
      <div className="shrink-0 bg-background">
        <RecipientField label="To" input={toInput} setInput={setToInput} type="to"
          userIds={toUserIds} onAdd={addTo} onRemove={removeTo}
          suggestions={getSuggestions(toInput)} getUserName={getUserName} />
        <RecipientField label="Cc" input={ccInput} setInput={setCcInput} type="cc"
          userIds={ccUserIds} onAdd={addCc} onRemove={removeCc}
          suggestions={getSuggestions(ccInput)} getUserName={getUserName} />
        {!replyTo && (
          <div className="flex items-center border-b px-4 py-2 gap-3">
            <span className="text-sm font-medium text-muted-foreground w-8 shrink-0">Subj</span>
            <input
              value={subject} onChange={e => setSubject(e.target.value)}
              placeholder={t("subject_placeholder")}
              className="flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground/50 py-1"
            />
          </div>
        )}
      </div>

      {/* Rich text editor - fills remaining space */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <RichEditor
          key={editingDraft?.id ?? "new"}
          value={editingDraft?.body}
          onChange={setBody}
          placeholder={replyTo ? t("write_reply") : t("write_email")}
          className="flex-1 border-0 rounded-none"
          toolbar="full"
          autoFocus
        />
        {/* Attachments bar */}
        <AttachmentsBar
          files={attachments}
          onAdd={newFiles => setAttachments(prev => [...prev, ...newFiles])}
          onRemove={id => setAttachments(prev => prev.filter(f => f.id !== id))}
        />
      </div>

      {/* Send / action bar */}
      <div className="shrink-0 border-t px-4 py-3 flex items-center gap-2 bg-muted/5">
        <Button
          onClick={() => handleSend("sent")}
          disabled={isPending || isBodyEmpty}
          className="gap-1.5 shadow-sm"
        >
          <Send className="w-4 h-4" />
          {isPending ? t("sending_btn") : t("send_btn")}
        </Button>
        {!replyTo && (
          <Button
            variant="outline"
            onClick={() => handleSend("draft")}
            disabled={isPending || isBodyEmpty}
            className="gap-1.5"
          >
            <FileText className="w-4 h-4" />
            {t("save_draft")}
          </Button>
        )}
        <div className="flex-1" />
        <Button variant="ghost" size="sm" className="text-muted-foreground gap-1.5 text-xs" onClick={onDiscard}>
          <Trash2 className="w-3.5 h-3.5" /> {t("discard")}
        </Button>
      </div>
    </div>
  );
}

// ─── Email Detail Pane ────────────────────────────────────────────────────────

function EmailDetailPane({ emailId, onClose, onArchive, onDelete, onReply, onEditDraft }: {
  emailId: number;
  onClose: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onReply: (replyTo: { id: number; subject: string; recipientIds: number[] }) => void;
  onEditDraft: (draft: EditingDraft) => void;
}) {
  const { t } = useTranslation();
  const [quickReplyBody, setQuickReplyBody] = useState("");
  const { data: me } = useGetMe();
  const { data: msg, isLoading } = useGetMessage(emailId, {
    query: { queryKey: ["/api/messages", emailId], staleTime: 0 }
  });
  const updateMessage = useUpdateMessage();
  const replyMutation = useReplyToMessage();
  const deleteMutation = useDeleteMessage();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/messages"] });

  const handleArchive = () => {
    updateMessage.mutate({ id: emailId, data: { isArchivedByRecipient: true } as any }, {
      onSuccess: () => { invalidate(); onArchive(); toast({ title: t("archived_msg") }); }
    });
  };
  const handleDelete = () => {
    deleteMutation.mutate({ id: emailId }, {
      onSuccess: () => { invalidate(); onDelete(); toast({ title: t("deleted_msg") }); }
    });
  };
  const handleTogglePin = () =>
    updateMessage.mutate({ id: emailId, data: { isPinned: !msg?.isPinned } as any }, { onSuccess: invalidate });
  const handleToggleImportant = () =>
    updateMessage.mutate({ id: emailId, data: { isImportant: !msg?.isImportant } as any }, { onSuccess: invalidate });

  const handleQuickReply = () => {
    if (!quickReplyBody.trim()) return;
    replyMutation.mutate({ id: emailId, data: { body: quickReplyBody } }, {
      onSuccess: () => { setQuickReplyBody(""); invalidate(); toast({ title: t("reply_sent") }); },
      onError: (e: any) => toast({ title: t("error"), description: e?.response?.data?.error, variant: "destructive" }),
    });
  };

  if (isLoading) return (
    <div className="flex-1 flex items-center justify-center h-full">
      <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );
  if (!msg) return null;

  const toRecipients = (msg.recipients ?? []).filter(r => r.recipientType === "to");
  const ccRecipients = (msg.recipients ?? []).filter(r => r.recipientType === "cc");
  const isDraft = msg.status === "draft";

  const handleSendDraft = () => {
    updateMessage.mutate({ id: emailId, data: { status: "sent" } as any }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
        toast({ title: "Draft sent" });
        onDelete();
      },
      onError: (e: any) => toast({ title: "Error", description: e?.response?.data?.error, variant: "destructive" }),
    });
  };

  const handleOpenEditDraft = () => {
    onEditDraft({
      id: emailId,
      subject: msg.subject,
      body: msg.body ?? "",
      toUserIds: toRecipients.map(r => r.userId),
      ccUserIds: ccRecipients.map(r => r.userId),
    });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-3 py-2 border-b bg-muted/20 shrink-0">
        {isDraft ? (
          <>
            <Tooltip><TooltipTrigger asChild>
              <Button variant="default" size="sm" className="gap-1.5 h-8" onClick={handleSendDraft} disabled={updateMessage.isPending}>
                <Send className="w-3.5 h-3.5" /> {t("send_draft_btn")}
              </Button>
            </TooltipTrigger><TooltipContent>{t("send_draft_tooltip")}</TooltipContent></Tooltip>

            <Tooltip><TooltipTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5 h-8" onClick={handleOpenEditDraft}>
                <Pencil className="w-3.5 h-3.5" /> {t("edit_draft_btn")}
              </Button>
            </TooltipTrigger><TooltipContent>{t("edit_draft_tooltip")}</TooltipContent></Tooltip>
          </>
        ) : (
          <Tooltip><TooltipTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1.5 h-8" onClick={() => {
              const myId = me?.id;
              const replyIds = [...new Set([msg.senderId, ...toRecipients.map(r => r.userId)])].filter(id => id !== myId);
              onReply({ id: emailId, subject: msg.subject, recipientIds: replyIds });
            }}>
              <Reply className="w-3.5 h-3.5" /> {t("reply_btn")}
            </Button>
          </TooltipTrigger><TooltipContent>{t("reply")}</TooltipContent></Tooltip>
        )}

        <Separator orientation="vertical" className="h-5 mx-1" />

        <Tooltip><TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className={cn("h-8 w-8", msg.isPinned && "text-primary")} onClick={handleTogglePin}>
            <Pin className="w-4 h-4" />
          </Button>
        </TooltipTrigger><TooltipContent>{msg.isPinned ? t("unpin_msg") : t("pin_msg")}</TooltipContent></Tooltip>

        <Tooltip><TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className={cn("h-8 w-8", msg.isImportant && "text-amber-500")} onClick={handleToggleImportant}>
            <AlertCircle className="w-4 h-4" />
          </Button>
        </TooltipTrigger><TooltipContent>{msg.isImportant ? t("remove_importance") : t("mark_important_short")}</TooltipContent></Tooltip>

        {!isDraft && (
          <Tooltip><TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleArchive}>
              <Archive className="w-4 h-4" />
            </Button>
          </TooltipTrigger><TooltipContent>{t("archive")}</TooltipContent></Tooltip>
        )}

        <Tooltip><TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={handleDelete}>
            <Trash2 className="w-4 h-4" />
          </Button>
        </TooltipTrigger><TooltipContent>{t("delete")}</TooltipContent></Tooltip>

        <div className="flex-1" />
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Email content */}
      <div className="flex-1 overflow-y-auto">
        {/* Header */}
        <div className="px-6 pt-5 pb-4">
          <div className="flex items-start gap-2 mb-4">
            <h2 className="text-xl font-semibold flex-1 leading-tight">{msg.subject}</h2>
            <div className="flex gap-1 shrink-0 mt-0.5">
              {msg.isPinned && <Badge variant="outline" className="text-xs gap-1"><Pin className="w-3 h-3" /> {t("pinned_badge")}</Badge>}
              {msg.isImportant && <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-xs gap-1"><AlertCircle className="w-3 h-3" /> {t("important_badge")}</Badge>}
            </div>
          </div>

          <div className="flex items-start gap-3">
            <img
              src={msg.senderAvatar || `https://api.dicebear.com/7.x/initials/svg?seed=${msg.senderName}`}
              className="w-10 h-10 rounded-full border shrink-0"
              alt={msg.senderName}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="font-semibold text-sm">{msg.senderName}</span>
                <span className="text-xs text-muted-foreground">{format(new Date(msg.createdAt), "dd MMM yyyy, HH:mm")}</span>
              </div>
              {toRecipients.length > 0 && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  <span className="font-medium">{t("to_label")}:</span> {toRecipients.map(r => r.fullName).join(", ")}
                </p>
              )}
              {ccRecipients.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium">{t("cc_label")}:</span> {ccRecipients.map(r => r.fullName).join(", ")}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Attachments - shown at top, before body */}
        <AttachmentsDisplay attachments={msg.attachments ?? []} />

        <Separator />

        {/* Body */}
        <div className="px-6 py-5">
          <div
            className="text-sm leading-relaxed text-foreground prose prose-sm dark:prose-invert max-w-none"
            dangerouslySetInnerHTML={{ __html: msg.body }}
          />
        </div>

        {/* Thread replies */}
        {(msg.replies ?? []).length > 0 && (
          <div className="px-6 pb-4">
            <Separator className="mb-4" />
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              {msg.replies!.length === 1 ? t("reply_count_one") : t("replies_count", { count: msg.replies!.length })}
            </p>
            <div className="space-y-3">
              {(msg.replies ?? []).map((reply) => (
                <div key={reply.id} className="flex gap-3">
                  <img
                    src={reply.senderAvatar || `https://api.dicebear.com/7.x/initials/svg?seed=${reply.senderName}`}
                    className="w-8 h-8 rounded-full border shrink-0 mt-0.5"
                    alt={reply.senderName}
                  />
                  <div className="flex-1 border rounded-lg overflow-hidden bg-muted/20">
                    <div className="px-3 pt-3 pb-2">
                      <div className="flex items-baseline gap-2 mb-1.5">
                        <span className="text-sm font-medium">{reply.senderName}</span>
                        <span className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(reply.createdAt), { addSuffix: true })}</span>
                      </div>
                      <div
                        className="text-sm leading-relaxed prose prose-sm dark:prose-invert max-w-none"
                        dangerouslySetInnerHTML={{ __html: reply.body }}
                      />
                    </div>
                    {(reply.attachments ?? []).length > 0 && (
                      <AttachmentsDisplay attachments={reply.attachments ?? []} />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Quick reply */}
        <div className="px-6 pb-6 mt-2">
          <Separator className="mb-4" />
          <div className="border rounded-lg overflow-hidden shadow-sm">
            <div className="px-3 py-2 border-b bg-muted/20 flex items-center gap-2">
              <Reply className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground font-medium">{t("quick_reply")}</span>
              <div className="flex-1" />
              <button
                className="text-xs text-primary hover:underline"
                onClick={() => {
                  const myId = me?.id;
                  const replyIds = [...new Set([msg.senderId, ...toRecipients.map(r => r.userId)])].filter(id => id !== myId);
                  onReply({ id: emailId, subject: msg.subject, recipientIds: replyIds });
                }}
              >
                {t("full_reply")}
              </button>
            </div>
            <Textarea
              value={quickReplyBody} onChange={e => setQuickReplyBody(e.target.value)}
              placeholder={t("write_quick_reply")}
              className="border-0 rounded-none resize-none min-h-[80px] text-sm focus-visible:ring-0 shadow-none"
            />
            <div className="flex items-center justify-end px-3 py-2 bg-muted/10 border-t">
              <Button size="sm" disabled={!quickReplyBody.trim() || replyMutation.isPending} onClick={handleQuickReply} className="gap-1.5">
                <Send className="w-3.5 h-3.5" />
                {replyMutation.isPending ? t("sending_btn") : t("reply_btn")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Email Row ────────────────────────────────────────────────────────────────

function EmailRow({ msg, isSelected, onClick, folder }: {
  msg: any; isSelected: boolean; onClick: () => void; folder: Folder;
}) {
  const { t } = useTranslation();
  const isUnread = !msg.isRead && folder !== "sent" && folder !== "drafts";
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left px-4 py-3 border-b transition-colors flex gap-3 items-start",
        isSelected ? "bg-accent border-l-2 border-l-primary" : "hover:bg-accent/40",
        isUnread && !isSelected && "bg-primary/5"
      )}
    >
      <div className="shrink-0 mt-0.5">
        <img
          src={msg.senderAvatar || `https://api.dicebear.com/7.x/initials/svg?seed=${msg.senderName}`}
          className="w-8 h-8 rounded-full border" alt={msg.senderName}
        />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-1 mb-0.5">
          <span className={cn("text-sm truncate", isUnread ? "font-bold" : "font-medium")}>
            {folder === "sent"
              ? (msg.recipientPreview || "-")
              : folder === "drafts"
                ? (msg.senderName || "Draft")
                : msg.senderName}
          </span>
          <span className="text-[11px] text-muted-foreground shrink-0">
            {formatDistanceToNow(new Date(msg.createdAt), { addSuffix: true })}
          </span>
        </div>
        <div className={cn("text-xs truncate mb-0.5", isUnread ? "font-semibold text-foreground" : "text-foreground/80")}>
          {msg.subject || t("no_subject")}
        </div>
        <div className="text-xs text-muted-foreground truncate">{msg.bodyPreview}</div>
        <div className="flex items-center gap-1 mt-1">
          {msg.isPinned && <Pin className="w-3 h-3 text-primary" />}
          {msg.isImportant && <AlertCircle className="w-3 h-3 text-amber-500" />}
          {msg.attachments?.length > 0 && <Paperclip className="w-3 h-3 text-muted-foreground" />}
          {msg.replyCount > 0 && (
            <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
              {msg.replyCount === 1 ? t("reply_count_one") : t("replies_count", { count: msg.replyCount })}
            </Badge>
          )}
          {isUnread && <Circle className="w-2 h-2 fill-primary text-primary ms-auto" />}
        </div>
      </div>
    </button>
  );
}

// ─── Main Mail Page ───────────────────────────────────────────────────────────

export default function MailPage() {
  const { t } = useTranslation();
  const [folder, setFolder] = useState<Folder>("inbox");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [view, setView] = useState<View>("none");
  const [replyTo, setReplyTo] = useState<{ id: number; subject: string; recipientIds: number[] } | null>(null);
  const [editingDraft, setEditingDraft] = useState<EditingDraft | null>(null);
  const [search, setSearch] = useState("");

  // Auto-open compose if navigated with ?compose=true
  useEffect(() => {
    if (window.location.search.includes("compose=true")) {
      setView("compose");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const { data: emails, isLoading, refetch } = useListMessages({ folder } as any, {
    query: { queryKey: ["/api/messages", folder], refetchInterval: 15_000 },
  });
  const updateMessage = useUpdateMessage();
  const markNotifRead = useMarkNotificationRead();
  const queryClient = useQueryClient();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/messages"] });

  // Auto-dismiss message-type notifications from the cache when a message is opened
  const dismissMessageNotifications = () => {
    const cached = queryClient.getQueryData<any[]>(["/api/notifications"]) ?? [];
    const unread = cached.filter(n => !n.isRead && (n.type === "mail" || n.type === "message"));
    for (const notif of unread) {
      markNotifRead.mutate({ id: notif.id }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
          queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
        },
      });
    }
  };

  const filtered = (emails ?? []).filter(m =>
    !search || m.subject.toLowerCase().includes(search.toLowerCase()) ||
    m.senderName.toLowerCase().includes(search.toLowerCase()) ||
    m.bodyPreview.toLowerCase().includes(search.toLowerCase())
  );

  const unreadInbox = (folder === "inbox" ? filtered : (emails ?? [])).filter(m => !m.isRead).length;

  const folders: { id: Folder; label: string; icon: React.ComponentType<any>; badge?: number }[] = [
    { id: "inbox", label: t("mail_inbox"), icon: Inbox, badge: unreadInbox || undefined },
    { id: "sent", label: t("mail_sent"), icon: Send },
    { id: "drafts", label: t("mail_drafts"), icon: FileText, badge: folder === "drafts" ? (emails ?? []).length || undefined : undefined },
    { id: "important", label: t("mail_important"), icon: Star },
    { id: "archived", label: t("mail_archived"), icon: Archive },
  ];

  const handleSelectEmail = (id: number) => {
    setSelectedId(id);
    setView("email");
    const msg = (emails ?? []).find(m => m.id === id);
    if (msg && !msg.isRead && folder === "inbox") {
      updateMessage.mutate({ id, data: { isRead: true } as any }, { onSuccess: invalidate });
    }
    // Clear any unread message-type notifications so the bell badge updates immediately
    dismissMessageNotifications();
  };

  const handleCompose = () => {
    setSelectedId(null);
    setReplyTo(null);
    setEditingDraft(null);
    setView("compose");
  };

  const handleReply = (rt: { id: number; subject: string; recipientIds: number[] }) => {
    setReplyTo(rt);
    setEditingDraft(null);
    setView("reply");
  };

  const handleEditDraft = (draft: EditingDraft) => {
    setReplyTo(null);
    setEditingDraft(draft);
    setView("edit-draft");
  };

  const handleDiscard = () => {
    setEditingDraft(null);
    setReplyTo(null);
    setView(selectedId ? "email" : "none");
  };

  const showComposePan = view === "compose" || view === "reply" || view === "edit-draft";
  const mobileShowDetail = showComposePan || (view === "email" && !!selectedId);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col lg:flex-row overflow-hidden select-none">
      {/* ── Folder sidebar (desktop) ───────────────────────── */}
      <div className="hidden lg:flex w-48 border-e flex-col shrink-0 bg-muted/10">
        {/* New E-mail button */}
        <div className="p-3 border-b">
          <Button onClick={handleCompose} className="w-full gap-2 justify-start" size="sm">
            <Plus className="w-4 h-4" />
            {t("new_email_btn")}
          </Button>
        </div>

        {/* Folders */}
        <nav className="flex-1 p-2 space-y-0.5">
          {folders.map(f => (
            <button
              key={f.id}
              onClick={() => { setFolder(f.id); setSelectedId(null); setView("none"); }}
              className={cn(
                "w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                folder === f.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
              )}
            >
              <f.icon className="w-4 h-4 shrink-0" />
              <span className="flex-1 text-start">{f.label}</span>
              {f.badge ? (
                <span className={cn(
                  "text-[11px] font-bold min-w-[18px] h-[18px] flex items-center justify-center rounded-full px-1",
                  folder === f.id ? "bg-primary-foreground/20 text-primary-foreground" : "bg-primary text-primary-foreground"
                )}>{f.badge}</span>
              ) : null}
            </button>
          ))}
        </nav>
      </div>

      {/* ── Folder chips (mobile / tablet) ───────────────────── */}
      <div className="lg:hidden shrink-0 border-b bg-muted/10 flex gap-1 overflow-x-auto p-2">
        {folders.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => {
              setFolder(f.id);
              setSelectedId(null);
              setView("none");
            }}
            className={cn(
              "shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
              folder === f.id
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            <f.icon className="w-3.5 h-3.5" />
            <span>{f.label}</span>
            {f.badge ? (
              <span className="text-[10px] font-bold min-w-[16px] h-4 flex items-center justify-center rounded-full px-1 bg-primary-foreground/20">
                {f.badge}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {/* ── Email list ────────────────────────────────────────── */}
      <div
        className={cn(
          "border-e flex flex-col shrink-0 min-h-0 min-w-0 w-full lg:w-72",
          mobileShowDetail && "hidden lg:flex",
        )}
      >
        {/* Search */}
        <div className="p-2 border-b bg-background">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder={t("search_placeholder")} className="ps-8 h-8 text-sm"
            />
          </div>
        </div>

        {/* Folder label */}
        <div className="px-4 py-2 border-b flex items-center justify-between bg-muted/10">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider capitalize">{folder}</span>
          <button onClick={() => refetch()} className="text-muted-foreground hover:text-foreground transition-colors">
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-2 px-4 text-center">
              <Inbox className="w-8 h-8 opacity-25" />
              <p className="text-sm">{search ? t("no_results_found") : folder === "inbox" ? t("inbox_empty") : t("no_email_folder", { folder })}</p>
            </div>
          ) : filtered.map(email => (
            <EmailRow
              key={email.id}
              msg={email}
              isSelected={selectedId === email.id}
              onClick={() => handleSelectEmail(email.id)}
              folder={folder}
            />
          ))}
        </div>
      </div>

      {/* ── Reading / Compose pane ──────────────────────────── */}
      <div
        className={cn(
          "flex-1 min-w-0 overflow-hidden",
          !mobileShowDetail && "hidden lg:flex",
        )}
      >
        {showComposePan ? (
          <InlineComposePan
            key={view === "reply" ? `reply-${replyTo?.id}` : view === "edit-draft" ? `draft-${editingDraft?.id}` : "compose"}
            onDiscard={handleDiscard}
            replyTo={view === "reply" ? replyTo : null}
            editingDraft={view === "edit-draft" ? editingDraft : null}
          />
        ) : view === "email" && selectedId ? (
          <EmailDetailPane
            key={selectedId}
            emailId={selectedId}
            onClose={() => { setSelectedId(null); setView("none"); }}
            onArchive={() => { setSelectedId(null); setView("none"); }}
            onDelete={() => { setSelectedId(null); setView("none"); }}
            onReply={handleReply}
            onEditDraft={handleEditDraft}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-4">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
              <Mail className="w-8 h-8 opacity-30" />
            </div>
            <div className="text-center">
              <p className="font-semibold text-foreground">{t("no_email_selected")}</p>
              <p className="text-sm mt-0.5 text-muted-foreground">{t("no_email_desc")}</p>
            </div>
            <Button onClick={handleCompose} variant="outline" size="sm" className="gap-1.5 mt-1">
              <Plus className="w-4 h-4" /> {t("new_email_btn")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
