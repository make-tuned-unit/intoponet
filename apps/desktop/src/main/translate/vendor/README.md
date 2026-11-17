# Vendored: bergamot-translator glue

`bergamot-translator.js` is the Emscripten glue for Mozilla's
bergamot-translator WebAssembly build, copied unmodified from Firefox
(`toolkit/components/translations/bergamot-translator/bergamot-translator.js`).

- Upstream: https://github.com/mozilla/translations, release v0.6.0
  (revision eea6e5a80aa4ddd86d9cc35ce9a65b79aa3ab96d).
- Licence: MPL-2.0 (header in the file).
- SHA-256: faff1ef6285b0d26f01787776fd49299dfb756ecb9688aa990c250e66797b47d

Do not edit the file. It is MPL-2.0, so it ships as a file of its own and never
as text inside Intoponet's code: the build copies it byte for byte to
`out/main/vendor/bergamot-translator.js` (`?asset` in `../openEngine.ts`, named
in `electron.vite.config.ts`), the main process reads that copy and hands its
text to the worker, and `scripts/shipped-glue.cjs` fails the release build if
the copy differs from this file or if any of its text turns up in another built
file. The licence text ships as `LICENSES/MPL-2.0.txt`.

The matching WebAssembly binary (bergamot-translator 3.0, about 5 MB) is not in
the repository. It downloads with the first language and is pinned by SHA-256 in
`../catalog.json`. The glue's own fetch/XMLHttpRequest paths are never used:
the worker passes the verified binary in as `wasmBinary` and has no network.
