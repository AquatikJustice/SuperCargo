import { useSyncExternalStore } from 'react'

function subscribe(cb: () => void): () => void {
  window.addEventListener('resize', cb)
  return () => window.removeEventListener('resize', cb)
}

/** True when the window is too narrow for the full chrome (portrait / half-snap).
 *  The snapshot is the boolean, not the raw width, so subscribers only re-render
 *  when the breakpoint is crossed, never on every pixel of a resize drag.
 *  Width is in CSS pixels, so it already accounts for the UI zoom factor. */
export function useNarrow(max = 720): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.innerWidth <= max
  )
}
