import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';

test('Pixiv 封面代理补充 Pixiv Referer 并返回图片', async () => {
  const originalFetch = globalThis.fetch;
  let upstreamRequest = null;
  globalThis.fetch = async (input, init) => {
    upstreamRequest = { input: String(input), init };
    return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/jpeg', etag: 'fixture' } });
  };
  try {
    const target = 'https://i.pximg.net/img-original/img/2026/09/01/18/03/21/TARGET.jpg';
    const request = new Request(`https://workshop.example/api/image?url=${encodeURIComponent(target)}`);
    const response = await worker.fetch(request, {});
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/jpeg');
    assert.equal(response.headers.get('etag'), 'fixture');
    assert.equal(upstreamRequest.input, target);
    assert.equal(upstreamRequest.init.headers.referer, 'https://www.pixiv.net/');
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2, 3]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('图片代理仅接受 pximg HTTPS 地址', async () => {
  for (const target of ['https://example.com/a.jpg', 'http://i.pximg.net/a.jpg', 'https://127.0.0.1/a.jpg']) {
    const request = new Request(`https://workshop.example/api/image?url=${encodeURIComponent(target)}`);
    const response = await worker.fetch(request, {});
    assert.equal(response.status, 400);
  }
});
