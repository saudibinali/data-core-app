import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle, Color, FontFamily, FontSize as TiptapFontSize } from "@tiptap/extension-text-style";
import Highlight from "@tiptap/extension-highlight";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  Bold, Italic, Underline as UnderlineIcon, AlignLeft, AlignCenter,
  AlignRight, List, ListOrdered, Quote, Link2, Image as ImageIcon,
  Smile, Type, Strikethrough, Highlighter,
  Languages, Minus,
} from "lucide-react";

// ── Constants ─────────────────────────────────────────────────────────────────
const FONT_SIZES = ["12px", "14px", "16px", "18px", "20px", "24px", "28px", "32px"];
const FONT_FAMILIES = [
  { label: "Default", value: "inherit" },
  { label: "Arial", value: "Arial, sans-serif" },
  { label: "Times New Roman", value: "'Times New Roman', serif" },
  { label: "Courier", value: "'Courier New', monospace" },
  { label: "Arabic (Noto)", value: "'Noto Kufi Arabic', 'Segoe UI', sans-serif" },
  { label: "Tajawal", value: "'Tajawal', 'Segoe UI', sans-serif" },
];
const TEXT_COLORS = [
  "#000000", "#374151", "#dc2626", "#ea580c", "#ca8a04",
  "#16a34a", "#0284c7", "#7c3aed", "#db2777", "#6b7280",
  "#fca5a5", "#86efac", "#93c5fd", "#d8b4fe", "#fde68a",
  "#ffffff",
];
const HIGHLIGHT_COLORS = [
  "#fef08a", "#bbf7d0", "#bfdbfe", "#e9d5ff", "#fecaca",
  "#fed7aa", "#99f6e4", "#f0f9ff", "#fdf4ff", "#f0fdf4",
];
const EMOJIS = [
  "😊","👍","✅","❌","⚠️","📌","🔔","💡","📎","🗂️",
  "📝","🚀","🔥","💬","🎯","⭐","🙏","👋","🤝","💼",
  "📊","📈","🔒","🔓","📧","📞","🌐","⏰","✉️","📁",
];

// ── Sub-components ────────────────────────────────────────────────────────────

