import { nanoid } from 'nanoid';
import { llmEngine } from '../llm-engine';
import { gitService } from '../git/git.service';
import {
  PLANNING_SYSTEM_PROMPT,
  NARRATION_SYSTEM_PROMPT,
  buildPlanningPrompt,
  buildNarrationPrompt,
} from './prompts';
import type {
  PresentationRequest,
  SlidePlan,
  SlidePlanEntry,
  PresentationSlide,
  DiffExcerpt,
  SSEEvent,
} from './types';

export class PresentationService {
  /**
   * Collect diffs from the requested sources and return as a single unified diff string.
   */
  async collectDiffs(request: PresentationRequest): Promise<string> {
    const parts: string[] = [];

    if (request.unstaged) {
      const diff = await gitService.unstagedDiff(request.projectPath);
      if (diff.trim()) {
        parts.push(diff);
      }
    }

    if (request.staged) {
      const diff = await gitService.diff(request.projectPath, true);
      if (diff.trim()) {
        parts.push(diff);
      }
    }

    if (request.commitHashes?.length) {
      for (const hash of request.commitHashes) {
        const diff = await gitService.commitDiff(request.projectPath, hash);
        if (diff.trim()) {
          parts.push(diff);
        }
      }
    }

    return parts.join('\n');
  }

  /**
   * Phase 1: Ask LLM to group diffs into logical slides and select key hunks.
   */
  async generatePlan(fullDiff: string): Promise<SlidePlan> {
    const prompt = buildPlanningPrompt(fullDiff);

    const response = await llmEngine.completeJSON<SlidePlan>({
      prompt,
      systemPrompt: PLANNING_SYSTEM_PROMPT,
    });

    if (response.structured) {
      return this.validatePlan(response.structured);
    }

    // Fallback: single slide with all files
    return this.fallbackPlan(fullDiff);
  }

  /**
   * Phase 2: Ask LLM to write a narrative for a single slide.
   */
  async generateSlideNarrative(slide: SlidePlanEntry, excerptDiffs: string): Promise<string> {
    const prompt = buildNarrationPrompt(slide.title, excerptDiffs);

    const response = await llmEngine.complete({
      prompt,
      systemPrompt: NARRATION_SYSTEM_PROMPT,
    });

    return response.content || 'Changes made to the listed files.';
  }

  /**
   * Extract the relevant hunks for a slide from the full diff string.
   * Uses hunkSelectors to pick specific hunks per file.
   */
  extractExcerpts(fullDiff: string, slide: SlidePlanEntry): { excerpts: DiffExcerpt[]; fullSlideDiff: string } {
    const fileDiffs = this.parseFileDiffs(fullDiff);
    const excerpts: DiffExcerpt[] = [];
    const fullParts: string[] = [];

    for (const selector of slide.hunkSelectors) {
      const fileDiff = fileDiffs.get(selector.filePath);
      if (!fileDiff) continue;

      fullParts.push(fileDiff.raw);

      const hunks = fileDiff.hunks;
      const selectedHunks = selector.hunkIndices
        .filter(i => i >= 0 && i < hunks.length)
        .map(i => hunks[i]);

      if (selectedHunks.length > 0) {
        const header = fileDiff.header;
        const patch = [header, ...selectedHunks].join('\n');
        excerpts.push({
          filePath: selector.filePath,
          patch,
          explanation: '',
        });
      }
    }

    // Include files that are in the slide but not in hunkSelectors
    for (const file of slide.files) {
      const fileDiff = fileDiffs.get(file);
      if (fileDiff && !fullParts.includes(fileDiff.raw)) {
        fullParts.push(fileDiff.raw);
      }
      if (!slide.hunkSelectors.some(s => s.filePath === file) && fileDiff) {
        excerpts.push({
          filePath: file,
          patch: fileDiff.raw,
          explanation: '',
        });
      }
    }

    return {
      excerpts,
      fullSlideDiff: fullParts.join('\n'),
    };
  }

