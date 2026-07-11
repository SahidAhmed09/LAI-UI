import { useState, useEffect, useRef, useCallback } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/react-app/components/ui/card";
import { Button } from "@/react-app/components/ui/button";
import { Input } from "@/react-app/components/ui/input";
import { Label } from "@/react-app/components/ui/label";
import { Textarea } from "@/react-app/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/react-app/components/ui/dropdown-menu";
import {
  PlusIcon,
  CaseFolderIcon,
  ManuscriptIcon,
  DotsVerticalIcon,
  TrashIcon,
  CloseIcon,
  NewFolderIcon,
  CalendarIcon,
  TeamIcon,
  AlertRingIcon,
  CheckRingIcon,
  SearchIcon,
  FilterIcon,
  ConsultIcon,
  ArchiveIcon,
} from "@/react-app/components/icons";
import { Star } from "lucide-react";
import { ProjectDetailView } from "@/react-app/components/project/ProjectDetailView";
import { loadProjects, saveProjects } from "@/react-app/components/project/data";
import {
  Project,
  ProjectConversation,
  ChatAttachment,
  ChatMessage,
} from "@/react-app/components/project/types";
import { streamQuery, uploadDocument, submitFeedback } from "@/react-app/lib/ragApi";
import type { RAGResponse } from "@/react-app/lib/ragApi";
import { randomId } from "@/react-app/utils/uuid";

// Documents the backend Docling pipeline can ingest. Mirrors the set the
// chat ChatInput offers so a project upload never silently no-ops.
const SUPPORTED_DOC_EXTS = [
  ".pdf",
  ".doc",
  ".docx",
  ".xlsx",
  ".xls",
  ".txt",
  ".csv",
  ".md",
];

function getStatusColor(status: string) {
  switch (status) {
    case "active":
      return "bg-amber-500/10 text-amber-600 border-amber-500/20 dark:text-amber-500 dark:border-amber-500/30";
    case "completed":
      return "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-500 dark:border-emerald-500/30";
    case "archived":
      return "bg-slate-500/10 text-slate-600 border-slate-500/20 dark:text-slate-400 dark:border-slate-500/30";
    default:
      return "bg-slate-500/10 text-slate-600 border-slate-500/20 dark:text-slate-400 dark:border-slate-500/30";
  }
}

