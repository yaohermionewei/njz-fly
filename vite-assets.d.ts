// Asset module declarations for non-standard / uppercase extensions.
// Vite's default typings cover '*.mp3' but not '*.MP3' (uppercase).

declare module '*.MP3' {
  const src: string;
  export default src;
}


