/**
 * The Meridian mark: a globe drawn as a thin circle and equator in the surrounding text
 * color, crossed by one red meridian line. The red line is the only brand-red element in
 * the mark, matching the design system's rule that red appears where it carries structure.
 *
 * The mark inherits currentColor, so the same component works on the dark header chrome
 * (white) and on light surfaces (ink). The wordmark is real text, so the accessible name
 * of the brand stays "MERIDIAN" with or without styling.
 *
 * `draw` animates the meridian line drawing itself in once (sign-in only). The ellipse
 * declares pathLength=1 so the CSS dash animation is unit-normalized.
 */
export function MeridianLogo({
  size = 26,
  wordmark = true,
  draw = false,
}: {
  size?: number;
  wordmark?: boolean;
  draw?: boolean;
}) {
  return (
    <span className={draw ? 'logo logo-draw' : 'logo'}>
      <svg
        className="logo-mark"
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        <circle cx="16" cy="16" r="13" stroke="currentColor" strokeWidth="1.5" />
        <line x1="4.5" y1="16" x2="27.5" y2="16" stroke="currentColor" strokeWidth="1" opacity="0.45" />
        <ellipse
          className="logo-meridian"
          cx="16"
          cy="16"
          rx="6.5"
          ry="13"
          stroke="#af0000"
          strokeWidth="1.75"
          pathLength={1}
        />
      </svg>
      {wordmark ? <span className="logo-wordmark">MERIDIAN</span> : null}
    </span>
  );
}
