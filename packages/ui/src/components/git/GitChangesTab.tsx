import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { parseDiffFromFile } from '@pierre/diffs';
import { FileDiff } from '@pierre/diffs/react';
import {
  FileCode,
  FileWarning,
  Loader2,
  Plus,
  Minus,
  Circle,
  ChevronDown,
  ChevronRight,
  History,
  Search,
  X,
  Columns2,
  Rows2,
  WrapText,
  MessageSquare,
  GitCommit,
  Pencil,
  Save,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/Toaster';
import { ReviewBatchPanel } from '../ReviewBatchPanel';
import { type ReviewTarget } from '../review/ReviewComposer';
import { useLineComments } from '../review/useLineComments';
import { ChangeTree, type ChangeEntry } from './ChangeTree';
import {
  MultiFileDiff,
  SinglePatchDiff,
  useDiffOptions,
  DEFAULT_DIFF_SETTINGS,
  type DiffViewSettings,
} from './DiffRenderer';

const SETTINGS_KEY = 'git-diff-view-settings';

function loadSettings(): DiffViewSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_DIFF_SETTINGS, ...JSON.parse(raw) } : DEFAULT_DIFF_SETTINGS;
  } catch {
    return DEFAULT_DIFF_SETTINGS;
  }
}

/** GitHub-style five-block bar showing the add/delete ratio of a file. */
function DiffStatBar({ added, deleted }: { added: number; deleted: number }) {
  const total = added + deleted;
  const greens = total === 0 ? 0 : Math.max(1, Math.round((added / total) * 5));
  return (
    <span className="inline-flex gap-[2px] shrink-0" title={`+${added} −${deleted}`}>
      {Array.from({ length: 5 }, (_, i) => (
        <span
          key={i}
          className={cn(
            'h-2 w-2 rounded-[1px]',
            total === 0 ? 'bg-muted' : i < greens ? 'bg-emerald-500' : 'bg-rose-500'
          )}
        />
      ))}
    </span>
  );
}

const toastOk = (title: string) => toast({ title });
const toastError = (title: string, e: unknown) =>
  toast({ title, description: (e as Error).message, variant: 'destructive' });

interface GitChangesTabProps {
  sessionId: string;
  projectId?: string;
  /** Name of the live agent terminal, used to label the "open session" target. */
  currentTargetLabel?: string;
  onProceed?: (message: string, target: ReviewTarget) => void;
  /** File to select from outside. A new object re-selects the same path. */
  openFile?: { path: string } | null;
}

