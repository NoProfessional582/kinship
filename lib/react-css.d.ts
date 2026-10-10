import 'react'

declare module 'react' {
  interface CSSProperties {
    /** CSS custom properties, such as an event chip's `--ev` tint. */
    [name: `--${string}`]: string | number | undefined
  }
}