  /**
   * Main orchestrator: yields SSE events as slides are generated.
   */
  async *generatePresentation(request: PresentationRequest): AsyncGenerator<SSEEvent> {
    const fullDiff = await this.collectDiffs(request);

    if (!fullDiff.trim()) {
      yield { event: 'error', data: { message: 'No changes to present' } };
      return;
    }

    // Phase 1: Planning
    let plan: SlidePlan;
    try {
      plan = await this.generatePlan(fullDiff);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Planning failed';
      yield { event: 'error', data: { message: `Could not analyze changes: ${msg}` } };
      return;
    }

    yield { event: 'plan', data: plan };

    // Phase 2: Narration — one slide at a time
    for (let i = 0; i < plan.slides.length; i++) {
      const slidePlan = plan.slides[i];
      const { excerpts, fullSlideDiff } = this.extractExcerpts(fullDiff, slidePlan);

      let narrative: string;
      try {
        const excerptText = excerpts.map(e => e.patch).join('\n\n');
        narrative = await this.generateSlideNarrative(slidePlan, excerptText);
      } catch {
        narrative = 'Narrative unavailable — see diff excerpts below.';
      }

      const slide: PresentationSlide = {
        id: nanoid(),
        index: i,
        title: slidePlan.title,
        narrative,
        importance: slidePlan.importance,
        files: slidePlan.files,
        excerpts,
        fullDiff: fullSlideDiff,
        annotations: [],
      };

      yield { event: 'slide', data: slide };
    }

    yield { event: 'done', data: {} };
  }

  /**
   * Parse a unified diff string into per-file sections.
   */
  private parseFileDiffs(fullDiff: string): Map<string, { header: string; hunks: string[]; raw: string }> {
    const result = new Map<string, { header: string; hunks: string[]; raw: string }>();
    const filePattern = /^diff --git a\/(.+?) b\/(.+)$/gm;
    const matches: Array<{ filePath: string; start: number }> = [];

    let match: RegExpExecArray | null;
    while ((match = filePattern.exec(fullDiff)) !== null) {
      matches.push({ filePath: match[2], start: match.index });
    }

    for (let i = 0; i < matches.length; i++) {
      const { filePath, start } = matches[i];
      const end = i + 1 < matches.length ? matches[i + 1].start : fullDiff.length;
      const raw = fullDiff.slice(start, end).trimEnd();
      const lines = raw.split('\n');

      // Find hunks (lines starting with @@)
      const hunks: string[] = [];
      let headerEnd = 0;

      for (let j = 0; j < lines.length; j++) {
        if (lines[j].startsWith('@@')) {
          if (headerEnd === 0) headerEnd = j;
          // Find the end of this hunk (next @@ or end of file section)
          let hunkEnd = j + 1;
          while (hunkEnd < lines.length && !lines[hunkEnd].startsWith('@@')) {
            hunkEnd++;
          }
          hunks.push(lines.slice(j, hunkEnd).join('\n'));
          j = hunkEnd - 1;
        }
      }

      const header = lines.slice(0, headerEnd || lines.length).join('\n');
      result.set(filePath, { header, hunks, raw });
    }

    return result;
  }

  private validatePlan(plan: SlidePlan): SlidePlan {
    const validImportance = ['high', 'medium', 'low'] as const;

    return {
      summary: (plan.summary || 'Code changes').slice(0, 200),
      slides: (plan.slides || []).map(slide => ({
        title: (slide.title || 'Untitled change').slice(0, 100),
        files: Array.isArray(slide.files) ? slide.files : [],
        importance: validImportance.includes(slide.importance) ? slide.importance : 'medium',
        hunkSelectors: Array.isArray(slide.hunkSelectors)
          ? slide.hunkSelectors.map(s => ({
              filePath: s.filePath || '',
              hunkIndices: Array.isArray(s.hunkIndices) ? s.hunkIndices : [],
            }))
          : [],
      })),
    };
  }

  private fallbackPlan(fullDiff: string): SlidePlan {
    const filePattern = /^diff --git a\/(.+?) b\/(.+)$/gm;
    const files: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = filePattern.exec(fullDiff)) !== null) {
      files.push(match[2]);
    }

    return {
      summary: `Changes across ${files.length} file(s)`,
      slides: [{
        title: 'All changes',
        files,
        importance: 'medium',
        hunkSelectors: files.map(f => ({ filePath: f, hunkIndices: [0] })),
      }],
    };
  }
}

export const presentationService = new PresentationService();
