import { ProjectFile } from "./types";
import { ProjectFileGrid } from "./ProjectFileGrid";

interface ProjectSidebarProps {
  files: ProjectFile[];
  projectId: string;
  sessionId?: string | null;
  onAddFiles: (projectId: string, files: FileList) => void;
  onDeleteFile: (projectId: string, fileId: string) => void;
}

export function ProjectSidebar({
  files,
  projectId,
  sessionId,
  onAddFiles,
  onDeleteFile,
}: ProjectSidebarProps) {
  return (
    <aside className="w-80 flex-shrink-0 border-l border-border/50 overflow-y-auto p-4 space-y-4 bg-background/50">
      <ProjectFileGrid
        files={files}
        projectId={projectId}
        sessionId={sessionId}
        onAddFiles={onAddFiles}
        onDeleteFile={onDeleteFile}
      />
    </aside>
  );
}
