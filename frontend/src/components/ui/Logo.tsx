import { useId } from "react";

/**
 * BODYVISION identity mark — a human figure inside a scan aperture.
 * Gradient ring (aurora) + geometric body + scanning horizon.
 */
export function Logo({ size = 40, className }: { size?: number; className?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const ring = `bv-ring-${uid}`;
  const body = `bv-body-${uid}`;
  const glow = `bv-glow-${uid}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={ring} x1="6" y1="4" x2="42" y2="44" gradientUnits="userSpaceOnUse">
          <stop stopColor="#3ae2fb" />
          <stop offset="0.48" stopColor="#5aa9ff" />
          <stop offset="1" stopColor="#a78bfa" />
        </linearGradient>
        <linearGradient id={body} x1="24" y1="14" x2="24" y2="38" gradientUnits="userSpaceOnUse">
          <stop stopColor="#eafcff" />
          <stop offset="1" stopColor="#8ee6ff" />
        </linearGradient>
        <radialGradient id={glow} cx="0.5" cy="0.5" r="0.5">
          <stop stopColor="#3ae2fb" stopOpacity="0.4" />
          <stop offset="1" stopColor="#3ae2fb" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* aperture */}
      <path
        d="M24 2.6 41.4 12.6v22.8L24 45.4 6.6 35.4V12.6L24 2.6Z"
        stroke={`url(#${ring})`}
        strokeWidth="2.3"
        strokeLinejoin="round"
        fill="#0b1424"
      />
      <circle cx="24" cy="23.5" r="15.5" fill={`url(#${glow})`} />
      {/* body figure */}
      <circle cx="24" cy="15.4" r="4.4" fill={`url(#${body})`} />
      <path
        d="M12.6 35.6c1.9-7.6 6-11.4 11.4-11.4s9.5 3.8 11.4 11.4"
        stroke={`url(#${body})`}
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      {/* scan horizon */}
      <path d="M9.5 27.5h7M31.5 27.5h7" stroke="#3ae2fb" strokeWidth="1.6" strokeLinecap="round" opacity="0.9" />
    </svg>
  );
}
