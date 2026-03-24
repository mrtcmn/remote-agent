/**
 * Brand-accurate SVG icons for AI model terminals.
 * Detects model from terminal name (case-insensitive).
 */

type AIModel = 'claude' | 'gemini' | 'openai' | 'codex' | 'unknown';

export function detectAIModel(name: string): AIModel {
  const lower = name.toLowerCase();
  if (lower.includes('gemini')) return 'gemini';
  if (lower.includes('codex')) return 'codex';
  if (lower.includes('openai') || lower.includes('gpt')) return 'openai';
  if (lower.includes('claude') || lower.includes('anthropic')) return 'claude';
  return 'claude'; // default for type=claude terminals
}

interface AIModelIconProps {
  model: AIModel;
  size?: number;
  className?: string;
}

function ClaudeIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z" fill="#D97757" fillRule="nonzero" />
    </svg>
  );
}

function GeminiIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="gem-a" x1="0" y1="0" x2="28" y2="28" gradientUnits="userSpaceOnUse">
          <stop stopColor="#4285F4" />
          <stop offset="1" stopColor="#1A73E8" />
        </linearGradient>
        <linearGradient id="gem-b" x1="14" y1="0" x2="14" y2="28" gradientUnits="userSpaceOnUse">
          <stop stopColor="#89B4F7" />
          <stop offset="1" stopColor="#4285F4" />
        </linearGradient>
      </defs>
      {/* 4-pointed star — the Gemini sparkle mark */}
      <path
        d="M14 0C14 0 12.6 10.267 5.25 14C12.6 17.733 14 28 14 28C14 28 15.4 17.733 22.75 14C15.4 10.267 14 0 14 0Z"
        fill="url(#gem-a)"
      />
    </svg>
  );
}

function OpenAIIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 41 41" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* OpenAI logo — simplified swirl/hexagram */}
      <path
        d="M37.532 16.87a9.963 9.963 0 00-.856-8.184 10.078 10.078 0 00-10.855-4.835 9.964 9.964 0 00-7.504-3.357 10.079 10.079 0 00-9.612 6.977 9.967 9.967 0 00-6.664 4.834 10.08 10.08 0 001.24 11.817 9.965 9.965 0 00.856 8.185 10.079 10.079 0 0010.855 4.835 9.965 9.965 0 007.504 3.356 10.078 10.078 0 009.617-6.981 9.967 9.967 0 006.663-4.834 10.079 10.079 0 00-1.244-11.813zM22.498 37.886a7.474 7.474 0 01-4.799-1.735c.061-.033.168-.091.237-.134l7.964-4.6a1.294 1.294 0 00.655-1.134V19.054l3.366 1.944a.12.12 0 01.066.092v9.299a7.505 7.505 0 01-7.49 7.496zM6.392 31.006a7.471 7.471 0 01-.894-5.023c.06.036.162.099.237.141l7.964 4.6a1.297 1.297 0 001.308 0l9.724-5.614v3.888a.12.12 0 01-.048.103L16.552 33.6a7.504 7.504 0 01-10.16-2.594zM4.297 13.62A7.469 7.469 0 018.2 10.333c0 .068-.004.19-.004.274v9.201a1.294 1.294 0 00.654 1.132l9.723 5.614-3.366 1.944a.12.12 0 01-.114.012L7.044 23.82a7.504 7.504 0 01-2.747-10.2zm27.658 6.437l-9.724-5.615 3.367-1.943a.121.121 0 01.114-.012l8.048 4.648a7.498 7.498 0 01-1.158 13.528v-9.476a1.293 1.293 0 00-.647-1.13zm3.35-5.043c-.059-.037-.162-.099-.236-.141l-7.965-4.6a1.298 1.298 0 00-1.308 0l-9.723 5.614v-3.888a.12.12 0 01.048-.103l8.048-4.648a7.498 7.498 0 0111.135 7.766zm-21.063 6.929l-3.367-1.944a.12.12 0 01-.065-.092v-9.299a7.497 7.497 0 0112.293-5.756 6.94 6.94 0 00-.236.134l-7.965 4.6a1.294 1.294 0 00-.654 1.132l-.006 11.225zm1.829-3.943l4.33-2.501 4.332 2.5v4.999l-4.331 2.5-4.331-2.5V18z"
        fill="#10a37f"
      />
    </svg>
  );
}

export function AIModelIcon({ model, size = 14, className }: AIModelIconProps) {
  const s = size;

  if (model === 'gemini') {
    return (
      <span className={className} style={{ display: 'inline-flex', width: s, height: s, flexShrink: 0 }}>
        <GeminiIcon size={s} />
      </span>
    );
  }

  if (model === 'openai' || model === 'codex') {
    return (
      <span className={className} style={{ display: 'inline-flex', width: s, height: s, flexShrink: 0 }}>
        <OpenAIIcon size={s} />
      </span>
    );
  }

  // Default: Claude/Anthropic
  return (
    <span className={className} style={{ display: 'inline-flex', width: s, height: s, flexShrink: 0 }}>
      <ClaudeIcon size={s} />
    </span>
  );
}

/** Convenience: given a terminal type + name, return the right icon */
export function TerminalAIIcon({
  terminalType,
  terminalName,
  size = 14,
  className,
}: {
  terminalType: string;
  terminalName: string;
  size?: number;
  className?: string;
}) {
  if (terminalType !== 'claude') return null;
  const model = detectAIModel(terminalName);
  return <AIModelIcon model={model} size={size} className={className} />;
}
