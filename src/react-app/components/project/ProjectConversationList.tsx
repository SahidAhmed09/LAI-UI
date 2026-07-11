import { MessageSquare, ChevronRight, Sparkles } from "lucide-react";
import { ProjectConversation } from "./types";

interface ProjectConversationListProps {
  conversations: ProjectConversation[];
  onSelectConversation: (id: string) => void;
}

export function ProjectConversationList({
  conversations,
  onSelectConversation,
}: ProjectConversationListProps) {
  return (
    <div className="h-full flex flex-col rounded-2xl border border-border/50 bg-card/40 backdrop-blur overflow-hidden">
      {/* Card header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40 flex-shrink-0">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Conversations</span>
          {conversations.length > 0 && (
            <span className="text-xs font-medium text-muted-foreground bg-muted/60 rounded-full px-2 py-0.5">
              {conversations.length}
            </span>
          )}
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 min-h-0 overflow-y-auto p-2">
        {conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full min-h-[180px] text-center px-6">
            <div className="p-3 rounded-full bg-primary/10 mb-3">
              <Sparkles className="w-6 h-6 text-primary" />
            </div>
            <p className="text-sm font-medium text-foreground">
              No conversations yet
            </p>
            <p className="text-muted-foreground/70 text-xs mt-1 max-w-[15rem]">
              Ask a question in the box below and your thread will appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {conversations.map((conv, idx) => {
              const msgCount = conv.messages.length;
              return (
                <button
                  key={conv.id}
                  onClick={() => onSelectConversation(conv.id)}
                  style={{ animationDelay: `${Math.min(idx, 8) * 35}ms` }}
                  className="w-full text-left flex items-start gap-3 rounded-xl border border-transparent px-3 py-2.5 transition-all hover:bg-background/70 hover:border-border/60 hover:shadow-sm group animate-in fade-in slide-in-from-bottom-1 fill-mode-both"
                >
                  <div className="mt-0.5 flex-shrink-0 w-8 h-8 rounded-lg bg-muted/50 group-hover:bg-primary/10 flex items-center justify-center transition-colors">
                    <MessageSquare className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
                        {conv.title}
                      </p>
                      <span className="text-xs text-muted-foreground/60 shrink-0">
                        {conv.timestamp}
                      </span>
                    </div>
                    {conv.lastMessage && (
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {conv.lastMessage}
                      </p>
                    )}
                    {msgCount > 0 && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/50 mt-1">
                        {msgCount} message{msgCount === 1 ? "" : "s"}
                      </span>
                    )}
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground/30 group-hover:text-primary self-center shrink-0 transition-all group-hover:translate-x-0.5" />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
