import { useEffect, useRef, useState } from 'react';
import {
  AudioLines, BellRing, CheckCircle2, CircleAlert, Loader2, Mic, MicOff, Plus, Send, Square, Volume2, VolumeX, Wrench, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDictation } from '@/hooks/useDictation';
import { useVoiceConversation } from '@/hooks/useVoiceConversation';
import { useAssistant, type AssistantStep } from '@/hooks/useAssistant';
import {
  Trace, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger, TraceIcon, TraceLine, TraceTitle,
} from '@/components/ui/trace';

/** Human titles for the MCP tools: [while running, when done]. */
const STEP_TITLES: Record<string, [string, string]> = {
  list_machines: ['Checking machines', 'Checked machines'],
  list_projects: ['Looking at projects', 'Looked at projects'],
  list_sessions: ['Checking sessions', 'Checked sessions'],
  show_session: ['Reading session output', 'Read session output'],
  open_session: ['Starting a session', 'Started a session'],
  send_prompt: ['Messaging the agent', 'Messaged the agent'],
  close_session: ['Closing the session', 'Closed the session'],
  handoff_session: ['Handing off the session', 'Handed off the session'],
  list_tasks: ['Checking the board', 'Checked the board'],
  get_task: ['Reading the task', 'Read the task'],
  create_task: ['Creating a task', 'Created a task'],
  update_task: ['Updating the task', 'Updated the task'],
  comment_task: ['Commenting on the task', 'Commented on the task'],
  list_runs: ['Checking runs', 'Checked runs'],
  start_run: ['Starting the run', 'Started the run'],
  stop_run: ['Stopping the run', 'Stopped the run'],
  flow_status: ['Checking the flow', 'Checked the flow'],
  run_flow: ['Running the flow', 'Ran the flow'],
};

function stepTitle(s: AssistantStep) {
  const t = STEP_TITLES[s.tool];
  if (t) return s.status === 'running' ? `${t[0]}…` : t[1];
  const words = s.tool.replace(/_/g, ' ');
  return s.status === 'running' ? `Running ${words}…` : `Ran ${words}`;
}

