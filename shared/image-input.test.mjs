import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {imageDimensions} from './image-input.mjs';

test('valid PNG dimensions are inspected without decoding pixels',async()=>{
  assert.deepEqual(imageDimensions(await readFile(new URL('../evaluation/fixtures/ethanol.png',import.meta.url))),{width:700,height:400});
});
test('compressed images with huge pixel counts are rejected before native decoding',async()=>{
  assert.throws(()=>imageDimensions(Buffer.from('iVBORw0KGgoAAAANSUhEUgAANrAAACcQ', 'base64')),/too large/);
});
test('corrupt and unsupported images return a readable error',()=>{
  assert.throws(()=>imageDimensions(Buffer.from('not an image')),/not a readable/);
});
