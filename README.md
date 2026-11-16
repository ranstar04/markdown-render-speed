# markdown-render-speed

A fast, dependency-free drop-in replacement for marked 18.1.3: `parse(markdown)`
returns exactly the HTML marked renders with its default options (GFM on), for
less CPU on every page.

Entry for the make.fun competition `markdown-render-speed-02`.

## Layout

- `parse.js` — dependency-free ES module, exports `parse(markdown)`.
- `main.ts` — the harness driver: reads `/input/cases.json`, writes
  `/output/html.json`.

## License

MIT. See LICENSE.
