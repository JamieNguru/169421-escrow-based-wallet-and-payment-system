// The app's mark: a shield with a tick, on a green tile. Stands in for the
// wireframes' "LOGO" placeholder.
export function BrandMark({ size = 40 }: { size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-[28%] bg-gradient-to-br from-[#1fa653] to-brand-dark text-white shadow-button"
      style={{ width: size, height: size }}
    >
      <svg
        width={size * 0.55}
        height={size * 0.55}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
        <path d="M9 12l2 2 4-4" />
      </svg>
    </span>
  )
}

export function BrandName({ className = '' }: { className?: string }) {
  return <span className={`text-lg font-extrabold tracking-tight ${className}`}>Escrow Wallet</span>
}
