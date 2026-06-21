// electron-vite rewrites `?asset` imports to a runtime file path (the source
// path in dev, a copied path under resources/ when packaged).
declare module '*?asset' {
  const path: string
  export default path
}
