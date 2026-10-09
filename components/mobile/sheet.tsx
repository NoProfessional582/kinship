'use client'
import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export const MSheet = DialogPrimitive.Root
export const MSheetTitle = DialogPrimitive.Title

/**
 * The mobile GUI's one modal surface.
 *
 * It is anchored to the bottom rather than centred, which is not a style
 * preference: a centred dialog on a phone shrinks to fit the space *above* the
 * keyboard, so opening one to type in it pushes its own fields off-screen. A
 * bottom sheet grows upward from the keyboard instead and keeps the field you
 * are editing directly above it.
 *
 * `dvh`, not `vh`. On mobile Safari and Chrome `100vh` is the height with the
 * URL bar hidden, so a `vh`-sized sheet is taller than what is actually visible
 * and its footer sits under the browser chrome.
 */
export const MSheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    /** Full height for the composer and detail views; auto for short prompts. */
    tall?: boolean
    hideClose?: boolean
  }
>(({ className, children, tall, hideClose, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[1px]" />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'kb-m fixed inset-x-0 bottom-0 z-50 flex flex-col',
        'rounded-t-[1.25rem] border-t border-[var(--border)] bg-[var(--card)] shadow-2xl',
        // The gutter keeps the footer's buttons off the home indicator.
        'pb-[env(safe-area-inset-bottom,0px)]',
        tall ? 'h-[92dvh]' : 'max-h-[88dvh]',
        className,
      )}
      {...props}
    >
      {/* A grab handle, purely so the sheet reads as something you can dismiss
          downward before you have tried it. */}
      <div className="flex shrink-0 justify-center pb-1 pt-2.5">
        <span className="h-1 w-9 rounded-full bg-[var(--border)]" />
      </div>
      {children}
      {!hideClose && (
        <DialogPrimitive.Close className="kb-tap absolute right-2 top-2 flex items-center justify-center rounded-full text-[var(--muted-foreground)] transition-opacity hover:opacity-100">
          <X className="h-5 w-5" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
))
MSheetContent.displayName = 'MSheetContent'

/** Scrolling body. Its own overflow box, so the header and footer stay put. */
export function MSheetBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('min-h-0 flex-1 overflow-y-auto px-4 pb-4', className)} {...props} />
}

/** Sticky action row. Sits above the keyboard because the sheet does. */
export function MSheetFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex shrink-0 items-center gap-2 border-t border-[var(--border)] px-4 py-3', className)}
      {...props}
    />
  )
}

export function MSheetHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('shrink-0 px-4 pb-2 pt-1', className)} {...props} />
}
