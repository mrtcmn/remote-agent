import { join } from 'path';
import { mkdir, copyFile, stat } from 'fs/promises';
import { nanoid } from 'nanoid';
import { artifactRepository } from '../artifact.repository';
import type { ArtifactAdapter, ArtifactInput, ArtifactResult } from '../types';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';

export class ScreenshotAdapter implements ArtifactAdapter {
  readonly name = 'screenshot';

  matches(toolName: string): boolean {
    return toolName.includes('screenshot');
  }

  async process(input: ArtifactInput): Promise<ArtifactResult | null> {
    const filePath = this.extractFilePath(input.toolResult);
    if (!filePath) {
      console.warn('[ScreenshotAdapter] Could not extract file path from tool_result');
      return null;
    }

    // Verify source exists
    try {
      await stat(filePath);
    } catch {
      console.warn(`[ScreenshotAdapter] Source file not found: ${filePath}`);
      return null;
    }

    // Copy to artifact storage
    const artifactDir = join(UPLOAD_DIR, 'artifacts', input.sessionId);
    await mkdir(artifactDir, { recursive: true });

    const ext = filePath.match(/\.(png|jpg|jpeg|webp)$/i)?.[1] || 'png';
    const artifactFilename = `${nanoid()}.${ext}`;
    const artifactPath = join(artifactDir, artifactFilename);
    await copyFile(filePath, artifactPath);

    const fileStats = await stat(artifactPath);

    const artifact = await artifactRepository.create({
      sessionId: input.sessionId,
      terminalId: input.terminalId,
      type: 'screenshot',
      toolName: input.toolName,
      filename: artifactFilename,
      filepath: artifactPath,
      mimetype: `image/${ext === 'jpg' ? 'jpeg' : ext}`,
      size: fileStats.size,
      metadata: {
        toolInput: input.toolInput,
        originalPath: filePath,
      },
    });

    if (!artifact) return null;

    return {
      id: artifact.id,
      type: 'screenshot',
      filename: artifact.filename,
      filepath: artifact.filepath,
    };
  }

  private extractFilePath(toolResult: string): string | null {
    const text = toolResult.trim();

    // Try to match explicit path patterns
    for (const line of text.split('\n')) {
      // "Screenshot saved to /path/to/file.png"
      const savedMatch = line.match(/saved\s+(?:to\s+)?(\S+\.(?:png|jpg|jpeg|webp))/i);
      if (savedMatch) return savedMatch[1];

      // "path: /path/to/file.png"
      const pathMatch = line.match(/path:\s*(\S+\.(?:png|jpg|jpeg|webp))/i);
      if (pathMatch) return pathMatch[1];

      // Standalone absolute path
      const absMatch = line.match(/(\/\S+\.(?:png|jpg|jpeg|webp))/i);
      if (absMatch) return absMatch[1];
    }

    // Fallback: entire result is a path
    if (text.startsWith('/') && /\.(png|jpg|jpeg|webp)$/i.test(text)) {
      return text;
    }

    return null;
  }
}
