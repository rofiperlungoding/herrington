// Minimal ambient declaration for the `Deno` global used inside Netlify
// Edge Functions. At runtime Netlify / Deno provides the real implementation;
// this file only exists so `tsc --noEmit` type-checks the edge-function code
// from the Node-side TypeScript toolchain.
declare const Deno: {
  env: {
    get(name: string): string | undefined;
  };
};
