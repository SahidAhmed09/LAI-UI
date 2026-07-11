import {
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { Send, Paperclip, Square } from "lucide-react";
import { cn } from "@/react-app/lib/utils";
import type { ChatAttachment } from "./ChatMessage";
import { AttachmentChip } from "@/react-app/components/project/AttachmentChip";

interface ChatInputProps {
  onSend: (message: string, attachments: ChatAttachment[]) => void;
  disabled?: boolean;
  placeholder?: string;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  // Attachments are owned by the parent (DashboardChat via the upload-on-attach
  // hook); the composer just shows them and forwards add/remove intents.
  attachments: ChatAttachment[];
  onAddFiles: (files: File[]) => void;
  onRemoveAttachment: (id: string) => void;
  // True while any attachment is still uploading — Send stays disabled.
  isUploading?: boolean;
  // While the assistant is generating, the Send button becomes a Stop button.
  isStreaming?: boolean;
  onStop?: () => void;
}

export function ChatInput({
  onSend,
  disabled,
  placeholder,
  inputRef,
  attachments = [],
  onAddFiles,
  onRemoveAttachment,
  isUploading,
  isStreaming,
  onStop,
}: ChatInputProps) {
  const [message, setMessage] = useState("");
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const internalTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const textareaRef: RefObject<HTMLTextAreaElement | null> =
    inputRef ?? internalTextareaRef;

  // The composer is locked while ingesting (``disabled``), uploading, or while
  // the assistant is generating (``isStreaming`` → Stop button).
  const locked = disabled || isStreaming || isUploading;

  // ── Send ─────────────────────────────────────────────────────────────
  const handleSend = () => {
    if (disabled || isStreaming || isUploading) return;
    if (!message.trim() && attachments.length === 0) return;
    onSend(message, attachments);
    setMessage("");
    // Attachments are cleared by the parent (composer.clear()).
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ── File handling ────────────────────────────────────────────────────
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.currentTarget.files;
    if (files && files.length) onAddFiles(Array.from(files));
    e.currentTarget.value = "";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files && files.length) onAddFiles(Array.from(files));
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 200) + "px";
  };

  const canSend =
    (message.trim().length > 0 || attachments.length > 0) &&
    !disabled &&
    !isUploading;

  return (
    <div className="flex flex-col gap-2">
      {/* Main input box */}
      <div
        className={cn(
          "relative rounded-2xl border bg-card/60 backdrop-blur shadow-sm transition-all",
          isDragging
            ? "border-primary border-dashed bg-primary/5"
            : "border-border/50",
          "focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20",
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Attachment preview cards — thumbnail + type badge + live upload % */}
        {attachments.length > 0 && (
          <div className="p-3 pb-0 flex flex-wrap gap-3">
            {attachments.map((att) => (
              <AttachmentChip
                key={att.id}
                att={att}
                onRemove={() => onRemoveAttachment(att.id)}
              />
            ))}
          </div>
        )}

        {/* Input row */}
        <div className="flex items-center gap-2 px-3 pt-3 pb-2">
          {/* Paperclip */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || isStreaming}
            className="flex-shrink-0 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="Attach document"
          >
            <Paperclip className="w-[18px] h-[18px]" />
          </button>

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={message}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder || "Ask LAI..."}
            disabled={locked}
            rows={1}
            className="flex-1 resize-none outline-none bg-transparent text-foreground text-sm leading-relaxed min-h-[24px] max-h-[200px] py-0.5 placeholder:text-muted-foreground disabled:opacity-60"
          />

          {/* Stop (while generating) / Send */}
          <div className="flex items-center flex-shrink-0">
            {isStreaming ? (
              <button
                type="button"
                onClick={onStop}
                title="Stop generating"
                aria-label="Stop generating"
                className="w-8 h-8 rounded-full flex items-center justify-center bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm transition-all"
              >
                <Square className="w-3 h-3 fill-current" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSend}
                disabled={!canSend}
                title={
                  isUploading ? "Waiting for upload to finish…" : "Send message"
                }
                aria-label="Send message"
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center transition-all",
                  canSend
                    ? "bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm"
                    : "bg-muted text-muted-foreground opacity-50 cursor-not-allowed",
                )}
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Footer hint */}
        <div className="flex items-center justify-end px-4 pb-2.5">
          <span className="text-xs text-muted-foreground/40">
            {isStreaming
              ? "Generating — press Stop to halt"
              : isUploading
                ? "Uploading document…"
                : "Press Enter to send · Shift+Enter for new line"}
          </span>
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileChange}
        accept=".pdf,.doc,.docx,.xlsx,.xls,.txt,.csv"
      />
    </div>
  );
}
