import type { JSX } from "react";

/**
 * BODYVISION stroke icon set — 24×24 grid, 1.7 stroke, round caps/joins.
 * Single source of truth for interface glyphs (replaces legacy text symbols).
 * All icons inherit `currentColor`; decorative by default (aria-hidden).
 */
export type IconName =
  | "home" | "folder" | "ruler" | "camera" | "sparkles" | "box" | "pulse"
  | "shield-check" | "file-text" | "lock" | "settings" | "user" | "users"
  | "pen-line" | "search" | "menu" | "x" | "check" | "check-circle"
  | "alert-triangle" | "info" | "arrow-right" | "arrow-up-right" | "chevron-right"
  | "plus" | "download" | "refresh" | "inbox" | "calendar" | "clock" | "activity"
  | "layers" | "scan" | "clipboard" | "key" | "chevron-down" | "database" | "chevron-left";

const paths: Record<IconName, JSX.Element> = {
  home: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.8"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.8"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.8"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.8"/></>,
  folder: <><path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.4h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V7.5Z"/><path d="M3.5 10.5h17"/></>,
  ruler: <><rect x="2.8" y="9" width="18.4" height="6.5" rx="1.6"/><path d="M6.5 9v3M10 9v4M13.5 9v3M17 9v4"/></>,
  camera: <><path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2L9 4.5h6L16.5 7h2A1.5 1.5 0 0 1 20 8.5V17a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17V8.5Z"/><circle cx="12" cy="12.6" r="3.6"/></>,
  sparkles: <><path d="M12 3.5 13.8 9l5.5 1.8-5.5 1.8L12 18l-1.8-5.4L4.7 10.8 10.2 9 12 3.5Z"/><path d="M19 4v3M17.5 5.5h3"/></>,
  box: <><path d="M12 2.8 20 7.4v9.2L12 21.2 4 16.6V7.4L12 2.8Z"/><path d="M4.2 7.6 12 12l7.8-4.4M12 12v9"/></>,
  pulse: <><path d="M3 12.5h4.2l2.3-6.5 3.4 11 2.6-8 1.6 3.5H21"/></>,
  "shield-check": <><path d="M12 2.8 19 6v6.2c0 4.6-3 8.4-7 9.9-4-1.5-7-5.3-7-9.9V6l7-3.2Z"/><path d="m9.2 12.1 2 2 3.8-4"/></>,
  "file-text": <><path d="M6 3h8l4 4v14a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 6 21V3Z"/><path d="M14 3v4.5h4.5M9.5 12h5M9.5 15.5h5M9.5 8.5h1.5"/></>,
  lock: <><rect x="5" y="10.5" width="14" height="9.5" rx="2.2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5M12 14.5v2"/></>,
  settings: <><circle cx="12" cy="12" r="3.1"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.04 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.04-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.04H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.56-1.04 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h0a1.7 1.7 0 0 0 1.04-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.04 1.56h0a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v0a1.7 1.7 0 0 0 1.56 1.04H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z"/></>,
  user: <><circle cx="12" cy="8" r="3.6"/><path d="M5.5 20.5a6.6 6.6 0 0 1 13 0"/></>,
  users: <><circle cx="9.2" cy="8.4" r="3.2"/><path d="M3.5 19.6a5.7 5.7 0 0 1 11.4 0M15.5 5.6a3.2 3.2 0 0 1 0 5.9M17.6 13.9a5.7 5.7 0 0 1 3.2 5.2"/></>,
  "pen-line": <><path d="M14.5 5.5 18.5 9.5M4 20l1.1-4.3a2 2 0 0 1 .5-.94L15.4 5a2.06 2.06 0 0 1 2.9 2.9L8.5 17.6a2 2 0 0 1-.94.5L4 20Z"/></>,
  search: <><circle cx="11" cy="11" r="6.4"/><path d="m20 20-4.6-4.6"/></>,
  menu: <><path d="M4 7h16M4 12h16M4 17h16"/></>,
  x: <><path d="m6 6 12 12M18 6 6 18"/></>,
  check: <><path d="m5 12.5 4.5 4.5L19 7.5"/></>,
  "check-circle": <><circle cx="12" cy="12" r="8.5"/><path d="m8.8 12.3 2.3 2.3 4.2-4.6"/></>,
  "alert-triangle": <><path d="M10.7 4.6 3.6 17a1.6 1.6 0 0 0 1.4 2.4h14a1.6 1.6 0 0 0 1.4-2.4L13.3 4.6a1.5 1.5 0 0 0-2.6 0Z"/><path d="M12 9.5v4M12 16.8h.01"/></>,
  info: <><circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 7.8h.01"/></>,
  "arrow-right": <><path d="M4.5 12h15M13.5 6l6 6-6 6"/></>,
  "arrow-up-right": <><path d="M7 17 17 7M9.5 7H17v7.5"/></>,
  "chevron-right": <><path d="m9.5 6.5 5.5 5.5-5.5 5.5"/></>,
  "chevron-left": <><path d="m14.5 6.5-5.5 5.5 5.5 5.5"/></>,
  "chevron-down": <><path d="m6.5 9.5 5.5 5.5 5.5-5.5"/></>,
  plus: <><path d="M12 5v14M5 12h14"/></>,
  download: <><path d="M12 4v11M7.5 11 12 15.5 16.5 11M5 19.5h14"/></>,
  refresh: <><path d="M20 12a8 8 0 1 1-2.34-5.66M20 3.5v4h-4"/></>,
  inbox: <><path d="M4 13.5 6.6 5.6A2 2 0 0 1 8.5 4h7a2 2 0 0 1 1.9 1.6L20 13.5M4 13.5h5.2l1.4 2.2h2.8l1.4-2.2H20M4 13.5V18a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4.5"/></>,
  calendar: <><rect x="3.5" y="5" width="17" height="16" rx="2.2"/><path d="M8 3v4M16 3v4M3.5 10h17"/></>,
  clock: <><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></>,
  activity: <><path d="M3 12h4l3-8 4 14 3-10 2 4h2"/></>,
  layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12.5 9 5 9-5M3 17l9 5 9-5"/></>,
  scan: <><path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"/><path d="M4 12h16"/></>,
  clipboard: <><rect x="5" y="4.5" width="14" height="17" rx="2"/><path d="M9 4.5a2 2 0 0 1 6 0M9.5 11h5M9.5 15h5"/></>,
  key: <><circle cx="8" cy="15.5" r="4.5"/><path d="m11.5 12.5 8-8M16 6l2.5 2.5M13.5 8.5 16 11"/></>,
  database: <><ellipse cx="12" cy="5.8" rx="7.5" ry="2.8"/><path d="M4.5 5.8v12.4c0 1.55 3.36 2.8 7.5 2.8s7.5-1.25 7.5-2.8V5.8"/><path d="M4.5 12c0 1.55 3.36 2.8 7.5 2.8s7.5-1.25 7.5-2.8"/></>,
};

export function Icon({
  name,
  size = 20,
  strokeWidth = 1.7,
  className,
  label,
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
  /** Provide only when the icon conveys meaning not present in adjacent text. */
  label?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...(label
        ? { role: "img", "aria-label": label }
        : { "aria-hidden": true as const })}
    >
      {paths[name]}
    </svg>
  );
}