export function GitChangesTab({
  sessionId,
  projectId,
  currentTargetLabel,
  onProceed,
  openFile,
}: GitChangesTabProps) {
  const queryClient = useQueryClient();
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [commitMessage, setCommitMessage] = useState('');
  const [showStaged, setShowStaged] = useState(true);
  const [showChanges, setShowChanges] = useState(true);
  const [showBatchPanel, setShowBatchPanel] = useState(false);
  const [filter, setFilter] = useState('');
  const [settings, setSettings] = useState<DiffViewSettings>(loadSettings);

  useEffect(() => {
    if (openFile) setSelectedFile(openFile.path);
  }, [openFile]);

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  const diffOptions = useDiffOptions(settings);

  const {
    comments,
    batches,
    rerunBatch,
    annotationsFor,
    renderAnnotation,
    gutterFor,
    popoverElement,
    composer,
  } = useLineComments(sessionId, { currentTargetLabel, onProceed });

  const { data: gitStatus, isLoading: statusLoading } = useQuery({
    queryKey: ['session-git-status', sessionId, projectId],
    queryFn: () => api.getSessionGitStatus(sessionId, projectId),
    refetchInterval: 3000,
  });

  const { data: diffData, isLoading: diffLoading } = useQuery({
    queryKey: ['session-file-diff', sessionId, selectedFile, projectId],
    queryFn: () => api.getSessionFileDiff(sessionId, selectedFile!, projectId, gitStatus?.renamed?.[selectedFile!]),
    enabled: !!selectedFile,
  });

  const stagedFiles = gitStatus?.staged || [];
  const modifiedFiles = gitStatus?.modified || [];
  const untrackedFiles = gitStatus?.untracked || [];
  const changedFiles = useMemo(() => [...modifiedFiles, ...untrackedFiles], [modifiedFiles, untrackedFiles]);
  const hasChanges = stagedFiles.length > 0 || changedFiles.length > 0;
  const stats = gitStatus?.stats;

  const { data: fullDiff, isLoading: fullDiffLoading } = useQuery({
    queryKey: ['session-git-diff', sessionId, projectId],
    queryFn: () => api.getSessionGitDiff(sessionId, false, projectId),
    enabled: false, // ponytail: all-changes view removed, too heavy to render
  });

  const invalidateGit = () => {
    queryClient.invalidateQueries({ queryKey: ['session-git-status', sessionId, projectId] });
    queryClient.invalidateQueries({ queryKey: ['session-git-diff', sessionId, projectId] });
    queryClient.invalidateQueries({ queryKey: ['session-git-log', sessionId, projectId] });
  };

  const stageMutation = useMutation({
    mutationFn: (files: string[]) => api.gitStage(sessionId, files, projectId),
    onSuccess: invalidateGit,
    onError: (e) => toastError('Stage failed', e),
  });

  const unstageMutation = useMutation({
    mutationFn: (files: string[]) => api.gitUnstage(sessionId, files, projectId),
    onSuccess: invalidateGit,
    onError: (e) => toastError('Unstage failed', e),
  });

  const commitMutation = useMutation({
    mutationFn: (message: string) => api.gitCommit(sessionId, message, projectId),
    onSuccess: () => {
      setCommitMessage('');
      setSelectedFile(null);
      invalidateGit();
      toastOk('Committed');
    },
    onError: (e) => toastError('Commit failed', e),
  });

  /** Comment counts per file, for the sidebar badges. */
  const commentCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of comments) {
      if (c.status === 'resolved') continue;
      counts.set(c.filePath, (counts.get(c.filePath) ?? 0) + 1);
    }
    return counts;
  }, [comments]);

  // Pierre resets a diff when a prop changes identity, so keep every prop below
  // stable: annotations by content, the gutter per file, the edit handler forever.
  const annotationsKey = JSON.stringify(selectedFile ? annotationsFor(selectedFile) : []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const lineAnnotations = useMemo(() => JSON.parse(annotationsKey), [annotationsKey]);
  const selectedGutter = useMemo(
    () => (selectedFile ? gutterFor(selectedFile) : undefined),
    [selectedFile, gutterFor]
  );
  const onEditChange = useCallback((event: { editor: { getText(): string } }) => {
    editorRef.current = event.editor;
    setDirty(true);
  }, []);

  // ── Edit mode: the single-file diff becomes an editor of the new file ──
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const editorRef = useRef<{ getText(): string } | null>(null);
  useEffect(() => {
    setEditing(false);
  }, [selectedFile]);
  useEffect(() => {
    editorRef.current = null;
    setDirty(false);
  }, [editing]);

  const { data: editContents } = useQuery({
    queryKey: ['session-file-diff-contents', sessionId, selectedFile, projectId],
    queryFn: () => api.getSessionFileDiffContents(sessionId, selectedFile!, projectId, gitStatus?.renamed?.[selectedFile!]),
    enabled: editing && !!selectedFile,
    // Fetch fresh for every edit session; never swap the base under the editor.
    gcTime: 0,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  const editFileDiff = useMemo(() => {
    if (!selectedFile || !editContents || editContents.newContent === null) return null;
    return parseDiffFromFile(
      { name: selectedFile, contents: editContents.oldContent },
      { name: selectedFile, contents: editContents.newContent }
    );
  }, [selectedFile, editContents]);

  const saveMutation = useMutation({
    mutationFn: () => api.saveSessionGitFile(sessionId, selectedFile!, editorRef.current!.getText(), projectId),
    onSuccess: () => {
      setEditing(false);
      invalidateGit();
      queryClient.invalidateQueries({ queryKey: ['session-file-diff', sessionId, selectedFile, projectId] });
      queryClient.invalidateQueries({ queryKey: ['session-file-content', sessionId] });
      toastOk('Saved');
    },
    onError: (e) => toastError('Save failed', e),
  });

  const save = () => {
    if (editorRef.current && !saveMutation.isPending) saveMutation.mutate();
  };

  const matchesFilter = useCallback(
    (file: string) => !filter || file.toLowerCase().includes(filter.toLowerCase()),
    [filter]
  );

  const stagedEntries: ChangeEntry[] = useMemo(
    () => stagedFiles.filter(matchesFilter).map((path) => ({ path, status: 'staged' as const, renamedFrom: gitStatus?.renamed?.[path] })),
    [stagedFiles, matchesFilter, gitStatus?.renamed]
  );

  const changedEntries: ChangeEntry[] = useMemo(
    () => [
      ...modifiedFiles.filter(matchesFilter).map((path) => ({ path, status: 'modified' as const })),
      ...untrackedFiles.filter(matchesFilter).map((path) => ({ path, status: 'untracked' as const })),
    ],
    [modifiedFiles, untrackedFiles, matchesFilter]
  );

  const visibleCount = stagedEntries.length + changedEntries.length;

  const totals = useMemo(() => {
    let added = 0;
    let deleted = 0;
    for (const s of Object.values(stats ?? {})) {
      added += s.added;
      deleted += s.deleted;
    }
    return { added, deleted };
  }, [stats]);

  const fileCount = new Set([...stagedFiles, ...changedFiles]).size;
  const firstFile = stagedFiles[0] ?? changedFiles[0] ?? null;
  const selectedGone = !!selectedFile && !stagedFiles.includes(selectedFile) && !changedFiles.includes(selectedFile);
  useEffect(() => {
    if (!selectedFile || selectedGone) setSelectedFile(firstFile);
  }, [selectedFile, selectedGone, firstFile]);

  return (
    <div className="flex flex-1 min-h-0">
      {/* ── Sidebar: commit, filter, file list ─────────────────────── */}
      <div className="w-[268px] border-r bg-card/20 flex flex-col shrink-0">
        <div className="p-2.5 border-b space-y-2">
          <textarea
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            placeholder="Commit message…"
            className="w-full h-[68px] px-2.5 py-2 rounded-md border border-input bg-background/60 text-xs font-mono resize-none focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
            onKeyDown={(e) => {
              if (
                e.key === 'Enter' &&
                (e.metaKey || e.ctrlKey) &&
                commitMessage.trim() &&
                stagedFiles.length > 0
              ) {
                commitMutation.mutate(commitMessage.trim());
              }
            }}
          />
          <Button
            size="sm"
            className="w-full h-7 text-xs gap-1.5"
            disabled={!commitMessage.trim() || stagedFiles.length === 0 || commitMutation.isPending}
            onClick={() => commitMutation.mutate(commitMessage.trim())}
          >
            {commitMutation.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <GitCommit className="h-3 w-3" />
            )}
            Commit {stagedFiles.length > 0 && `(${stagedFiles.length})`}
          </Button>
        </div>

        {hasChanges && (
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b">
            <div className="relative flex-1">
              <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter files"
                className="w-full h-6 pl-6 pr-6 rounded border border-input bg-background/60 text-[11px] focus:outline-none focus:ring-1 focus:ring-ring"
              />
              {filter && (
                <button
                  onClick={() => setFilter('')}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
        )}

        {hasChanges && (
          <div className="flex gap-1 px-2.5 py-1.5 border-b">
            {changedFiles.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[10px] px-2"
                onClick={() => stageMutation.mutate(changedFiles)}
                disabled={stageMutation.isPending}
              >
                <Plus className="h-3 w-3 mr-1" />
                Stage all
              </Button>
            )}
            {stagedFiles.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[10px] px-2"
                onClick={() => unstageMutation.mutate(stagedFiles)}
                disabled={unstageMutation.isPending}
              >
                <Minus className="h-3 w-3 mr-1" />
                Unstage all
              </Button>
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {statusLoading && !gitStatus ? (
            <div className="flex items-center justify-center p-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : !hasChanges ? (
            <div className="flex flex-col items-center justify-center p-8 text-muted-foreground">
              <Circle className="h-8 w-8 mb-2 opacity-30" />
              <p className="text-xs font-mono">No changes</p>
            </div>
          ) : (
            <>
              {visibleCount === 0 && (
                <p className="px-3 py-6 text-center text-[11px] text-muted-foreground">
                  No file matches “{filter}”
                </p>
              )}

              {stagedEntries.length > 0 && (
                <FileGroup
                  label="Staged"
                  count={stagedEntries.length}
                  tone="text-emerald-400 bg-emerald-500/15"
                  open={showStaged}
                  onToggle={() => setShowStaged(!showStaged)}
                >
                  <ChangeTree
                    entries={stagedEntries}
                    stats={stats}
                    commentCounts={commentCounts}
                    selectedFile={selectedFile}
                    expandAll={!!filter}
                    onSelect={setSelectedFile}
                    onStage={(paths) => stageMutation.mutate(paths)}
                    onUnstage={(paths) => unstageMutation.mutate(paths)}
                    busy={stageMutation.isPending || unstageMutation.isPending}
                  />
                </FileGroup>
              )}

              {changedEntries.length > 0 && (
                <FileGroup
                  label="Changes"
                  count={changedEntries.length}
                  tone="text-amber-400 bg-amber-500/15"
                  open={showChanges}
                  onToggle={() => setShowChanges(!showChanges)}
                >
                  <ChangeTree
                    entries={changedEntries}
                    stats={stats}
                    commentCounts={commentCounts}
                    selectedFile={selectedFile}
                    expandAll={!!filter}
                    onSelect={setSelectedFile}
                    onStage={(paths) => stageMutation.mutate(paths)}
                    onUnstage={(paths) => unstageMutation.mutate(paths)}
                    busy={stageMutation.isPending || unstageMutation.isPending}
                  />
                </FileGroup>
              )}
            </>
          )}
        </div>

        {/* Totals + review history */}
        <div className="border-t px-2.5 py-1.5 flex items-center gap-2 text-[11px] font-mono">
          {hasChanges && (
            <>
              <span className="text-emerald-400">+{totals.added}</span>
              <span className="text-rose-400">−{totals.deleted}</span>
              <span className="text-muted-foreground">
                {fileCount} {fileCount === 1 ? 'file' : 'files'}
              </span>
            </>
          )}
          <div className="flex-1" />
          <button
            onClick={() => setShowBatchPanel(true)}
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
            title="Review history"
          >
            <History className="h-3.5 w-3.5" />
            {batches.length > 0 && <span>{batches.length}</span>}
          </button>
        </div>
      </div>

      {/* ── Diff pane ──────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 flex flex-col">
        <DiffHeader
          selectedFile={selectedFile}
          fileCount={fileCount}
          stat={selectedFile ? stats?.[selectedFile] : undefined}
          commentCount={selectedFile ? commentCounts.get(selectedFile) ?? 0 : comments.length}
          settings={settings}
          onSettings={setSettings}
          edit={
            selectedFile
              ? {
                  editing,
                  dirty,
                  saving: saveMutation.isPending,
                  onEdit: () => setEditing(true),
                  onSave: save,
                  onCancel: () => setEditing(false),
                }
              : undefined
          }
        />

        <div
          className="flex-1 min-h-0 overflow-auto"
          style={{ background: 'var(--code-bg, #0d1117)' }}
          onKeyDown={(e) => {
            if (editing && e.key === 's' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              save();
            }
          }}
        >
          {editing ? (
            editFileDiff ? (
              <FileDiff
                fileDiff={editFileDiff}
                options={diffOptions as never}
                edit
                onEditChange={onEditChange}
                lineAnnotations={lineAnnotations}
                renderAnnotation={renderAnnotation}
                renderGutterUtility={selectedGutter}
              />
            ) : editContents ? (
              <p className="p-6 text-center text-xs text-muted-foreground">
                This file was deleted. There is nothing to edit.
              </p>
            ) : (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )
          ) : diffLoading || (!selectedFile && fullDiffLoading) ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : selectedFile && diffData?.diff ? (
            <SinglePatchDiff
              patch={diffData.diff}
              fileName={selectedFile}
              options={diffOptions}
              lineAnnotations={lineAnnotations}
              renderAnnotation={renderAnnotation}
              renderGutterUtility={selectedGutter}
            />
          ) : !selectedFile && fullDiff?.diff ? (
            <MultiFileDiff
              diff={fullDiff.diff}
              options={diffOptions}
              getLineAnnotationsForFile={annotationsFor}
              renderAnnotation={renderAnnotation}
              createRenderGutterUtility={gutterFor}
              onSelectFile={setSelectedFile}
            />
          ) : selectedFile ? (
            // The file was selected and the request finished, but git produced no
            // patch. Say so — silently showing the "pick a file" hint here reads
            // as if the click did nothing.
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2 px-6 text-center">
              <FileWarning className="h-8 w-8 opacity-30" />
              <p className="text-xs font-mono text-foreground/70">{selectedFile}</p>
              <p className="text-xs">
                Git returned no text diff for this file. It is usually binary, or a
                mode/rename-only change.
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
              <FileCode className="h-8 w-8 opacity-30" />
              <p className="text-xs font-mono">
                {hasChanges ? 'Select a file to view changes' : 'Working tree clean'}
              </p>
            </div>
          )}
        </div>

        {composer}
      </div>

      {popoverElement}

      {showBatchPanel && (
        <ReviewBatchPanel
          batches={batches}
          comments={comments}
          onRerun={rerunBatch}
          onClose={() => setShowBatchPanel(false)}
        />
      )}
    </div>
  );
}

/** Sticky bar above the diff: what is shown, its stats, and the render controls. */
function DiffHeader({
  selectedFile,
  fileCount,
  stat,
  commentCount,
  settings,
  onSettings,
  edit,
}: {
  edit?: {
    editing: boolean;
    dirty: boolean;
    saving: boolean;
    onEdit: () => void;
    onSave: () => void;
    onCancel: () => void;
  };
  selectedFile: string | null;
  fileCount: number;
  stat?: { added: number; deleted: number };
  commentCount: number;
  settings: DiffViewSettings;
  onSettings: (s: DiffViewSettings) => void;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b bg-card/40 backdrop-blur-sm shrink-0 text-xs">
      <FileCode className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      {selectedFile ? (
        <>
          <span className="font-mono truncate text-foreground/90" title={selectedFile}>
            {selectedFile}
          </span>
        </>
      ) : (
        <span className="font-mono text-muted-foreground">
          All changes · {fileCount} {fileCount === 1 ? 'file' : 'files'}
        </span>
      )}

      {stat && (
        <>
          <span className="font-mono tabular-nums shrink-0">
            <span className="text-emerald-400">+{stat.added}</span>{' '}
            <span className="text-rose-400">−{stat.deleted}</span>
          </span>
          <DiffStatBar added={stat.added} deleted={stat.deleted} />
        </>
      )}
      {commentCount > 0 && (
        <span className="flex items-center gap-1 text-sky-400 shrink-0">
          <MessageSquare className="h-3 w-3" />
          {commentCount}
        </span>
      )}

      <div className="flex-1" />

      {edit && <EditControls {...edit} />}

      <div className="flex items-center gap-0.5 shrink-0">
        <ToggleButton
          active={settings.diffStyle === 'unified'}
          onClick={() => onSettings({ ...settings, diffStyle: 'unified' })}
          title="Unified view"
        >
          <Rows2 className="h-3.5 w-3.5" />
        </ToggleButton>
        <ToggleButton
          active={settings.diffStyle === 'split'}
          onClick={() => onSettings({ ...settings, diffStyle: 'split' })}
          title="Split view"
        >
          <Columns2 className="h-3.5 w-3.5" />
        </ToggleButton>
        <div className="w-px h-4 bg-border mx-1" />
        <ToggleButton
          active={settings.overflow === 'wrap'}
          onClick={() =>
            onSettings({ ...settings, overflow: settings.overflow === 'wrap' ? 'scroll' : 'wrap' })
          }
          title="Wrap long lines"
        >
          <WrapText className="h-3.5 w-3.5" />
        </ToggleButton>
        <ToggleButton
          active={settings.expandUnchanged}
          onClick={() => onSettings({ ...settings, expandUnchanged: !settings.expandUnchanged })}
          title="Show unchanged context"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </ToggleButton>
      </div>
    </div>
  );
}

/** Edit / Save / Cancel, shared by the diff header and the file viewer. */
export function EditControls({
  editing,
  dirty,
  saving,
  onEdit,
  onSave,
  onCancel,
}: {
  editing: boolean;
  dirty: boolean;
  saving: boolean;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  if (!editing) {
    return (
      <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px] gap-1 shrink-0" onClick={onEdit}>
        <Pencil className="h-3 w-3" />
        Edit
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-1 shrink-0">
      <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={onCancel}>
        Cancel
      </Button>
      <Button
        size="sm"
        className="h-6 px-2 text-[11px] gap-1"
        disabled={!dirty || saving}
        onClick={onSave}
        title="Save (⌘S)"
      >
        {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
        Save
      </Button>
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        'h-6 w-6 rounded flex items-center justify-center transition-colors',
        active
          ? 'bg-accent text-foreground'
          : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
      )}
    >
      {children}
    </button>
  );
}

function FileGroup({
  label,
  count,
  tone,
  open,
  onToggle,
  children,
}: {
  label: string;
  count: number;
  tone: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        onClick={onToggle}
        className="flex items-center gap-1.5 w-full px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:bg-accent/30"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {label}
        <span className={cn('ml-auto text-[10px] px-1.5 rounded-full normal-case', tone)}>{count}</span>
      </button>
      {open && <div className="pb-0.5">{children}</div>}
    </div>
  );
}