function StepRow({ step }: { step: AssistantStep }) {
  const status = step.status === 'running' ? 'running' : step.status === 'error' ? 'error' : undefined;
  const icon =
    step.status === 'running' ? <Loader2 className="animate-spin" /> :
    step.status === 'error' ? <CircleAlert /> : <CheckCircle2 />;
  return (
    <TraceCollapsible>
      <TraceCollapsibleTrigger>
        <TraceLine status={status}>
          <TraceIcon>{icon}</TraceIcon>
          <TraceTitle>{stepTitle(step)}</TraceTitle>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        {!!step.input && Object.keys(step.input as object).length > 0 && (
          <div className="flex items-center gap-1 mb-1 text-muted-foreground/70">
            <Wrench className="size-3" />
            <code className="truncate">{JSON.stringify(step.input)}</code>
          </div>
        )}
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[10.5px]">{step.output ?? '…'}</pre>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

const SUGGESTIONS = [
  "What's going on across my sessions?",
  'Is the latest session done? Anything I need to know?',
  "What's on the kanban board right now?",
];

/**
 * The operator: a voice-first teammate in the right rail. The mic button starts
 * a hands-free conversation (Soniox endpointing ends each turn; the mic pauses
 * while the operator thinks and talks). Holding ⌥Space is push-to-talk.
 * Stays mounted while hidden so the conversation survives navigation.
 */
export function AssistantPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const assistant = useAssistant();
  const { ask, stopSpeaking } = assistant;
  const dictation = useDictation((text) => ask(text));
  const convo = useVoiceConversation((u) => ask(u.text, u.language), assistant.busy || assistant.speaking);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Hold ⌥Space anywhere: open the panel and talk; release to send.
  const dictationRef = useRef(dictation);
  dictationRef.current = dictation;
  useEffect(() => {
    let holding = false;
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || !e.altKey || e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      if (holding || e.repeat) return;
      holding = true;
      onOpenChange(true);
      stopSpeaking();
      dictationRef.current.start();
    };
    const up = (e: KeyboardEvent) => {
      if (!holding || (e.code !== 'Space' && e.key !== 'Alt')) return;
      holding = false;
      dictationRef.current.stop();
    };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
    };
  }, [onOpenChange, stopSpeaking]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [assistant.turns, dictation.transcript, convo.partial]);

  const toggleConversation = () => {
    if (convo.active) return convo.stop();
    stopSpeaking();
    convo.start();
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    ask(draft);
    setDraft('');
  };

  const state = dictation.active ? 'Listening'
    : assistant.busy ? 'Thinking'
    : assistant.speaking ? 'Speaking'
    : convo.active ? 'Listening' : 'Ready';
  const error = dictation.error || convo.error || assistant.voiceError;
  const caption = dictation.active ? dictation.transcript : convo.active && state === 'Listening' ? convo.partial : null;

  return (
    <aside
      className={cn('hidden shrink-0 mt-2 w-[360px] flex-col rounded-lg border border-border bg-card overflow-hidden', open && 'md:flex')}
      aria-label="Operator"
    >
      {/* Header */}
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
        <AudioLines className="size-3.5 text-muted-foreground" />
        <span className="text-xs font-medium">Operator</span>
        <span
          className={cn(
            'text-[10px] uppercase tracking-wider',
            state === 'Listening' ? 'text-red-500' : state === 'Ready' ? 'text-muted-foreground/60' : 'text-primary'
          )}
        >
          {state}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <IconBtn label={assistant.muted ? 'Unmute voice' : 'Mute voice'} onClick={() => { stopSpeaking(); assistant.setMuted(!assistant.muted); }}>
            {assistant.muted ? <VolumeX /> : <Volume2 />}
          </IconBtn>
          <IconBtn label="New conversation" onClick={assistant.reset}><Plus /></IconBtn>
          <IconBtn label="Close" onClick={() => onOpenChange(false)}><X /></IconBtn>
        </div>
      </div>

      {/* Conversation */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-4">
        {assistant.turns.length === 0 && caption === null && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <p className="text-xs text-muted-foreground">
              Ask about any session, run or task. Tap the mic to talk hands-free, or hold <kbd className="rounded border border-border px-1 text-[10px]">⌥ Space</kbd>.
            </p>
            <div className="flex flex-col gap-1.5 w-full">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => ask(s)}
                  className="rounded-md border border-border px-2.5 py-1.5 text-left text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {assistant.turns.map((turn) =>
          turn.role === 'user' && turn.auto ? (
            <div key={turn.id} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <BellRing className="size-3" />
              Agent update — checking it
            </div>
          ) : turn.role === 'user' ? (
            <div key={turn.id} className="flex justify-end">
              <div className="max-w-[85%] rounded-lg bg-secondary px-2.5 py-1.5 text-xs">{turn.text}</div>
            </div>
          ) : (
            <div key={turn.id} className="space-y-2">
              {(turn.steps.length > 0 || (turn.pending && !turn.text)) && (
                <Trace>
                  {turn.steps.map((s) => <StepRow key={s.id} step={s} />)}
                  {turn.pending && turn.steps.every((s) => s.status !== 'running') && (
                    <TraceLine status="running">
                      <TraceIcon><Loader2 className="animate-spin" /></TraceIcon>
                      <TraceTitle>Thinking…</TraceTitle>
                    </TraceLine>
                  )}
                </Trace>
              )}
              {turn.text && (
                <p className={cn('text-[13px] leading-relaxed whitespace-pre-wrap', turn.pending && 'text-muted-foreground')}>{turn.text}</p>
              )}
              {turn.error && <p className="text-xs text-destructive">{turn.error}</p>}
            </div>
          )
        )}

        {caption !== null && (
          <div className="flex justify-end">
            <div className="max-w-[85%] rounded-lg border border-dashed border-red-500/50 px-2.5 py-1.5 text-xs text-foreground/80">
              {caption || <span className="text-muted-foreground">Listening…</span>}
            </div>
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="shrink-0 border-t border-border p-2">
        {error && <p className="mb-1.5 px-1 text-[11px] text-destructive">{error}</p>}
        <form onSubmit={submit} className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={toggleConversation}
            aria-label={convo.active ? 'End conversation' : 'Start conversation'}
            title={convo.active ? 'End conversation' : 'Talk hands-free'}
            className={cn(
              'flex size-8 shrink-0 items-center justify-center rounded-full border transition-colors',
              convo.active
                ? cn('border-red-500 bg-red-500 text-white', state === 'Listening' && 'animate-pulse')
                : dictation.active
                  ? 'border-red-500 text-red-500 animate-pulse'
                  : 'border-border text-muted-foreground hover:text-foreground hover:bg-secondary'
            )}
          >
            {convo.active ? <MicOff className="size-3.5" /> : <Mic className="size-3.5" />}
          </button>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ask the operator…"
            className="h-8 flex-1 min-w-0 rounded-md border border-border bg-background px-2.5 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          {assistant.busy || assistant.speaking ? (
            <IconBtn label="Stop" onClick={assistant.cancel} className="size-8"><Square /></IconBtn>
          ) : (
            <IconBtn label="Send" type="submit" disabled={!draft.trim()} className="size-8"><Send /></IconBtn>
          )}
        </form>
      </div>
    </aside>
  );
}

function IconBtn({ label, className, children, ...props }: React.ComponentProps<'button'> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40 [&_svg]:size-3.5',
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}
