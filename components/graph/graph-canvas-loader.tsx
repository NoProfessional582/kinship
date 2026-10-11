'use client'
/**
 * The canvas, loaded in the browser only: WebGL needs a window, and three stays out of the
 * server's bundle and out of every other page's.
 */
import dynamic from 'next/dynamic'
import { GraphLoading } from './graph-states'

export const GraphCanvas = dynamic(() => import('./graph-canvas'), {
  ssr: false,
  loading: () => <GraphLoading />,
})

export type { GraphCanvasHandle, GraphCanvasProps } from './graph-canvas'
