/**
 * Payment-success mark: a ring and a checkmark that draw themselves, with a soft glow
 * pulse once. Restrained, the way payment confirmations look in Apple Pay or Stripe.
 * Pure SVG stroke animation; people who prefer reduced motion see the finished mark.
 */
export function SuccessCheck() {
  return (
    <span aria-hidden className="seen-check relative grid size-16 place-items-center">
      <style>{`
        .seen-check svg { overflow: visible; }
        .seen-check .ring { stroke-dasharray: 151; stroke-dashoffset: 151; animation: seen-draw 600ms cubic-bezier(.65,0,.35,1) forwards; }
        .seen-check .tick { stroke-dasharray: 36; stroke-dashoffset: 36; animation: seen-draw 380ms cubic-bezier(.65,0,.35,1) 480ms forwards; }
        .seen-check .glow { animation: seen-glow 1.2s ease-out 700ms both; }
        @keyframes seen-draw { to { stroke-dashoffset: 0; } }
        @keyframes seen-glow { 0% { opacity: 0; transform: scale(.8); } 40% { opacity: .55; } 100% { opacity: 0; transform: scale(1.5); } }
        @media (prefers-reduced-motion: reduce) {
          .seen-check .ring, .seen-check .tick { animation: none; stroke-dashoffset: 0; }
          .seen-check .glow { display: none; }
        }
      `}</style>
      <span className="glow absolute inset-0 rounded-full bg-success/40 blur-md" />
      <svg viewBox="0 0 52 52" className="relative size-16 text-success">
        <circle className="ring" cx="26" cy="26" r="24" fill="none" stroke="currentColor" strokeWidth="2.5" />
        <path className="tick" d="M15 27 l7 7 l15 -16" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
