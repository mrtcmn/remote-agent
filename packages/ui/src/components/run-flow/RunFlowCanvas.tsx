import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type EdgeChange,
  type OnConnect,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { RunFlowNodeCard, type RunFlowNodeData } from './RunFlowNodeCard';
import type { RunFlowDetail, RunFlowNodeStatus, RunConfig, UpdateRunFlowInput } from '@/lib/api';

const NODE_TYPES = { runConfig: RunFlowNodeCard };

interface Props {
  flow: RunFlowDetail;
  statusByNode: Map<string, RunFlowNodeStatus>;
  runConfigsById: Map<string, RunConfig>;
  projectLabelByConfigId: Map<string, string>;
  onPersist: (patch: UpdateRunFlowInput) => void;
  onAddRunConfig: (runConfigId: string, position: { x: number; y: number }) => void;
  onStart: (runConfigId: string) => void;
  onStartDownstream: (nodeId: string) => void;
  onStop: (runConfigId: string) => void;
  onRestart: (runConfigId: string) => void;
  onOpenTerminal: (terminalId: string) => void;
  busyConfigId: string | null;
}

function buildNodes(props: Props): Node[] {
  const downstreamSources = new Set(props.flow.edges.map((e) => e.sourceNodeId));
  return props.flow.nodes.map((n) => {
    const config = props.runConfigsById.get(n.runConfigId);
    const status = props.statusByNode.get(n.id);
    const isRunning = !!status?.isRunning || !!config?.isRunning;
    const activeTerminalId = status?.activeTerminalId ?? config?.activeTerminalId ?? null;
    const projectLabel = props.projectLabelByConfigId.get(n.runConfigId) || '—';

    const data: RunFlowNodeData = {
      runConfig: config,
      projectLabel,
      isRunning,
      activeTerminalId,
      hasDownstream: downstreamSources.has(n.id),
      onStart: () => props.onStart(n.runConfigId),
      onStartDownstream: () => props.onStartDownstream(n.id),
      onStop: () => props.onStop(n.runConfigId),
      onRestart: () => props.onRestart(n.runConfigId),
      onOpenTerminal: props.onOpenTerminal,
      isBusy: props.busyConfigId === n.runConfigId,
    };
    return {
      id: n.id,
      type: 'runConfig',
      position: { x: n.x, y: n.y },
      data: data as unknown as Record<string, unknown>,
    };
  });
}

function buildEdges(flow: RunFlowDetail): Edge[] {
  return flow.edges.map((e) => ({
    id: e.id,
    source: e.sourceNodeId,
    target: e.targetNodeId,
    animated: true,
  }));
}

function CanvasInner(props: Props) {
  const { flow, onPersist, onAddRunConfig } = props;
  const initialNodes = useMemo(() => buildNodes(props), [props]);
  const initialEdges = useMemo(() => buildEdges(flow), [flow]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const rfInstance = useReactFlow();
  const wrapper = useRef<HTMLDivElement>(null);

  // Keep node data in sync when status/configs/handlers change without
  // resetting positions (positions are user-controlled).
  useEffect(() => {
    setNodes((prev) => {
      const built = buildNodes(props);
      const byId = new Map(built.map((n) => [n.id, n]));
      return prev.map((n) => {
        const next = byId.get(n.id);
        if (!next) return n;
        return { ...n, data: next.data };
      });
    });
  }, [props.statusByNode, props.runConfigsById, props.busyConfigId, setNodes]);

  // Re-sync entirely when the flow's node/edge identity changes (add/remove).
  useEffect(() => {
    setNodes(buildNodes(props));
    setEdges(buildEdges(flow));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow.nodes.length, flow.edges.length, flow.id]);

  const persistNodes = useCallback(() => {
    onPersist({
      nodes: nodes.map((n) => ({
        id: n.id,
        runConfigId: flow.nodes.find((fn) => fn.id === n.id)?.runConfigId ?? '',
        x: n.position.x,
        y: n.position.y,
      })),
    });
  }, [nodes, flow.nodes, onPersist]);

  const persistEdges = useCallback(
    (next: Edge[]) => {
      onPersist({
        edges: next.map((e) => ({
          id: e.id,
          sourceNodeId: e.source,
          targetNodeId: e.target,
        })),
      });
    },
    [onPersist],
  );

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      onNodesChange(changes);
      const settled = changes.some(
        (c) => c.type === 'position' && c.dragging === false,
      );
      const removed = changes.some((c) => c.type === 'remove');
      if (settled || removed) {
        queueMicrotask(persistNodes);
      }
    },
    [onNodesChange, persistNodes],
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      onEdgesChange(changes);
      const removed = changes.some((c) => c.type === 'remove');
      if (removed) {
        queueMicrotask(() => persistEdges(edges));
      }
    },
    [onEdgesChange, persistEdges, edges],
  );

  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) => {
        const next = addEdge({ ...connection, animated: true }, eds);
        queueMicrotask(() => persistEdges(next));
        return next;
      });
    },
    [setEdges, persistEdges],
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const runConfigId = e.dataTransfer.getData('application/run-config-id');
      if (!runConfigId || !wrapper.current) return;
      const bounds = wrapper.current.getBoundingClientRect();
      const position = rfInstance.screenToFlowPosition({
        x: e.clientX - bounds.left,
        y: e.clientY - bounds.top,
      });
      onAddRunConfig(runConfigId, position);
    },
    [rfInstance, onAddRunConfig],
  );

  const onMoveEnd = useCallback(
    (_: unknown, viewport: { x: number; y: number; zoom: number }) => {
      onPersist({ viewport });
    },
    [onPersist],
  );

  return (
    <div ref={wrapper} className="h-full w-full" onDragOver={onDragOver} onDrop={onDrop}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={onConnect}
        onMoveEnd={onMoveEnd}
        nodeTypes={NODE_TYPES}
        defaultViewport={flow.viewport ?? { x: 0, y: 0, zoom: 1 }}
        fitView={!flow.viewport && flow.nodes.length > 0}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={16} size={1} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable className="!bg-card" maskColor="rgba(0,0,0,0.4)" />
      </ReactFlow>
    </div>
  );
}

export function RunFlowCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