function ToolbarBtn({
  active, onClick, title, children, className,
}: {
  active?: boolean; onClick: () => void; title: string;
  children: React.ReactNode; className?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={e => { e.preventDefault(); onClick(); }}
      className={cn(
        "h-7 w-7 flex items-center justify-center rounded text-sm transition-colors",
        active ? "bg-primary text-primary-foreground" : "hover:bg-accent text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}

function ToolbarSelect({
  value, onChange, options, className,
}: {
  value: string; onChange: (v: string) => void;
  options: { label: string; value: string }[]; className?: string;
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      onMouseDown={e => e.stopPropagation()}
      className={cn(
        "h-7 rounded border bg-background text-xs px-1.5 cursor-pointer hover:border-primary transition-colors focus:outline-none focus:ring-1 focus:ring-primary",
        className,
      )}
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function ColorPicker({
  colors, value, onChange, icon, title,
}: {
  colors: string[]; value?: string; onChange: (c: string) => void;
  icon: React.ReactNode; title: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={title}
          className="h-7 px-1 flex flex-col items-center justify-center rounded hover:bg-accent transition-colors gap-0.5"
        >
          <span className="text-muted-foreground">{icon}</span>
          <span className="w-4 h-1 rounded-full" style={{ backgroundColor: value || "transparent", border: "1px solid #ccc" }} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2" align="start">
        <div className="grid grid-cols-8 gap-1">
          {colors.map(c => (
            <button
              key={c}
              type="button"
              title={c}
              onMouseDown={e => { e.preventDefault(); onChange(c); setOpen(false); }}
              className={cn("w-5 h-5 rounded border-2 transition-transform hover:scale-110",
                value === c ? "border-primary shadow-sm" : "border-transparent"
              )}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
        <div className="flex items-center gap-1 mt-2 border-t pt-2">
          <input
            type="color"
            defaultValue={value || "#000000"}
            onChange={e => onChange(e.target.value)}
            className="h-6 w-6 rounded cursor-pointer border-0 p-0"
          />
          <span className="text-xs text-muted-foreground">Custom</span>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function EmojiPicker({ onPick }: { onPick: (e: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" title="Emoji" className="h-7 w-7 flex items-center justify-center rounded text-sm hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">
          <Smile className="w-3.5 h-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2" align="start">
        <div className="grid grid-cols-10 gap-0.5">
          {EMOJIS.map(e => (
            <button
              key={e} type="button"
              onMouseDown={ev => { ev.preventDefault(); onPick(e); setOpen(false); }}
              className="w-8 h-8 text-lg hover:bg-accent rounded flex items-center justify-center transition-colors"
            >
              {e}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function LinkButton({ editor }: { editor: ReturnType<typeof useEditor> }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const isActive = editor?.isActive("link") ?? false;

  const handleSet = () => {
    if (!url.trim()) return;
    editor?.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
    setUrl(""); setOpen(false);
  };
  const handleRemove = () => {
    editor?.chain().focus().extendMarkRange("link").unsetLink().run();
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button" title="Insert link"
          className={cn("h-7 w-7 flex items-center justify-center rounded text-sm transition-colors",
            isActive ? "bg-primary text-primary-foreground" : "hover:bg-accent text-muted-foreground hover:text-foreground"
          )}
        >
          <Link2 className="w-3.5 h-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" align="start">
        <div className="flex gap-1.5">
          <Input
            value={url} onChange={e => setUrl(e.target.value)}
            placeholder="https://..." className="h-7 text-xs flex-1"
            onKeyDown={e => e.key === "Enter" && handleSet()}
          />
          <Button size="sm" className="h-7 px-2 text-xs" onClick={handleSet}>Set</Button>
        </div>
        {isActive && (
          <Button variant="ghost" size="sm" className="mt-1 h-6 text-xs w-full text-destructive" onClick={handleRemove}>
            Remove link
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ── Main Editor Component ─────────────────────────────────────────────────────

export interface RichEditorProps {
  value?: string;
  onChange?: (html: string) => void;
  placeholder?: string;
  minHeight?: string;
  className?: string;
  toolbar?: "full" | "compact" | "none";
  dir?: "ltr" | "rtl";
  signature?: string;
  autoFocus?: boolean;
}

export default function RichEditor({
  value,
  onChange,
  placeholder = "Write here...",
  minHeight = "200px",
  className,
  toolbar = "full",
  dir: initialDir,
  signature,
  autoFocus,
}: RichEditorProps) {
  const [textColor, setTextColor] = useState<string>("#000000");
  const [highlightColor, setHighlightColor] = useState<string>("#fef08a");
  const [fontFamily, setFontFamily] = useState("inherit");
  const [fontSize, setFontSize] = useState("14px");
  const [dir, setDir] = useState<"ltr" | "rtl">(initialDir ?? "ltr");

  const initialContent = (() => {
    if (value) return value;
    if (signature) return `<p></p><p></p><hr/><p>${signature}</p>`;
    return "";
  })();

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: false,
        underline: false,
        strike: false,
      }),
      Underline,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TextStyle,
      TiptapFontSize,
      Color,
      Highlight.configure({ multicolor: true }),
      Link.configure({ openOnClick: false, HTMLAttributes: { class: "text-primary underline cursor-pointer" } }),
      Image.configure({ HTMLAttributes: { class: "max-w-full rounded" } }),
      FontFamily,
      Placeholder.configure({ placeholder }),
    ],
    content: initialContent,
    autofocus: autoFocus,
    editorProps: {
      attributes: {
        class: "outline-none prose prose-sm dark:prose-invert max-w-none",
        dir,
      },
    },
    onUpdate({ editor }) {
      onChange?.(editor.getHTML());
    },
  });

  // sync dir attribute
  useEffect(() => {
    editor?.view.dom.setAttribute("dir", dir);
  }, [dir, editor]);

  // sync value changes from outside
  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    if (value !== undefined && value !== current) {
      editor.commands.setContent(value);
    }
  }, [value]);

  const applyTextColor = useCallback((c: string) => {
    setTextColor(c);
    editor?.chain().focus().setColor(c).run();
  }, [editor]);

  const applyHighlight = useCallback((c: string) => {
    setHighlightColor(c);
    editor?.chain().focus().toggleHighlight({ color: c }).run();
  }, [editor]);

  const applyFontFamily = useCallback((f: string) => {
    setFontFamily(f);
    if (f === "inherit") editor?.chain().focus().unsetFontFamily().run();
    else editor?.chain().focus().setFontFamily(f).run();
  }, [editor]);

  const applyFontSize = useCallback((s: string) => {
    setFontSize(s);
    (editor?.chain().focus() as any).setFontSize(s).run();
  }, [editor]);

  const insertEmoji = useCallback((emoji: string) => {
    editor?.chain().focus().insertContent(emoji).run();
  }, [editor]);

  const insertImage = useCallback(() => {
    const url = window.prompt("Image URL:");
    if (url) editor?.chain().focus().setImage({ src: url }).run();
  }, [editor]);

  if (!editor) return null;

  const ToolbarDivider = () => <div className="w-px h-5 bg-border mx-0.5 self-center" />;

  return (
    <div className={cn("flex flex-col border rounded-lg overflow-hidden bg-background", className)}>
      {toolbar !== "none" && (
        <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b bg-muted/20 shrink-0">
          {/* Font family */}
          <ToolbarSelect
            value={fontFamily}
            onChange={applyFontFamily}
            options={FONT_FAMILIES}
            className="w-32"
          />

          {/* Font size */}
          <ToolbarSelect
            value={fontSize}
            onChange={applyFontSize}
            options={FONT_SIZES.map(s => ({ label: s, value: s }))}
            className="w-16"
          />

          <ToolbarDivider />

          {/* Text format */}
          <ToolbarBtn active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold">
            <Bold className="w-3.5 h-3.5" />
          </ToolbarBtn>
          <ToolbarBtn active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic">
            <Italic className="w-3.5 h-3.5" />
          </ToolbarBtn>
          <ToolbarBtn active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Underline">
            <UnderlineIcon className="w-3.5 h-3.5" />
          </ToolbarBtn>
          <ToolbarBtn active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()} title="Strikethrough">
            <Strikethrough className="w-3.5 h-3.5" />
          </ToolbarBtn>

          <ToolbarDivider />

          {/* Colors */}
          <ColorPicker
            colors={TEXT_COLORS} value={textColor}
            onChange={applyTextColor} icon={<Type className="w-3.5 h-3.5" />}
            title="Text color"
          />
          <ColorPicker
            colors={HIGHLIGHT_COLORS} value={highlightColor}
            onChange={applyHighlight} icon={<Highlighter className="w-3.5 h-3.5" />}
            title="Highlight"
          />

          <ToolbarDivider />

          {/* Alignment */}
          <ToolbarBtn active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()} title="Align left">
            <AlignLeft className="w-3.5 h-3.5" />
          </ToolbarBtn>
          <ToolbarBtn active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()} title="Align center">
            <AlignCenter className="w-3.5 h-3.5" />
          </ToolbarBtn>
          <ToolbarBtn active={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()} title="Align right">
            <AlignRight className="w-3.5 h-3.5" />
          </ToolbarBtn>

          <ToolbarDivider />

          {/* Lists & quote */}
          <ToolbarBtn active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Bullet list">
            <List className="w-3.5 h-3.5" />
          </ToolbarBtn>
          <ToolbarBtn active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Numbered list">
            <ListOrdered className="w-3.5 h-3.5" />
          </ToolbarBtn>
          <ToolbarBtn active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()} title="Quote">
            <Quote className="w-3.5 h-3.5" />
          </ToolbarBtn>

          <ToolbarDivider />

          {/* Insert */}
          <LinkButton editor={editor} />
          <ToolbarBtn onClick={insertImage} title="Insert image">
            <ImageIcon className="w-3.5 h-3.5" />
          </ToolbarBtn>
          <EmojiPicker onPick={insertEmoji} />
          <ToolbarBtn onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Horizontal rule">
            <Minus className="w-3.5 h-3.5" />
          </ToolbarBtn>

          <ToolbarDivider />

          {/* RTL/LTR toggle */}
          <button
            type="button"
            title={dir === "rtl" ? "Switch to LTR" : "Switch to RTL"}
            onMouseDown={e => { e.preventDefault(); setDir(d => d === "ltr" ? "rtl" : "ltr"); }}
            className={cn(
              "h-7 px-2 flex items-center gap-1 rounded text-xs transition-colors font-medium",
              "hover:bg-accent text-muted-foreground hover:text-foreground"
            )}
          >
            <Languages className="w-3.5 h-3.5" />
            <span>{dir === "rtl" ? "RTL" : "LTR"}</span>
          </button>
        </div>
      )}

      <div
        className="flex-1 overflow-y-auto"
        style={{ minHeight }}
        onClick={() => editor.commands.focus()}
      >
        <EditorContent
          editor={editor}
          className="h-full p-4 text-sm"
        />
      </div>

      <style>{`
        .tiptap p.is-editor-empty:first-child::before {
          color: hsl(var(--muted-foreground));
          content: attr(data-placeholder);
          float: left;
          height: 0;
          pointer-events: none;
          opacity: 0.6;
        }
        .tiptap:focus { outline: none; }
        .tiptap ul { list-style-type: disc; padding-left: 1.5rem; }
        .tiptap ol { list-style-type: decimal; padding-left: 1.5rem; }
        .tiptap blockquote { border-left: 3px solid hsl(var(--border)); padding-left: 1rem; color: hsl(var(--muted-foreground)); margin: 0.5rem 0; }
        .tiptap h1 { font-size: 1.5rem; font-weight: 700; margin-bottom: 0.5rem; }
        .tiptap h2 { font-size: 1.25rem; font-weight: 600; margin-bottom: 0.5rem; }
        .tiptap h3 { font-size: 1.1rem; font-weight: 600; margin-bottom: 0.5rem; }
        .tiptap hr { border-top: 1px solid hsl(var(--border)); margin: 1rem 0; }
        .tiptap a { color: hsl(var(--primary)); text-decoration: underline; }
        [dir="rtl"] .tiptap { text-align: right; }
      `}</style>
    </div>
  );
}
