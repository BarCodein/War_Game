import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// public/richText.js 是 classic script（挂 window.richText），用 vm 在沙箱里加载后测试。
// 回归背景：battlebackground.html 的历史背景用 textContent 渲染，
// 西安事变那条里的 "<br>" 被当成普通文字显示出来（没有换行）。
function loadRichText() {
  const code = readFileSync(new URL('../../public/richText.js', import.meta.url), 'utf8');
  const sandbox = { window: {} };
  vm.runInNewContext(code, sandbox);
  return sandbox.window.richText;
}

describe('richText：战役文本的轻量富文本', () => {
  const richText = loadRichText();

  it('<br> 会被还原成真正的换行标签（西安事变那条历史）', () => {
    const history = '校长玩夜跑<br>学良全军满山找<br>光头不得了<br>最中正';
    expect(richText(history)).toBe('校长玩夜跑<br>学良全军满山找<br>光头不得了<br>最中正');
  });

  it('forcesHtml 里的 <strong> 与 <br> 都保留', () => {
    const html = '<strong>我方部队：</strong>第四纵队<br><br><strong>敌方部队：</strong>东进兵团';
    expect(richText(html)).toBe('<strong>我方部队：</strong>第四纵队<br><br><strong>敌方部队：</strong>东进兵团');
  });

  it('其它标签被转义，不会真的创建 DOM 结构（防注入）', () => {
    expect(richText('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(richText('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;');
    expect(richText('<div onclick="x">hi</div>')).toBe('&lt;div onclick="x"&gt;hi&lt;/div&gt;');
  });

  it('普通文本里的 & 与 < 也被正确转义', () => {
    expect(richText('兵力 < 10 且 A & B')).toBe('兵力 &lt; 10 且 A &amp; B');
  });

  it('自闭合与带空格的写法都能识别，空值不报错', () => {
    expect(richText('第一行<br/>第二行')).toBe('第一行<br>第二行');
    expect(richText('粗体<strong >x</strong >')).toBe('粗体<strong>x</strong>');
    expect(richText(null)).toBe('');
    expect(richText(undefined)).toBe('');
  });
});
