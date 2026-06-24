// electron-vite resolves `?asset` to a file path
declare module '*?asset' {
  const path: string
  export default path
}
