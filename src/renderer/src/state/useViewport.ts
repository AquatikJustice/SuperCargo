import { useSyncExternalStore } from 'react'

function subscribe(cb: () => void): () => void {
  window.addEventListener('resize', cb)
  return () => window.removeEventListener('resize', cb)
}

// snapshot the bool not the width, so resize drags don't re-render
export function useNarrow(max = 720): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.innerWidth <= max
  )
}
