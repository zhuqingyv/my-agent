import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithTimeout, parseDuckDuckGo, type WebResponseLike } from '../servers/web-mcp.js';

function fakeResponse(body: string): WebResponseLike {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: () => 'text/html; charset=UTF-8' },
    text: async () => body,
  };
}

test('web mcp: falls back to curl when Node fetch fails', async () => {
  let usedCurl = false;
  const resp = await fetchWithTimeout(
    'https://example.com',
    1000,
    async () => {
      throw new TypeError('fetch failed');
    },
    async () => {
      usedCurl = true;
      return fakeResponse('<html>ok</html>');
    }
  );

  assert.equal(usedCurl, true);
  assert.equal(resp.ok, true);
  assert.equal(await resp.text(), '<html>ok</html>');
});

test('web mcp: keeps abort errors as timeouts instead of falling back', async () => {
  let usedCurl = false;
  const abort = new Error('aborted');
  abort.name = 'AbortError';

  await assert.rejects(
    () => fetchWithTimeout(
      'https://example.com',
      1000,
      async () => { throw abort; },
      async () => {
        usedCurl = true;
        return fakeResponse('should not be used');
      }
    ),
    /aborted/
  );
  assert.equal(usedCurl, false);
});

test('web mcp: parses DuckDuckGo result snippets into structured rows', () => {
  const html = `
    <div class="links_main links_deep result__body">
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fgithub.com%2Fzhuqingyv%2Fnova-dom">GitHub - zhuqingyv/nova-dom</a>
      <a class="result__snippet" href="#">轻量级别的纯运行时前端构建库</a>
    </div>
  `;

  assert.deepEqual(parseDuckDuckGo(html, 1), [
    {
      title: 'GitHub - zhuqingyv/nova-dom',
      url: 'https://github.com/zhuqingyv/nova-dom',
      snippet: '轻量级别的纯运行时前端构建库',
    },
  ]);
});
