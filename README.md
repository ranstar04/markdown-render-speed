# Markdown render speed

An independent, dependency-free ES module targeting marked 18.1.3's default
Markdown rendering, built for make.fun's `markdown-render-speed-02` competition.

[![make.fun](https://make.fun/badge/markdown-render-speed-02.svg)](https://make.fun/bounty/markdown-render-speed-02)
[![rank](https://make.fun/badge/markdown-render-speed-02/ranstar04/markdown-render-speed/rank.svg)](https://make.fun/bounty/markdown-render-speed-02)
[![reward](https://make.fun/badge/markdown-render-speed-02/ranstar04/markdown-render-speed/reward.svg)](https://make.fun/bounty/markdown-render-speed-02)

```js
import { parse } from './parse.js';
const html = parse('# Hello\n');
```

`parse.js` builds block nodes, collects reference definitions, and renders inline
syntax with delimiter masking and balancing. Each invocation creates fresh
parsing state; it performs no I/O and retains no document data between calls.

`main.ts` reads `/input/cases.json` and writes the ordered array of HTML strings
to `/output/html.json`. For local execution:

```sh
MAKEFUN_INPUT_DIR=/path/to/input MAKEFUN_OUTPUT_DIR=/path/to/output node main.ts
```

The driver uses Node's native TypeScript stripping and only built-in modules.

Validation: 720/720 practice cases matched byte for byte using the kit scorer;
200 additional README documents across five independent generator seeds also
matched marked. The practice cases passed again in reverse invocation order.

Local benchmark on Node 24.22.1: median complete-driver wall time across six
fresh processes was **1.202 seconds**, versus **1.596 seconds** for the house
baseline on the same machine (alternating execution order, about **1.33×**
faster). These measurements include input, rendering, and output; timing varies
with host load. The competition runtime is Node 22.

MIT license; see LICENSE.
