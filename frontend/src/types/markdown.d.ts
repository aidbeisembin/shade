// THIRD_PARTY_NOTICES.md приходит в бандл строкой (next.config.js, asset/source).
declare module '*.md' {
  const content: string;
  export default content;
}
