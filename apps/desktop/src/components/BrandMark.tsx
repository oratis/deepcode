// DeepCode brand mark — elephant silhouette per docs/VISUAL_DESIGN.html.
// Wraps the SVG path in the gradient .mark / .mark-lg container so the
// shell can drop it in anywhere without per-instance styling.

interface BrandMarkProps {
  /** 'sm' = 26 px (default, sidebar / pill); 'lg' = 64 px (onboarding hero). */
  size?: 'sm' | 'lg';
}

export function BrandMark({ size = 'sm' }: BrandMarkProps): JSX.Element {
  return (
    <span className={size === 'lg' ? 'mark mark-lg' : 'mark'}>
      <svg
        viewBox="0 0 100 100"
        xmlns="http://www.w3.org/2000/svg"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M18 36 L24 10 L42 30 Q50 28 58 30 L76 10 L82 36 Q90 52 86 70 Q76 88 50 88 Q24 88 14 70 Q10 52 18 36 Z" />
      </svg>
    </span>
  );
}
