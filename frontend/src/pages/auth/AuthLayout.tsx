import type { ReactNode } from 'react'

// Centered card on the canvas background, shared by login and register.
export default function AuthLayout({ title, sub, width = 'max-w-[460px]', children }: { title: string; sub: string; width?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-4">
      <div className={`flex w-full ${width} flex-col gap-4 rounded-2xl border-[1.5px] border-line bg-white px-6 py-8 sm:px-[34px]`}>
        <div className="flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl border-[1.5px] border-dashed border-[#b8bec6] bg-[#e9ecef] text-[13px] text-[#8a929c]">
            LOGO
          </div>
        </div>
        <div className="text-center">
          <h1 className="m-0 text-[22px] font-bold">{title}</h1>
          <div className="mt-1 text-sm text-neutral-600">{sub}</div>
        </div>
        {children}
      </div>
    </div>
  )
}
