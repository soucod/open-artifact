/** A `.wasm` import, as workerd gives it (compiled at upload): see `sheets.ts`. */
declare module '*.wasm' {
  const compiled: WebAssembly.Module;
  export default compiled;
}
