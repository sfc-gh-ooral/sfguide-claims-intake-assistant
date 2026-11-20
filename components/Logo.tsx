// Veltrona Claims Desk mark: a folded claim page with a marker stroke and a check (docs/DESIGN.md).
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="1" y="1" width="30" height="30" rx="8" fill="#0E3B34" stroke="rgba(255,255,255,.18)" />
      <path d="M10 7h9l5 5v13H10z" fill="#F4F7F6" />
      <path d="M19 7v5h5" fill="#B9CCC6" />
      <rect x="12" y="15" width="9" height="3" rx="1.5" fill="#FFD84D" />
      <path d="M12.5 21.5l2.2 2.1 4.6-4.6" fill="none" stroke="#0E3B34" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
