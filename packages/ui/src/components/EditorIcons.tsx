/**
 * Brand-accurate icons for desktop code editors that support deep-link
 * folder opening on macOS / Windows / Linux via OS protocol handlers.
 *
 * Used by `OpenInEditorButton` in local mode.
 */

import * as React from 'react';

export type EditorId = 'vscode' | 'cursor' | 'webstorm' | 'zed' | 'antigravity';

type IconProps = { size?: number; className?: string };

// ─── VS Code (Microsoft) ────────────────────────────────────────────────────

function VSCodeIcon({ size = 14, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        d="M23.15 2.587 18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .326 8.74L3.899 12 .326 15.26a1 1 0 0 0 .001 1.479L1.65 17.94a.999.999 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 20.06V3.939a1.5 1.5 0 0 0-.85-1.352zm-5.146 14.861L10.826 12l7.178-5.448v10.896z"
        fill="#007ACC"
      />
    </svg>
  );
}

// ─── Cursor (anysphere) ─────────────────────────────────────────────────────

function CursorIcon({ size = 14, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Cursor "C" mark — three layered diamonds */}
      <defs>
        <linearGradient id="cursor-a" x1="12" y1="0" x2="12" y2="24" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#A8A8A8" />
        </linearGradient>
        <linearGradient id="cursor-b" x1="12" y1="0" x2="12" y2="24" gradientUnits="userSpaceOnUse">
          <stop stopColor="#7C7C7C" />
          <stop offset="1" stopColor="#393939" />
        </linearGradient>
      </defs>
      <path d="M12 0 L24 6 V18 L12 24 L0 18 V6 Z" fill="url(#cursor-b)" />
      <path d="M12 0 L24 6 L12 12 L0 6 Z" fill="url(#cursor-a)" fillOpacity="0.9" />
      <path d="M12 12 L24 6 V18 L12 24 Z" fill="#000" fillOpacity="0.35" />
      <path d="M12 12 L12 24 L0 18 V6 Z" fill="#000" fillOpacity="0.15" />
    </svg>
  );
}

// ─── WebStorm (JetBrains) ───────────────────────────────────────────────────

function WebStormIcon({ size = 14, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* JetBrains WebStorm — corner-gradient square with "ws" mark */}
      <defs>
        <linearGradient id="ws-bg" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
          <stop stopColor="#00CDD7" />
          <stop offset="0.45" stopColor="#22D88F" />
          <stop offset="1" stopColor="#FFD83D" />
        </linearGradient>
        <linearGradient id="ws-bg2" x1="24" y1="0" x2="0" y2="24" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FE3271" stopOpacity="0.85" />
          <stop offset="1" stopColor="#FE3271" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="24" height="24" rx="3" fill="url(#ws-bg)" />
      <rect x="0" y="0" width="24" height="24" rx="3" fill="url(#ws-bg2)" />
      <text
        x="12"
        y="16.5"
        textAnchor="middle"
        fontSize="9"
        fontWeight="700"
        fontFamily="ui-sans-serif, system-ui, -apple-system"
        fill="#FFFFFF"
        letterSpacing="-0.4"
      >
        ws
      </text>
    </svg>
  );
}

// ─── Zed (Zed Industries) ───────────────────────────────────────────────────

function ZedIcon({ size = 14, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Zed — hexagonal Z mark */}
      <defs>
        <linearGradient id="zed-a" x1="12" y1="0" x2="12" y2="24" gradientUnits="userSpaceOnUse">
          <stop stopColor="#0E0E0E" />
          <stop offset="1" stopColor="#1F1F1F" />
        </linearGradient>
      </defs>
      <path
        d="M12 0.5 L22.5 6.5 V17.5 L12 23.5 L1.5 17.5 V6.5 Z"
        fill="url(#zed-a)"
        stroke="#3D3D3D"
        strokeWidth="0.5"
      />
      <path
        d="M7 7.5 H17 V9.2 L9.5 14.8 H17 V16.5 H7 V14.8 L14.5 9.2 H7 Z"
        fill="#F5B870"
      />
    </svg>
  );
}

// ─── Antigravity (Google) ───────────────────────────────────────────────────

function AntigravityIcon({ size = 14, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Antigravity — orbiting ring + ascending core (Google colors) */}
      <defs>
        <linearGradient id="ag-core" x1="12" y1="3" x2="12" y2="21" gradientUnits="userSpaceOnUse">
          <stop stopColor="#4285F4" />
          <stop offset="0.5" stopColor="#9B72F2" />
          <stop offset="1" stopColor="#EA4335" />
        </linearGradient>
      </defs>
      <ellipse
        cx="12"
        cy="13.5"
        rx="9"
        ry="3.2"
        fill="none"
        stroke="#FBBC04"
        strokeWidth="1.4"
        opacity="0.85"
        transform="rotate(-15 12 13.5)"
      />
      <path
        d="M12 3 L17.5 14 H13.5 V20.5 H10.5 V14 H6.5 Z"
        fill="url(#ag-core)"
      />
    </svg>
  );
}

// ─── Catalog ────────────────────────────────────────────────────────────────

export interface EditorDef {
  id: EditorId;
  label: string;
  /** Accent color used for hover / brand emphasis. */
  color: string;
  /** Builds the OS deep-link URL given an absolute folder path. */
  deepLink: (absolutePath: string) => string;
  Icon: React.FC<IconProps>;
}

export const EDITORS: EditorDef[] = [
  {
    id: 'vscode',
    label: 'VS Code',
    color: '#007ACC',
    deepLink: (p) => `vscode://file${encodeURI(p)}`,
    Icon: VSCodeIcon,
  },
  {
    id: 'cursor',
    label: 'Cursor',
    color: '#FFFFFF',
    deepLink: (p) => `cursor://file${encodeURI(p)}`,
    Icon: CursorIcon,
  },
  {
    id: 'webstorm',
    label: 'WebStorm',
    color: '#22D88F',
    // JetBrains Toolbox protocol handler — opens existing folder in WebStorm.
    deepLink: (p) =>
      `jetbrains://web-storm/navigate/reference?project=${encodeURIComponent(p)}`,
    Icon: WebStormIcon,
  },
  {
    id: 'zed',
    label: 'Zed',
    color: '#F5B870',
    deepLink: (p) => `zed://file${encodeURI(p)}`,
    Icon: ZedIcon,
  },
  {
    id: 'antigravity',
    label: 'Antigravity',
    color: '#9B72F2',
    deepLink: (p) => `antigravity://file${encodeURI(p)}`,
    Icon: AntigravityIcon,
  },
];

export function getEditorById(id: EditorId | null | undefined): EditorDef | undefined {
  if (!id) return undefined;
  return EDITORS.find((e) => e.id === id);
}
