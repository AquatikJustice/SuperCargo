import type { SuperCargoApi } from './index'

declare global {
  interface Window {
    supercargo: SuperCargoApi
  }
}

export {}
