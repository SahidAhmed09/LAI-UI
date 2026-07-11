import { useRef, useState } from "react";
import {
  ArrowLeft,
  Star,
  MoreVertical,
  Plus,
  Send,
  CheckCircle2,
  Archive,
  Trash2,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/react-app/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/react-app/components/ui/dropdown-menu";
import { Project, ChatAttachment } from "./types";
import { ProjectConversationList } from "./ProjectConversationList";
import { ProjectSidebar } from "./ProjectSidebar";
import { ProjectChatView } from "./ProjectChatView";
import { useComposerAttachments } from "@/react-app/hooks/useComposerAttachments";
import { AttachmentChip } from "./AttachmentChip";

function statusBadgeClass(status: string) {
  switch (status) {
    case "active":
      return "bg-amber-500/10 text-amber-600 border-amber-500/20 dark:text-amber-500";
    case "completed":
      return "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-500";
    default:
      return "bg-slate-500/10 text-slate-600 border-slate-500/20 dark:text-slate-400";
  }
}

interface ProjectDetailViewProps {
  project: Project;
  onBack: () => void;
  onComplete: (id: string) => void;
  onArchive: (id: string) => void;
  onReactivate: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onAddFiles: (projectId: string, files: FileList) => void;
  onDeleteFile: (projectId: string, fileId: string) => void;
  /** Persist a session id minted by an upload-on-attach in a composer. */
  onSessionEstablished: (projectId: string, sessionId: string) => void;
  /** Create a new conversation + run its first turn. Returns the new id. */
  onCreateConversation: (
    projectId: string,
    text: string,
    attachments: ChatAttachment[],
  ) => string;
  /** Send a follow-up message into an existing conversation. */
  onSendMessage: (
    projectId: string,
    conversationId: string,
    text: string,
    attachments: ChatAttachment[],
  ) => void;
  /** Stop the in-flight stream of a conversation. */
  onStopMessage: (projectId: string, conversationId: string) => void;
  /** Re-run the question that produced an assistant message. */
  onRegenerate: (
    projectId: string,
    conversationId: string,
    assistantMsgId: string,
  ) => void;
  /** Edit a user message and re-run from there. */
  onEditMessage: (
    projectId: string,
    conversationId: string,
    userMsgId: string,
    newText: string,
  ) => void;
  /** Thumbs up/down on an assistant message. */
  onFeedback: (
    projectId: string,
    conversationId: string,
    msgId: string,
    rating: 1 | -1,
  ) => void;
}

export function ProjectDetailView({
  project,
  onBack,
  onComplete,
  onArchive,
  onReactivate,
  onDelete,
  onToggleFavorite,
  onAddFiles,
  onDeleteFile,
  onSessionEstablished,
  onCreateConversation,
  onSendMessage,
  onStopMessage,
  onRegenerate,
  onEditMessage,
  onFeedback,
}: ProjectDetailViewProps) {
  const [openConversationId, setOpenConversationId] = useState<string | null>(
    null,
  );
  const [newChatInput, setNewChatInput] = useState("");
  const composerFileRef = useRef<HTMLInputElement>(null);

  // Upload-on-attach: files uploaded the moment they're attached, with live
  // status on each chip. Scoped to the project's "new chat" staging area so
  // mid-upload chips survive navigation to another tab. Distinct from the
  // per-conversation scope used inside ProjectChatView, so attachments
  // staged here (before a conversation is opened) don't leak in there.
  const composer = useComposerAttachments({
    scope: `project-new:${project.id}`,
    sessionId: project.sessionId,
    onSessionEstablished: (sid) => onSessionEstablished(project.id, sid),
  });

  const openConversation = project.conversations.find(
    (c) => c.id === openConversationId,
  );

  // ── Chat view ─────────────────────────────────────────────────────────────
  if (openConversationId && openConversation) {
    return (
      <div className="h-full flex flex-col bg-background overflow-hidden animate-in fade-in slide-in-from-right-4 duration-300">
        <ProjectChatView
          key={openConversationId}
          projectName={project.name}
          conversation={openConversation}
          sessionId={openConversation.sessionId ?? project.sessionId}
          onSessionEstablished={(sid) => onSessionEstablished(project.id, sid)}
          onBack={() => setOpenConversationId(null)}
          onSendMessage={(msg, attachments) =>
            onSendMessage(project.id, openConversationId, msg, attachments)
          }
          onStop={() => onStopMessage(project.id, openConversationId)}
          onRegenerate={(assistantMsgId) =>
            onRegenerate(project.id, openConversationId, assistantMsgId)
          }
          onEditMessage={(userMsgId, newText) =>
            onEditMessage(project.id, openConversationId, userMsgId, newText)
          }
          onFeedback={(msgId, rating) =>
            onFeedback(project.id, openConversationId, msgId, rating)
          }
        />
      </div>
    );
  }

  // ── New-conversation composer ──────────────────────────────────────────────
  const handleStartNewConversation = () => {
    if ((!newChatInput.trim() && composer.attachments.length === 0) || composer.isUploading)
      return;
    const newId = onCreateConversation(
      project.id,
      newChatInput,
      composer.attachments,
    );
    setNewChatInput("");
    composer.clear();
    setOpenConversationId(newId);
  };

  const handleComposerFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.currentTarget.files) composer.addFiles(e.currentTarget.files);
    e.currentTarget.value = "";
  };

  return (
    <div className="h-full flex flex-col bg-background overflow-hidden">
      {/* Top nav bar */}
      <div className="flex-shrink-0 h-11 flex items-center px-4 border-b border-border/50 bg-background/95 backdrop-blur">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          All projects
        </button>
      </div>

      {/* Main layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* LEFT PANEL */}
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          <div className="flex items-start justify-between px-6 pt-5 pb-4 flex-shrink-0 gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <h1 className="text-2xl font-bold text-foreground tracking-tight truncate">
                  {project.name}
                </h1>
                <span
                  className={`shrink-0 text-xs font-medium px-2.5 py-1 rounded-md border ${statusBadgeClass(project.status)}`}
                >
                  {project.status}
                </span>
              </div>
              {project.description && (
                <p className="text-sm text-muted-foreground mt-1 line-clamp-1 max-w-2xl">
                  {project.description}
                </p>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                title={project.favorite ? "Unstar project" : "Star project"}
                className={
                  project.favorite
                    ? "text-amber-500 hover:text-amber-500"
                    : "text-muted-foreground hover:text-amber-400"
                }
                onClick={() => onToggleFavorite(project.id)}
              >
                <Star
                  className={`w-4 h-4 ${project.favorite ? "fill-amber-500" : ""}`}
                />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground"
                  >
                    <MoreVertical className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {project.status === "active" ? (
                    <DropdownMenuItem onClick={() => onComplete(project.id)}>
                      <CheckCircle2 className="w-4 h-4 mr-2" />
                      Mark as Completed
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem onClick={() => onReactivate(project.id)}>
                      <RotateCcw className="w-4 h-4 mr-2" />
                      Reactivate
                    </DropdownMenuItem>
                  )}
                  {project.status !== "archived" && (
                    <DropdownMenuItem onClick={() => onArchive(project.id)}>
                      <Archive className="w-4 h-4 mr-2" />
                      Archive Project
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    onClick={() => {
                      onDelete(project.id);
                      onBack();
                    }}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Conversations — a separate scrollable card that fills the space
              above the composer so the chat input stays pinned at the bottom. */}
          <div className="flex-1 min-h-0 px-6 pb-3 overflow-hidden">
            <ProjectConversationList
              conversations={project.conversations}
              onSelectConversation={setOpenConversationId}
            />
          </div>

          {/* New conversation composer — pinned to the bottom of the panel */}
          <div className="px-6 pt-3 pb-5 flex-shrink-0 border-t border-border/40 bg-background/60 backdrop-blur">
            <div className="bg-card/50 backdrop-blur rounded-2xl border border-border/50 overflow-hidden focus-within:border-primary/50 transition-colors">
              {composer.attachments.length > 0 && (
                <div className="flex flex-wrap gap-2 px-4 pt-3">
                  {composer.attachments.map((att) => (
                    <AttachmentChip
                      key={att.id}
                      att={att}
                      onRemove={() => composer.removeAttachment(att.id)}
                    />
                  ))}
                </div>
              )}
              <textarea
                className="w-full min-h-[52px] px-4 pt-3 pb-1 resize-none outline-none bg-transparent text-foreground placeholder-muted-foreground text-sm leading-relaxed"
                placeholder="Start a new conversation — ask about permits, contracts, or attach a document…"
                rows={2}
                value={newChatInput}
                onChange={(e) => setNewChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleStartNewConversation();
                  }
                }}
              />
              <div className="flex items-center justify-between px-3 py-2 border-t border-border/30">
                <button
                  onClick={() => composerFileRef.current?.click()}
                  title="Attach a document"
                  className="text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-muted/50 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                </button>
                <button
                  onClick={handleStartNewConversation}
                  disabled={
                    (!newChatInput.trim() && composer.attachments.length === 0) ||
                    composer.isUploading
                  }
                  title={composer.isUploading ? "Dokumente werden noch hochgeladen…" : "Senden"}
                  className="disabled:opacity-40 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
              <input
                ref={composerFileRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleComposerFiles}
                accept=".pdf,.doc,.docx,.xlsx,.xls,.txt,.csv,.md"
              />
            </div>
            <p className="text-[11px] text-muted-foreground/50 text-center mt-2">
              Grounded in the legal corpus & your documents · Press Enter to
              send
            </p>
          </div>
        </div>

        {/* RIGHT SIDEBAR */}
        <ProjectSidebar
          files={project.files}
          projectId={project.id}
          sessionId={project.sessionId}
          onAddFiles={onAddFiles}
          onDeleteFile={onDeleteFile}
        />
      </div>
    </div>
  );
}
