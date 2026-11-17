import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MessageContent } from './MessageContent.js';

const render = (text: string): string => renderToStaticMarkup(<MessageContent text={text} />);

describe('assistant message content', () => {
  it('renders prose, headings, inline code and bold text with semantic elements', () => {
    const html = render('# Result\n\nUpdated **the `config` value**.\nStill readable.');
    expect(html).toContain('<h1>Result</h1>');
    expect(html).toContain('<strong>the <code>config</code> value</strong>');
    expect(html).toContain('Still readable.</p>');
  });

  it('separates ordered and unordered lists and preserves ordered start', () => {
    const html = render('- Read\n- Edit\n\n3. Verify\n4. Build');
    expect(html).toContain('<ul><li>Read</li><li>Edit</li></ul>');
    expect(html).toContain('<ol start="3"><li>Verify</li><li>Build</li></ol>');
  });

  it('preserves code whitespace without interpreting Markdown inside it', () => {
    const html = render('```ts\n  const text = "**literal**";\n\n  return text;\n```\nDone.');
    expect(html).toContain('message-code-language">ts</div>');
    expect(html).toContain(
      '<pre><code>  const text = &quot;**literal**&quot;;\n\n  return text;</code></pre>',
    );
    expect(html).toContain('<p>Done.</p>');
    expect(html).not.toContain('<strong>');
  });

  it('shows incomplete streaming fences and unmatched inline markers as text', () => {
    expect(render('```js\nconst partial = 1;')).toContain(
      '<pre><code>const partial = 1;</code></pre>',
    );
    expect(render('Still **writing `a')).toContain('<p>Still **writing `a</p>');
    expect(render('```')).toContain('<pre><code></code></pre>');
  });

  it('does not close a long fence with a shorter or different marker', () => {
    const html = render('````text\n```\n~~~\nvalue\n````\nAfter');
    expect(html).toContain('<pre><code>```\n~~~\nvalue</code></pre>');
    expect(html).toContain('<p>After</p>');
    expect(render('~~~\nhello\n~~~')).toContain('<pre><code>hello</code></pre>');
  });

  it('escapes raw HTML in prose, inline code, code and language labels', () => {
    const html = render(
      '<img src=x onerror=alert(1)>\n\n`<script>bad()</script>`\n\n```<svg/onload=bad()>\n<script>bad()</script>\n```',
    );
    expect(html).not.toMatch(/<(?:img|script|svg)(?:\s|>)/);
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;script&gt;bad()&lt;/script&gt;');
    expect(html).toContain('&lt;svg/onload=bad()&gt;');
  });

  it('leaves all links and image markup as inert text', () => {
    const html = render(
      '[click](javascript:alert(1)) ![image](https://example.com/x.png) [docs](https://example.com)',
    );
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('<img');
    expect(html).toContain('javascript:alert(1)');
  });

  it('normalizes line endings and accepts empty content', () => {
    expect(render('First\r\n\r\nSecond')).toContain('<p>First</p><p>Second</p>');
    expect(render('')).toBe('<div class="message-content"></div>');
  });
});
