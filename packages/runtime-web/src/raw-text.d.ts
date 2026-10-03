// Vite/Vitest `?raw` imports (used by tests to read repository files as text).
declare module "*?raw" {
  const content: string;
  export default content;
}