function nowTime() {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── Pure nested-state updaters ───────────────────────────────────────────────
// Projects → conversations → messages is a 3-level tree; these keep the
// streaming token writes terse and immutable.
function mapConv(
  projects: Project[],
  projectId: string,
  convId: string,
  fn: (c: ProjectConversation) => ProjectConversation,
): Project[] {
  return projects.map((p) =>
    p.id !== projectId
      ? p
      : {
          ...p,
          conversations: p.conversations.map((c) =>
            c.id !== convId ? c : fn(c),
          ),
        },
  );
}

function mapMsg(
  projects: Project[],
  projectId: string,
  convId: string,
  msgId: string,
  fn: (m: ChatMessage) => ChatMessage,
): Project[] {
  return mapConv(projects, projectId, convId, (c) => ({
    ...c,
    messages: c.messages.map((m) => (m.id !== msgId ? m : fn(m))),
  }));
}

export default function DashboardProjectsPage() {
  const [projects, setProjects] = useState<Project[]>(() => loadProjects());
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [newProject, setNewProject] = useState({ name: "", description: "" });

  // Mirror of ``projects`` for reads inside async stream callbacks without
  // re-subscribing closures on every token.
  const projectsRef = useRef(projects);
  projectsRef.current = projects;

  // AbortController for the in-flight stream of each conversation, so the
  // composer's Stop button can halt generation (keyed by conversation id).
  const streamControllers = useRef<Record<string, AbortController | null>>({});

  // ── Shared streaming primitive ──────────────────────────────────────────
  // Streams an answer into an EXISTING assistant bubble (``aiMsgId``). Used by
  // the normal turn, Regenerate, and Edit so they can't drift. Stores the
  // AbortController so Stop works, and finalises the bubble on
  // complete/error/abort. ``sidOverride`` lets the caller pass the session id
  // it just resolved (post-upload) instead of re-reading possibly-stale state.
  const streamInto = useCallback(
    (
      projectId: string,
      convId: string,
      aiMsgId: string,
      question: string,
      sidOverride?: string | null,
      // Per-turn focus: when the composer just attached one or more docs we
      // pass their [M-n] slots here so this answer is scoped to ONLY those
      // documents. Empty/null ⇒ full session (default).
      focusDocIndexes?: number[] | null,
    ) =>
      new Promise<void>((resolve) => {
        const project = projectsRef.current.find((p) => p.id === projectId);
        const conv = project?.conversations.find((c) => c.id === convId);
        const sid =
          sidOverride !== undefined
            ? sidOverride
            : project?.sessionId ?? conv?.sessionId ?? null;

        streamControllers.current[convId]?.abort();
        const ctrl = streamQuery(question, sid, {
          onStatus: (note) =>
            setProjects((prev) =>
              mapMsg(prev, projectId, convId, aiMsgId, (m) => ({
                ...m,
                processingNote: note,
              })),
            ),
          onToken: (delta) => {
            if (!delta || delta.includes("⏳")) return;
            setProjects((prev) =>
              mapMsg(prev, projectId, convId, aiMsgId, (m) => ({
                ...m,
                message: m.message + delta,
                streaming: true,
                processingNote: undefined,
              })),
            );
          },
          onComplete: (payload: RAGResponse) => {
            setProjects((prev) =>
              prev.map((p) => {
                if (p.id !== projectId) return p;
                return {
                  ...p,
                  sessionId: payload.session_id ?? p.sessionId ?? null,
                  conversations: p.conversations.map((c) =>
                    c.id !== convId
                      ? c
                      : {
                          ...c,
                          sessionId: payload.session_id ?? c.sessionId ?? null,
                          messages: c.messages.map((m) =>
                            m.id !== aiMsgId
                              ? m
                              : {
                                  ...m,
                                  message: payload.answer,
                                  chunks: payload.chunks,
                                  citationValidation:
                                    payload.citation_validation ?? null,
                                  jurisdictionWarnings:
                                    payload.jurisdiction_warnings ?? undefined,
                                  messageId: payload.message_id ?? null,
                                  streaming: false,
                                  processingNote: undefined,
                                  timestamp: nowTime(),
                                },
                          ),
                        },
                  ),
                };
              }),
            );
            streamControllers.current[convId] = null;
            resolve();
          },
          onError: (detail) => {
            setProjects((prev) =>
              mapMsg(prev, projectId, convId, aiMsgId, (m) => ({
                ...m,
                message: `⚠️ **Error:** ${detail}`,
                streaming: false,
                error: true,
                processingNote: undefined,
                timestamp: nowTime(),
              })),
            );
            streamControllers.current[convId] = null;
            resolve();
          },
          onAbort: () => {
            setProjects((prev) =>
              mapMsg(prev, projectId, convId, aiMsgId, (m) => ({
                ...m,
                message: m.message.trim().length
                  ? `${m.message}\n\n_⏹ Stopped._`
                  : "_⏹ Generation stopped._",
                streaming: false,
                processingNote: undefined,
                timestamp: nowTime(),
              })),
            );
            streamControllers.current[convId] = null;
            resolve();
          },
        }, null, focusDocIndexes ?? null);
        streamControllers.current[convId] = ctrl;
      }),
    [],
  );

  // Persist on every change so created projects + their conversation/session
  // mapping survive a reload (chat history is grounded server-side via the
  // stored session id).
  useEffect(() => {
    saveProjects(projects);
  }, [projects]);

  const selectedProject =
    projects.find((p) => p.id === selectedProjectId) ?? null;

  const filteredProjects = projects
    .filter((p) => {
      const matchSearch =
        p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.description.toLowerCase().includes(searchTerm.toLowerCase());
      const matchStatus = !filterStatus || p.status === filterStatus;
      return matchSearch && matchStatus;
    })
    // Favourites float to the top; otherwise preserve insertion order.
    .sort((a, b) => Number(b.favorite ?? false) - Number(a.favorite ?? false));

  const handleCreateProject = () => {
    if (!newProject.name.trim()) return;
    setProjects((prev) => [
      {
        id: randomId(),
        name: newProject.name.trim(),
        description: newProject.description.trim(),
        instructions: "",
        status: "active",
        owner: "You",
        createdDate: new Date().toISOString().split("T")[0],
        files: [],
        teamMembers: 1,
        conversations: [],
        favorite: false,
      },
      ...prev,
    ]);
    setNewProject({ name: "", description: "" });
    setShowCreateModal(false);
  };

  const handleDeleteProject = (id: string) => {
    setProjects((p) => p.filter((x) => x.id !== id));
    if (selectedProjectId === id) setSelectedProjectId(null);
  };
  const handleCompleteProject = (id: string) =>
    setProjects((p) =>
      p.map((x) => (x.id === id ? { ...x, status: "completed" } : x)),
    );
  const handleArchiveProject = (id: string) =>
    setProjects((p) =>
      p.map((x) => (x.id === id ? { ...x, status: "archived" } : x)),
    );
  const handleReactivateProject = (id: string) =>
    setProjects((p) =>
      p.map((x) => (x.id === id ? { ...x, status: "active" } : x)),
    );
  const handleToggleFavorite = (id: string) =>
    setProjects((p) =>
      p.map((x) => (x.id === id ? { ...x, favorite: !x.favorite } : x)),
    );
  // Add files to the project's file section AND upload them to the project's
  // matter session so the chat can actually read them. Previously this only
  // stored local metadata and never hit the backend, so a file dropped here
  // was invisible to the chat ("no document attached"). Each file is uploaded
  // to the SAME session every conversation queries; the returned session id
  // is pinned on the project and threaded across the batch.
  const handleAddFiles = (projectId: string, files: FileList) => {
    const incoming = Array.from(files).filter((f) =>
      SUPPORTED_DOC_EXTS.some((ext) => f.name.toLowerCase().endsWith(ext)),
    );
    if (incoming.length === 0) return;

    const rows = incoming.map((file) => ({ file, id: randomId() }));

    // Paint the rows in "uploading" state immediately for feedback.
    setProjects((prev) =>
      prev.map((x) =>
        x.id !== projectId
          ? x
          : {
              ...x,
              files: [
                ...rows.map((r) => ({
                  id: r.id,
                  name: r.file.name,
                  size: r.file.size / (1024 * 1024),
                  uploadDate: new Date().toISOString().split("T")[0],
                  type: (r.file.name.split(".").pop() ?? "file").toUpperCase(),
                  status: "uploading" as const,
                })),
                ...x.files,
              ],
            },
      ),
    );

    void (async () => {
      let sid =
        projectsRef.current.find((p) => p.id === projectId)?.sessionId ?? null;
      for (const r of rows) {
        try {
          const res = await uploadDocument(r.file, sid);
          sid = res.session_id;
          // Pin the session on the project and flip this row to "ready".
          setProjects((prev) =>
            prev.map((x) =>
              x.id !== projectId
                ? x
                : {
                    ...x,
                    sessionId: res.session_id,
                    files: x.files.map((f) =>
                      f.id === r.id ? { ...f, status: "ready" as const } : f,
                    ),
                  },
            ),
          );
        } catch (e) {
          setProjects((prev) =>
            prev.map((x) =>
              x.id !== projectId
                ? x
                : {
                    ...x,
                    files: x.files.map((f) =>
                      f.id === r.id
                        ? {
                            ...f,
                            status: "error" as const,
                            error:
                              e instanceof Error ? e.message : "Upload failed",
                          }
                        : f,
                    ),
                  },
            ),
          );
        }
      }
    })();
  };

  const handleDeleteFile = (projectId: string, fileId: string) =>
    setProjects((p) =>
      p.map((x) =>
        x.id === projectId
          ? { ...x, files: x.files.filter((f) => f.id !== fileId) }
          : x,
      ),
    );

  // ── Real RAG turn ───────────────────────────────────────────────────────
  // Streams an answer from the live backend (German legal corpus + any
  // documents attached to this conversation's session). Replaces the old
  // canned ``mockResponses`` array entirely.
  const runConversationTurn = useCallback(
    async (
      projectId: string,
      convId: string,
      text: string,
      attachments: ChatAttachment[],
    ) => {
      const userText = text.trim();
      const docAttachments = attachments.filter(
        (a) =>
          a.file &&
          SUPPORTED_DOC_EXTS.some((ext) =>
            a.file!.name.toLowerCase().endsWith(ext),
          ),
      );
      if (!userText && docAttachments.length === 0) return;

      const ts = nowTime();
      const userMsgId = randomId();
      const aiMsgId = randomId();

      // 1. Paint the user bubble + an empty streaming assistant placeholder.
      setProjects((prev) =>
        mapConv(prev, projectId, convId, (c) => ({
          ...c,
          lastMessage: userText || docAttachments[0]?.name || "Document",
          timestamp: "Just now",
          messages: [
            ...c.messages,
            {
              id: userMsgId,
              message: userText,
              sender: "user",
              timestamp: ts,
              attachments: attachments.map(({ id, name, size, type }) => ({
                id,
                name,
                size,
                type,
              })),
            },
            {
              id: aiMsgId,
              message: "",
              sender: "assistant",
              timestamp: ts,
              streaming: true,
            },
          ],
        })),
      );

      // Read the current session id straight from the ref so we don't depend
      // on a possibly-stale prop closure. Prefer the PROJECT's matter session
      // (which holds any documents added in the file section) so the chat can
      // actually read them; fall back to this conversation's own id, then to
      // null (the backend mints a fresh session on the first turn).
      const project = projectsRef.current.find((p) => p.id === projectId);
      const conv = project?.conversations.find((c) => c.id === convId);
      let sid: string | null = project?.sessionId ?? conv?.sessionId ?? null;

      // Pin the session id on BOTH the project (so files + future
      // conversations share it) and this conversation (so its document drawer
      // resolves) whenever it changes.
      const persistSession = (newSid: string) => {
        if (!newSid || newSid === sid) {
          sid = newSid || sid;
          return;
        }
        sid = newSid;
        setProjects((prev) =>
          prev.map((p) =>
            p.id !== projectId
              ? p
              : {
                  ...p,
                  sessionId: newSid,
                  conversations: p.conversations.map((c) =>
                    c.id === convId ? { ...c, sessionId: newSid } : c,
                  ),
                },
          ),
        );
      };

      try {
        // 2. Upload any attached documents to this conversation's session so
        //    the answer can cite them as [M-n] matter sources.
        for (const a of docAttachments) {
          if (!a.file) continue;
          // Upload-on-attach already pushed this file to the session — don't
          // upload it twice. Anything not yet uploaded (e.g. a rehydrated
          // attachment, or one whose attach-upload is still racing) is
          // uploaded here as a fallback so the turn is always self-contained.
          if (a.uploaded) continue;
          const res = await uploadDocument(a.file, sid);
          persistSession(res.session_id);
        }

        // 3. Upload-only turn (file dropped, no question): confirm + stop.
        if (!userText) {
          const names = docAttachments.map((a) => a.name).join(", ");
          setProjects((prev) =>
            mapMsg(prev, projectId, convId, aiMsgId, (m) => ({
              ...m,
              message: `📄 **Document added:** ${names}\n\nAsk a question about ${docAttachments.length > 1 ? "these documents" : "this document"} and I'll answer with citations.`,
              streaming: false,
              timestamp: nowTime(),
            })),
          );
          return;
        }

        // 4. Stream the grounded answer into the placeholder (shared path).
        //    Per-turn focus: when this turn attached docs, send their
        //    [M-n] slots so the answer scopes to ONLY those documents
        //    (prevents "analyse this document" from silently pulling in
        //    the rest of the project's matter). If any attachment landed
        //    without a docIndex (older backend / fallback re-upload), we
        //    drop focus and let the model see the whole session — better
        //    than scoping to a partial set.
        const focusIdxs = docAttachments.map((a) => a.docIndex);
        const focusDocIndexes =
          focusIdxs.length > 0 && focusIdxs.every((i): i is number => typeof i === "number")
            ? (focusIdxs as number[])
            : null;
        await streamInto(projectId, convId, aiMsgId, userText, sid, focusDocIndexes);
      } catch (err: unknown) {
        const msg =
          err instanceof Error
            ? err.message
            : "Could not reach the backend. Make sure the API server is running.";
        setProjects((prev) =>
          mapMsg(prev, projectId, convId, aiMsgId, (m) => ({
            ...m,
            message: `⚠️ **Error:** ${msg}`,
            streaming: false,
            error: true,
            timestamp: nowTime(),
          })),
        );
      }
    },
    [streamInto],
  );

  // ── Stop / Regenerate / Edit / Feedback ─────────────────────────────────
  // Halt the in-flight stream for a conversation (Stop button).
  const handleStopConversation = useCallback(
    (_projectId: string, convId: string) => {
      streamControllers.current[convId]?.abort();
    },
    [],
  );

  // Re-run the user question that produced an assistant bubble, streaming a
  // fresh answer back into the SAME bubble.
  const handleRegenerate = useCallback(
    (projectId: string, convId: string, assistantMsgId: string) => {
      const conv = projectsRef.current
        .find((p) => p.id === projectId)
        ?.conversations.find((c) => c.id === convId);
      if (!conv) return;
      const idx = conv.messages.findIndex((m) => m.id === assistantMsgId);
      if (idx < 0) return;
      let question = "";
      for (let i = idx - 1; i >= 0; i--) {
        const m = conv.messages[i];
        if (m.sender === "user" && m.message.trim().length > 0) {
          question = m.message;
          break;
        }
      }
      if (!question) return;
      setProjects((prev) =>
        mapMsg(prev, projectId, convId, assistantMsgId, (m) => ({
          ...m,
          message: "",
          chunks: undefined,
          error: false,
          feedback: null,
          streaming: true,
          processingNote: undefined,
          timestamp: nowTime(),
        })),
      );
      void streamInto(projectId, convId, assistantMsgId, question);
    },
    [streamInto],
  );

  // Edit a user message, drop everything after it, and re-run.
  const handleEditMessage = useCallback(
    (projectId: string, convId: string, userMsgId: string, newText: string) => {
      const trimmed = newText.trim();
      if (!trimmed) return;
      const aiMsgId = randomId();
      setProjects((prev) =>
        mapConv(prev, projectId, convId, (c) => {
          const idx = c.messages.findIndex((m) => m.id === userMsgId);
          if (idx < 0) return c;
          const head = c.messages.slice(0, idx);
          const edited: ChatMessage = {
            ...c.messages[idx],
            message: trimmed,
            timestamp: nowTime(),
          };
          const placeholder: ChatMessage = {
            id: aiMsgId,
            message: "",
            sender: "assistant",
            timestamp: nowTime(),
            streaming: true,
          };
          return { ...c, messages: [...head, edited, placeholder] };
        }),
      );
      void streamInto(projectId, convId, aiMsgId, trimmed);
    },
    [streamInto],
  );

  // Thumbs up/down — optimistic locally, then recorded against THIS bubble's
  // persisted backend id (``messageId``) so feedback scopes per-message exactly
  // like the normal chat, falling back to session-level only when the row
  // wasn't persisted. Reverts the optimistic paint if the server rejects.
  const handleFeedback = useCallback(
    (projectId: string, convId: string, msgId: string, rating: 1 | -1) => {
      // Read the prior verdict + persisted message id BEFORE the optimistic
      // update so we can scope the request and revert on failure.
      const project = projectsRef.current.find((p) => p.id === projectId);
      const conv = project?.conversations.find((c) => c.id === convId);
      const target = conv?.messages.find((m) => m.id === msgId);
      const priorVerdict = target?.feedback ?? null;
      const serverMessageId = target?.messageId ?? null;
      const sid = conv?.sessionId ?? project?.sessionId ?? null;

      setProjects((prev) =>
        mapMsg(prev, projectId, convId, msgId, (m) => ({
          ...m,
          feedback: rating,
        })),
      );

      if (!sid) return;
      void (async () => {
        const newId = await submitFeedback({
          sessionId: sid,
          messageId: serverMessageId,
          rating,
        });
        if (newId === null) {
          // Server rejected (auth / 4xx / transport) — revert the paint.
          setProjects((prev) =>
            mapMsg(prev, projectId, convId, msgId, (m) => ({
              ...m,
              feedback: priorVerdict,
            })),
          );
        }
      })();
    },
    [],
  );

  // Create a new conversation and immediately run its first turn. Returns the
  // new conversation id so the caller can open it.
  const handleCreateConversation = useCallback(
    (projectId: string, text: string, attachments: ChatAttachment[]): string => {
      const convId = randomId();
      const title =
        (text.trim() || attachments[0]?.name || "New conversation").slice(
          0,
          60,
        );
      const newConv: ProjectConversation = {
        id: convId,
        title,
        lastMessage: text.trim(),
        timestamp: "Just now",
        messages: [],
        // Inherit the project's matter session so the new conversation can
        // immediately read documents already added in the file section (and
        // its document drawer resolves before the first turn completes).
        sessionId:
          projectsRef.current.find((p) => p.id === projectId)?.sessionId ??
          null,
      };
      setProjects((prev) =>
        prev.map((p) =>
          p.id === projectId
            ? { ...p, conversations: [newConv, ...p.conversations] }
            : p,
        ),
      );
      void runConversationTurn(projectId, convId, text, attachments);
      return convId;
    },
    [runConversationTurn],
  );

  const handleSendMessage = useCallback(
    (
      projectId: string,
      convId: string,
      text: string,
      attachments: ChatAttachment[],
    ) => {
      void runConversationTurn(projectId, convId, text, attachments);
    },
    [runConversationTurn],
  );

  // Persist a session id minted by an upload-on-attach in a composer, so the
  // project's files + future turns share the same matter session.
  const handleSessionEstablished = (projectId: string, sessionId: string) => {
    setProjects((prev) =>
      prev.map((p) =>
        p.id === projectId && p.sessionId !== sessionId
          ? { ...p, sessionId }
          : p,
      ),
    );
  };

  if (selectedProjectId && selectedProject) {
    return (
      <div
        className="fixed inset-0 z-40"
        style={{ left: "var(--sidebar-width, 64px)" }}
      >
        <ProjectDetailView
          project={selectedProject}
          onSessionEstablished={handleSessionEstablished}
          onBack={() => setSelectedProjectId(null)}
          onComplete={handleCompleteProject}
          onArchive={handleArchiveProject}
          onReactivate={handleReactivateProject}
          onDelete={handleDeleteProject}
          onToggleFavorite={handleToggleFavorite}
          onAddFiles={handleAddFiles}
          onDeleteFile={handleDeleteFile}
          onCreateConversation={handleCreateConversation}
          onSendMessage={handleSendMessage}
          onStopMessage={handleStopConversation}
          onRegenerate={handleRegenerate}
          onEditMessage={handleEditMessage}
          onFeedback={handleFeedback}
        />
      </div>
    );
  }

  const totalConversations = projects.reduce(
    (acc, p) => acc + p.conversations.length,
    0,
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Projects</h1>
          <p className="text-muted-foreground">
            Organize your due-diligence matters — each chat is grounded in the
            legal corpus and your uploaded documents.
          </p>
        </div>
        <Button className="shadow-sm" onClick={() => setShowCreateModal(true)}>
          <PlusIcon className="w-4 h-4 mr-2" />
          New Project
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          {
            label: "Total Projects",
            value: projects.length,
            Icon: NewFolderIcon,
            iconClass: "text-slate-600 dark:text-slate-400",
            bgClass: "bg-slate-100 dark:bg-slate-800",
          },
          {
            label: "Active",
            value: projects.filter((p) => p.status === "active").length,
            Icon: AlertRingIcon,
            iconClass: "text-amber-600 dark:text-amber-500",
            bgClass: "bg-amber-500/10",
          },
          {
            label: "Completed",
            value: projects.filter((p) => p.status === "completed").length,
            Icon: CheckRingIcon,
            iconClass: "text-emerald-600 dark:text-emerald-500",
            bgClass: "bg-emerald-500/10",
          },
          {
            label: "Conversations",
            value: totalConversations,
            Icon: ConsultIcon,
            iconClass: "text-sky-600 dark:text-sky-400",
            bgClass: "bg-sky-500/10",
          },
        ].map(({ label, value, Icon, iconClass, bgClass }) => (
          <Card
            key={label}
            className="bg-card/50 backdrop-blur border-border/50"
          >
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{label}</p>
                  <p className="text-2xl font-bold mt-2">{value}</p>
                </div>
                <div className={`p-2.5 rounded-md ${bgClass}`}>
                  <Icon className={`w-5 h-5 ${iconClass}`} />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search projects..."
            className="pl-10"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <FilterIcon className="w-4 h-4 mr-2" />
              {filterStatus
                ? filterStatus[0].toUpperCase() + filterStatus.slice(1)
                : "Status"}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setFilterStatus(null)}>
              All Status
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setFilterStatus("active")}>
              Active
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setFilterStatus("completed")}>
              Completed
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setFilterStatus("archived")}>
              Archived
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {projects.length === 0 ? (
          <div className="col-span-full">
            <div className="flex flex-col items-center text-center py-16 px-4 rounded-xl border border-dashed border-border/60 bg-card/30">
              <div className="p-3 rounded-full bg-primary/10 mb-4">
                <NewFolderIcon className="w-7 h-7 text-primary" />
              </div>
              <h3 className="text-lg font-semibold">No projects yet</h3>
              <p className="text-muted-foreground max-w-sm mt-1 mb-5 text-sm">
                Create your first project to start a grounded conversation with
                LAI about permits, contracts, and compliance.
              </p>
              <Button onClick={() => setShowCreateModal(true)}>
                <PlusIcon className="w-4 h-4 mr-2" />
                Create your first project
              </Button>
            </div>
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="col-span-full text-center py-12">
            <CaseFolderIcon className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-50" />
            <p className="text-muted-foreground">
              No projects match your search.
            </p>
          </div>
        ) : (
          filteredProjects.map((project) => (
            <Card
              key={project.id}
              className="group bg-card/50 backdrop-blur border-border/50 hover:border-primary/50 hover:shadow-md transition-all cursor-pointer flex flex-col"
              onClick={() => setSelectedProjectId(project.id)}
            >
              <CardHeader className="pb-3 flex flex-row items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <CaseFolderIcon className="w-5 h-5 text-slate-500 dark:text-slate-400 shrink-0" />
                    <CardTitle className="text-lg truncate">
                      {project.name}
                    </CardTitle>
                    {project.favorite && (
                      <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500 shrink-0" />
                    )}
                  </div>
                  <span
                    className={`inline-block text-xs font-medium px-2.5 py-1 rounded-md mt-2 border ${getStatusColor(project.status)}`}
                  >
                    {project.status}
                  </span>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <DotsVerticalIcon className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleFavorite(project.id);
                      }}
                    >
                      <Star
                        className={`w-4 h-4 mr-2 ${project.favorite ? "fill-amber-500 text-amber-500" : ""}`}
                      />
                      {project.favorite ? "Unstar" : "Star"}
                    </DropdownMenuItem>
                    {project.status === "active" && (
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCompleteProject(project.id);
                        }}
                      >
                        <CheckRingIcon className="w-4 h-4 mr-2" />
                        Mark Completed
                      </DropdownMenuItem>
                    )}
                    {project.status !== "active" && (
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          handleReactivateProject(project.id);
                        }}
                      >
                        <AlertRingIcon className="w-4 h-4 mr-2" />
                        Reactivate
                      </DropdownMenuItem>
                    )}
                    {project.status !== "archived" && (
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          handleArchiveProject(project.id);
                        }}
                      >
                        <ArchiveIcon className="w-4 h-4 mr-2" />
                        Archive
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteProject(project.id);
                      }}
                      className="text-destructive focus:text-destructive"
                    >
                      <TrashIcon className="w-4 h-4 mr-2" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </CardHeader>
              <CardContent className="space-y-4 flex flex-col flex-1">
                <p className="text-sm text-muted-foreground line-clamp-2 min-h-[2.5rem]">
                  {project.description || "No description"}
                </p>
                <div className="flex items-center justify-between text-xs text-muted-foreground mt-auto">
                  <div className="flex items-center gap-1">
                    <CalendarIcon className="w-3.5 h-3.5" />
                    {project.createdDate}
                  </div>
                  <div className="flex items-center gap-1">
                    <TeamIcon className="w-3.5 h-3.5" />
                    {project.teamMembers}
                  </div>
                </div>
                <div className="border-t border-border/50 pt-3">
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <ConsultIcon className="w-3.5 h-3.5" />
                      <span>{project.conversations.length} chats</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <ManuscriptIcon className="w-3.5 h-3.5" />
                      <span>{project.files.length} files</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {showCreateModal && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => setShowCreateModal(false)}
        >
          <Card
            className="w-full max-w-md shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle>Create New Project</CardTitle>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <CloseIcon className="w-5 h-5" />
              </button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="name">Project Name</Label>
                <Input
                  id="name"
                  placeholder="e.g., Windtech Farm Phase 1"
                  value={newProject.name}
                  onChange={(e) =>
                    setNewProject({ ...newProject, name: e.target.value })
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreateProject();
                  }}
                  autoFocus
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  placeholder="Project description..."
                  value={newProject.description}
                  onChange={(e) =>
                    setNewProject({
                      ...newProject,
                      description: e.target.value,
                    })
                  }
                  className="mt-1"
                  rows={3}
                />
              </div>
              <div className="flex gap-2 pt-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setShowCreateModal(false)}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1"
                  onClick={handleCreateProject}
                  disabled={!newProject.name.trim()}
                >
                  Create Project
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
