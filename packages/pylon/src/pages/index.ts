// Runtime entry — `@getcronit/pylon/pages`. The browser-facing usePages runtime
// (useData, useMutation, Link, Image, StatusPage, global-id helpers). The runtime
// module itself is kept at ./pages/ for now; this barrel is its public entry so
// `@getcronit/pylon/pages` resolves to the runtime (a cosmetic flatten of the
// internal ./pages/pages nesting is an optional later follow-up).
//
// The CONFIG PLUGIN `usePages` lives at `@getcronit/pylon/pages/plugin` (plugin.ts).
export * from './pages/index.js'
