import { llmEngine } from '../../llm-engine';
import type { ClassificationInput, ClassificationResult, NotificationClassification, ParsedOption } from './types';

const VALID_CLASSIFICATIONS: NotificationClassification[] = [
  'question',
  'permission',
  'task_complete',
  'error',
  'progress_update',
  'idle',
];

const SYSTEM_PROMPT = `You are a notification classifier for a remote coding agent platform.
Your job is to analyze messages from Claude Code (an AI coding assistant) and:
1. Classify the message type
2. Extract the EXACT options/choices presented to the user

Respond ONLY with valid JSON matching this schema:
{
  "classifications": string[],
  "confidence": number,
  "summary": string,
  "requiresUserAction": boolean,
  "options": [
    { "label": string, "value": string, "isDefault": boolean }
  ],
  "freeformAllowed": boolean
}

## Classifications (one or more)
- "question": Claude is asking the user to make a choice or provide information
- "permission": Claude needs approval to run a command, edit a file, etc.
- "task_complete": Claude finished the requested work
- "error": Claude hit an error it cannot resolve alone
- "progress_update": Claude is sharing status but doesn't need input
- "idle": Claude stopped but isn't asking for anything specific

## Options extraction rules
This is critical — extract the REAL options from the message, not generic yes/no.

Examples:
- Permission prompt "Allow claude to run 'npm test'?" with choices [Allow once, Allow for session, Deny]
  → options: [{"label":"Allow once","value":"allow_once"},{"label":"Allow for session","value":"allow_session"},{"label":"Deny","value":"deny"}]
- "Which framework? React, Vue, or Svelte?"
  → options: [{"label":"React","value":"react"},{"label":"Vue","value":"vue"},{"label":"Svelte","value":"svelte"}]
- "Should I proceed with the refactoring?"
  → options: [{"label":"Yes, proceed","value":"yes"},{"label":"No, stop","value":"no"}], freeformAllowed: true
- "What's the API endpoint URL?"
  → options: [], freeformAllowed: true (open-ended question, no fixed choices)
- "Task completed successfully"
  → options: [], freeformAllowed: false

## freeformAllowed
Set to true when the user can type a custom response (not just pick from options).
Questions like "what do you think?" or "any other changes?" allow freeform.
Permission prompts with fixed choices do NOT allow freeform.

Keep summary under 100 characters — it goes in a push notification.`;

export class NotificationClassifier {
  async classify(input: ClassificationInput): Promise<ClassificationResult> {
    const prompt = this.buildPrompt(input);

    try {
      const response = await llmEngine.completeJSON<ClassificationResult>({
        prompt,
        systemPrompt: SYSTEM_PROMPT,
      });

      if (response.structured) {
        return this.validate(response.structured);
      }

      return this.fallbackClassify(input);
    } catch (error) {
      console.error('[NotificationClassifier] LLM classification failed, using fallback:', error);
      return this.fallbackClassify(input);
    }
  }

  private buildPrompt(input: ClassificationInput): string {
    let prompt = `Classify this Claude Code message and extract all options:\n\n---\n${input.message}\n---`;

    if (input.hookEvent) {
      prompt += `\n\nHook event: ${input.hookEvent}`;
    }
    if (input.stopReason) {
      prompt += `\nStop reason: ${input.stopReason}`;
    }
    if (input.transcriptSummary) {
      prompt += `\nTranscript context: ${input.transcriptSummary}`;
    }

    return prompt;
  }

  private validate(result: ClassificationResult): ClassificationResult {
    const validClassifications = (result.classifications || []).filter(
      (c): c is NotificationClassification => VALID_CLASSIFICATIONS.includes(c as NotificationClassification)
    );

    // Validate options
    const options: ParsedOption[] = (result.options || [])
      .filter(o => o && typeof o.label === 'string' && o.label.length > 0)
      .map(o => ({
        label: o.label.slice(0, 100),
        value: o.value || o.label.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
        isDefault: o.isDefault ?? false,
      }));

    return {
      classifications: validClassifications.length > 0 ? validClassifications : ['idle'],
      confidence: Math.max(0, Math.min(1, result.confidence || 0.5)),
      summary: (result.summary || 'Agent update').slice(0, 100),
      requiresUserAction: result.requiresUserAction ?? validClassifications.some(
        c => c === 'question' || c === 'permission' || c === 'error'
      ),
      options,
      freeformAllowed: result.freeformAllowed ?? options.length === 0,
    };
  }

  private fallbackClassify(input: ClassificationInput): ClassificationResult {
    const msg = input.message;
    const msgLower = msg.toLowerCase();
    const classifications: NotificationClassification[] = [];
    const options: ParsedOption[] = [];
    let freeformAllowed = false;

    // Detect permission prompts and extract options
    if (msgLower.includes('permission') || msgLower.includes('allow') || msgLower.includes('approve')) {
      classifications.push('permission');
      // Common Claude Code permission options
      if (msgLower.includes('allow once') || msgLower.includes('allow for')) {
        options.push(
          { label: 'Allow once', value: 'allow_once' },
          { label: 'Allow for session', value: 'allow_session' },
          { label: 'Deny', value: 'deny' },
        );
      } else {
        options.push(
          { label: 'Approve', value: 'approve' },
          { label: 'Deny', value: 'deny' },
        );
      }
    }

    // Detect questions and try to extract options
    if (msg.includes('?')) {
      classifications.push('question');

      // Try to extract numbered options (1. Option, 2. Option)
      const numberedPattern = /(?:^|\n)\s*(\d+)[.)]\s*(.+)/g;
      let match;
      while ((match = numberedPattern.exec(msg)) !== null) {
        options.push({
          label: match[2].trim(),
          value: match[2].trim().toLowerCase().replace(/[^a-z0-9]+/g, '_'),
        });
      }

      // Try bullet options (- Option, * Option)
      if (options.length === 0) {
        const bulletPattern = /(?:^|\n)\s*[-*•]\s*(.+)/g;
        while ((match = bulletPattern.exec(msg)) !== null) {
          const label = match[1].trim();
          if (label.length > 0 && label.length < 100) {
            options.push({
              label,
              value: label.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
            });
          }
        }
      }

      // Try comma/or-separated options ("React, Vue, or Svelte")
      if (options.length === 0) {
        const orMatch = msg.match(/(?:^|\s)([\w\s]+(?:,\s*[\w\s]+)*(?:,?\s*or\s+[\w\s]+))\s*\?/i);
        if (orMatch) {
          const parts = orMatch[1].split(/,\s*|\s+or\s+/i).map(s => s.trim()).filter(Boolean);
          if (parts.length >= 2 && parts.length <= 10) {
            for (const part of parts) {
              options.push({
                label: part,
                value: part.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
              });
            }
          }
        }
      }

      // If no structured options found, it's a freeform question
      freeformAllowed = options.length === 0 || !msgLower.includes('choose') && !msgLower.includes('select');
    }

    if (msgLower.includes('error') || msgLower.includes('failed') || msgLower.includes('cannot')) {
      classifications.push('error');
      freeformAllowed = true;
    }

    if (input.hookEvent === 'Stop' || msgLower.includes('complete') || msgLower.includes('done') || msgLower.includes('finished')) {
      classifications.push('task_complete');
    }

    if (classifications.length === 0) {
      classifications.push('idle');
    }

    const requiresUserAction = classifications.some(
      c => c === 'question' || c === 'permission' || c === 'error'
    );

    return {
      classifications,
      confidence: 0.4,
      summary: input.message.slice(0, 100),
      requiresUserAction,
      options,
      freeformAllowed,
    };
  }
}

export const notificationClassifier = new NotificationClassifier();
