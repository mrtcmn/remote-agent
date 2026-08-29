import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Loader2, LayoutGrid } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toaster';
import { KanbanBoard } from '@/components/kanban/KanbanBoard';
import { TaskDetailPanel } from '@/components/kanban/TaskDetailPanel';
import { TaskFilters } from '@/components/kanban/TaskFilters';
import { CreateTaskModal } from '@/components/kanban/CreateTaskModal';
import { useKanbanBoard, useKanbanTask, useKanbanMutations, useActiveProject } from '@/hooks/useKanban';
import { filterBoard } from '@/lib/kanban-filter';
import { StartSessionModal } from '@/components/kanban/StartSessionModal';
import { sessionPath } from '@/lib/session-route';
import { getActiveMachineId } from '@/lib/active-machine';
import { useNavigate } from 'react-router-dom';
import type { TerminalType } from '@/lib/api';
import { api, type KanbanTask, type KanbanStatus, type KanbanPriority, type AssigneeType } from '@/lib/api';

export function KanbanPage() {
  // Filter state
  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>();
  const [statusFilter, setStatusFilter] = useState<KanbanStatus[]>([]);
  const [priorityFilter, setPriorityFilter] = useState<KanbanPriority[]>([]);
  const [assigneeFilter, setAssigneeFilter] = useState<AssigneeType | undefined>();
  const [searchQuery, setSearchQuery] = useState('');

  // UI state
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createModalDefaultStatus, setCreateModalDefaultStatus] = useState<KanbanStatus | undefined>();
  const [showSessionModal, setShowSessionModal] = useState(false);
  const [startingSession, setStartingSession] = useState(false);
  const navigate = useNavigate();

  // Data
  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.getProjects(),
  });

  const { data: activeProject } = useActiveProject();
  const { data: boardData, isLoading } = useKanbanBoard(selectedProjectId);
  const { data: selectedTask } = useKanbanTask(selectedTaskId);

  const mutations = useKanbanMutations();

  // Handlers
  const handleTaskClick = (task: KanbanTask) => {
    setSelectedTaskId(task.id);
  };

  const handleMoveTask = (taskId: string, status: KanbanStatus, position: number) => {
    mutations.moveTask.mutate(
      { id: taskId, status, position },
      {
        onError: (error) => {
          toast({ title: 'Error', description: (error as Error).message, variant: 'destructive' });
        },
      },
    );
  };

  const handleQuickAdd = (title: string, status: KanbanStatus) => {
    // The agent runs inside one project directory, so never guess which one.
    // The board filter wins; then the project actually running; then the only
    // project there is. If none of those answer it, ask instead of choosing.
    const runningId = activeProject?.resolved ? activeProject.projectId : undefined;
    const projectId = selectedProjectId ?? runningId ?? (projects.length === 1 ? projects[0].id : undefined);
    if (!projectId) {
      const running = activeProject && !activeProject.resolved ? activeProject.candidates : [];
      toast({
        title: projects.length === 0 ? 'No project available' : 'Which project?',
        description: projects.length === 0
          ? 'Create a project before you add tasks.'
          : running.length > 1
            ? `${running.map(c => c.projectName).join(', ')} are all running. Choose one in the filter bar.`
            : 'Nothing is running, so pick the project in the filter bar. The agent works in its directory.',
        variant: 'destructive',
      });
      return;
    }
    mutations.createTask.mutate(
      {
        projectId,
        title,
        status,
      },
      {
        onError: (error) => {
          toast({ title: 'Error', description: (error as Error).message, variant: 'destructive' });
        },
      },
    );
  };

  const handleCreateTask = (data: Parameters<typeof api.createKanbanTask>[0]) => {
    mutations.createTask.mutate(data, {
      onSuccess: (task) => {
        toast({ title: 'Task created' });
        if (task) setSelectedTaskId(task.id);
      },
      onError: (error) => {
        toast({ title: 'Error', description: (error as Error).message, variant: 'destructive' });
      },
    });
  };

  /**
   * Opens a session on the task and hands the agent the prompt. The session is
   * linked back to the task so the board shows where the work is happening.
   */
  const handleStartSession = async (prompt: string, agent: TerminalType) => {
    if (!selectedTask?.project) return;
    setStartingSession(true);
    try {
      const session = await api.createSession(selectedTask.projectId);
      const terminal = await api.createTerminal({
        sessionId: session.id,
        type: agent,
        initialPrompt: prompt,
        persist: true,
      });
      mutations.updateTask.mutate({ id: selectedTask.id, data: { sessionId: session.id } });
      setShowSessionModal(false);
      navigate(sessionPath(getActiveMachineId(), session.id, terminal.id));
    } catch (error) {
      toast({ title: 'Could not start the session', description: (error as Error).message, variant: 'destructive' });
    } finally {
      setStartingSession(false);
    }
  };

  // Filter the board data client-side for status/priority/assignee/search
  const filteredBoardData = boardData
    ? filterBoard(boardData, {
        status: statusFilter,
        priority: priorityFilter,
        assignee: assigneeFilter,
        search: searchQuery,
      })
    : undefined;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">Kanban Board</h1>
          <p className="text-muted-foreground text-sm">Manage tasks across your projects</p>
        </div>
        <Button className="gap-2" onClick={() => setShowCreateModal(true)}>
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">New Task</span>
        </Button>
      </div>

      {/* Filters */}
      <TaskFilters
        projects={projects}
        selectedProjectId={selectedProjectId}
        onProjectChange={setSelectedProjectId}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        priorityFilter={priorityFilter}
        onPriorityFilterChange={setPriorityFilter}
        assigneeFilter={assigneeFilter}
        onAssigneeFilterChange={setAssigneeFilter}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      />

      {/* Board */}
      <div className="flex-1 mt-4 min-h-0 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : filteredBoardData ? (
          <KanbanBoard
            data={filteredBoardData}
            projectId={selectedProjectId}
            onTaskClick={handleTaskClick}
            onMoveTask={handleMoveTask}
            onQuickAdd={handleQuickAdd}
          />
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <LayoutGrid className="h-12 w-12 mb-4 opacity-50" />
            <p className="font-medium">No board data</p>
            <p className="text-sm">Select a project or create tasks to get started</p>
          </div>
        )}
      </div>

      {/* Task Detail Panel */}
      {selectedTask && (
        <TaskDetailPanel
          task={selectedTask}
          projects={projects}
          onClose={() => setSelectedTaskId(null)}
          onUpdate={(data) => mutations.updateTask.mutate({ id: selectedTask.id, data })}
          onDelete={() => {
            mutations.deleteTask.mutate(selectedTask.id, {
              onSuccess: () => {
                setSelectedTaskId(null);
                toast({ title: 'Task deleted' });
              },
            });
          }}
          onAddComment={(content, parentCommentId) =>
            mutations.addComment.mutate({ taskId: selectedTask.id, content, parentCommentId })
          }
          onResolveComment={(commentId) => mutations.resolveComment.mutate(commentId)}
          onRejectComment={(commentId) => mutations.rejectComment.mutate(commentId)}
          onReopenComment={(commentId) => mutations.reopenComment.mutate(commentId)}
          onDeleteComment={(commentId) => mutations.deleteComment.mutate(commentId)}
          onUploadAttachment={(file, commentId) =>
            mutations.uploadAttachment.mutate({ taskId: selectedTask.id, file, commentId })
          }
          onDeleteAttachment={(id) => mutations.deleteAttachment.mutate(id)}
          onAddDependency={(dependsOnTaskId) =>
            mutations.addDependency.mutate({ taskId: selectedTask.id, dependsOnTaskId })
          }
          onRemoveDependency={(depId) => mutations.removeDependency.mutate(depId)}
          onPlan={() => mutations.planTask.mutate(selectedTask.id, {
            onError: (error) => toast({ title: 'Planner', description: (error as Error).message, variant: 'destructive' }),
          })}
          onExecute={() => mutations.executeTask.mutate(selectedTask.id, {
            onError: (error) => toast({ title: 'Executor', description: (error as Error).message, variant: 'destructive' }),
          })}
          onStartSession={() => setShowSessionModal(true)}
          onToggleChecklistItem={(index, done) =>
            mutations.toggleChecklistItem.mutate({ id: selectedTask.id, index, done })
          }
          onReplaceChecklist={(items) =>
            mutations.setChecklist.mutate({ id: selectedTask.id, items })
          }
        />
      )}

      {/* Start Session Modal */}
      {showSessionModal && selectedTask && (
        <StartSessionModal
          task={selectedTask}
          busy={startingSession}
          onClose={() => setShowSessionModal(false)}
          onStart={handleStartSession}
        />
      )}

      {/* Create Task Modal */}
      {showCreateModal && (
        <CreateTaskModal
          projects={projects}
          defaultProjectId={selectedProjectId}
          defaultStatus={createModalDefaultStatus}
          onClose={() => { setShowCreateModal(false); setCreateModalDefaultStatus(undefined); }}
          onCreate={handleCreateTask}
        />
      )}
    </div>
  );
}
