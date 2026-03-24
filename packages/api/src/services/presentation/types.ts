export interface PresentationRequest {
  projectPath: string;
  unstaged?: boolean;
  staged?: boolean;
  commitHashes?: string[];
}

export interface SlidePlanEntry {
  title: string;
  files: string[];
  importance: 'high' | 'medium' | 'low';
  hunkSelectors: Array<{
    filePath: string;
    hunkIndices: number[];
  }>;
}

export interface SlidePlan {
  slides: SlidePlanEntry[];
  summary: string;
}

export interface DiffExcerpt {
  filePath: string;
  patch: string;
  explanation: string;
}

export interface SlideAnnotation {
  id: string;
  slideId: string;
  text: string;
  createdAt: string;
}

export interface PresentationSlide {
  id: string;
  index: number;
  title: string;
  narrative: string;
  importance: 'high' | 'medium' | 'low';
  files: string[];
  excerpts: DiffExcerpt[];
  fullDiff: string;
  annotations: SlideAnnotation[];
}

export type SSEEventType = 'plan' | 'slide' | 'done' | 'error';

export interface SSEEvent {
  event: SSEEventType;
  data: SlidePlan | PresentationSlide | { message: string } | Record<string, never>;
}
