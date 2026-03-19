export type NotificationClassification =
  | 'question'           // Claude is asking the user a question
  | 'permission'         // Claude needs permission to proceed
  | 'task_complete'      // Claude finished the task
  | 'error'              // Claude encountered an error
  | 'progress_update'    // Claude is reporting progress (no action needed)
  | 'idle';              // Claude stopped but not asking anything

export interface ParsedOption {
  label: string;       // Display text: "Allow once", "PostgreSQL", "Yes, proceed"
  value: string;       // Machine-friendly value to send back: "allow_once", "postgresql", "yes"
  isDefault?: boolean; // If this option appears to be the suggested/default choice
}

export interface ClassificationResult {
  classifications: NotificationClassification[];
  confidence: number;
  summary: string;
  requiresUserAction: boolean;
  options: ParsedOption[];  // Actual choices extracted from the message
  freeformAllowed: boolean; // Whether the user can type a custom response (not just pick an option)
}

export interface ClassificationInput {
  message: string;
  hookEvent: string;
  transcriptSummary?: string;
  stopReason?: string;
}
