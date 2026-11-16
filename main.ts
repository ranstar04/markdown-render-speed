import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from './parse.js';

const source = resolve(process.env.MAKEFUN_INPUT_DIR || '/input', 'cases.json');
const destination = process.env.MAKEFUN_OUTPUT_DIR || '/output';
const inputs = JSON.parse(readFileSync(source, 'utf8')) as Array<{ id: string; markdown: string }>;
const rendered = inputs.map(({ markdown }) => parse(markdown));
mkdirSync(destination, { recursive: true });
writeFileSync(resolve(destination, 'html.json'), JSON.stringify(rendered));
