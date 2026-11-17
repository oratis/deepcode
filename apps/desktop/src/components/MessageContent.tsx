import type { JSX, ReactNode } from 'react';
import './message-content.css';

interface Fence {
  marker: string;
  length: number;
  language: string;
}

function openingFence(line: string): Fence | null {
  const match = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
  if (!match) return null;
  return {
    marker: match[1]![0]!,
    length: match[1]!.length,
    language: match[2]!.trim().slice(0, 40),
  };
}

function closingFence(line: string, fence: Fence): boolean {
  const trimmed = line.trim();
  return (
    trimmed.length >= fence.length && [...trimmed].every((character) => character === fence.marker)
  );
}

function heading(line: string): RegExpMatchArray | null {
  return line.match(/^ {0,3}(#{1,6})[ \t]+(.+)$/);
}

function listItem(line: string): RegExpMatchArray | null {
  return line.match(/^ {0,3}(?:[-+*]|(\d{1,9})[.)])[ \t]+(.*)$/);
}

/** A deliberately small inline grammar. React escapes every text node. */
function inline(text: string, allowStrong = true): ReactNode[] {
  const nodes: ReactNode[] = [];
  let start = 0;
  let cursor = 0;
  while (cursor < text.length) {
    const marker =
      text[cursor] === '`' ? '`' : allowStrong && text.startsWith('**', cursor) ? '**' : null;
    if (!marker) {
      cursor++;
      continue;
    }
    const end = text.indexOf(marker, cursor + marker.length);
    if (end <= cursor + marker.length) {
      cursor += marker.length;
      continue;
    }
    if (cursor > start) nodes.push(text.slice(start, cursor));
    const content = text.slice(cursor + marker.length, end);
    nodes.push(
      marker === '`' ? (
        <code key={cursor}>{content}</code>
      ) : (
        <strong key={cursor}>{inline(content, false)}</strong>
      ),
    );
    cursor = end + marker.length;
    start = cursor;
  }
  if (start < text.length) nodes.push(text.slice(start));
  return nodes;
}

/**
 * Readable assistant prose without interpreting HTML, URLs, or executable markup.
 * The subset supports headings, flat lists, emphasis, and code. An unfinished
 * fence consumes the remaining text, so incremental responses remain readable.
 */
export function MessageContent({ text }: { text: string }): JSX.Element {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let cursor = 0;

  while (cursor < lines.length) {
    const line = lines[cursor]!;
    const key = cursor;
    if (line.trim() === '') {
      cursor++;
      continue;
    }

    const fence = openingFence(line);
    if (fence) {
      const code: string[] = [];
      cursor++;
      while (cursor < lines.length && !closingFence(lines[cursor]!, fence)) {
        code.push(lines[cursor++]!);
      }
      if (cursor < lines.length) cursor++;
      blocks.push(
        <div className="message-code-block" key={key}>
          <div className="message-code-language">{fence.language || 'Code'}</div>
          <pre>
            <code>{code.join('\n')}</code>
          </pre>
        </div>,
      );
      continue;
    }

    const title = heading(line);
    if (title) {
      const Heading = `h${title[1]!.length}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
      blocks.push(<Heading key={key}>{inline(title[2]!)}</Heading>);
      cursor++;
      continue;
    }

    const firstItem = listItem(line);
    if (firstItem) {
      const ordered = firstItem[1] !== undefined;
      const items: ReactNode[] = [];
      while (cursor < lines.length) {
        const item = listItem(lines[cursor]!);
        if (!item || (item[1] !== undefined) !== ordered) break;
        items.push(<li key={cursor}>{inline(item[2]!)}</li>);
        cursor++;
      }
      blocks.push(
        ordered ? (
          <ol key={key} start={Number(firstItem[1])}>
            {items}
          </ol>
        ) : (
          <ul key={key}>{items}</ul>
        ),
      );
      continue;
    }

    const paragraph = [line];
    cursor++;
    while (cursor < lines.length) {
      const next = lines[cursor]!;
      if (next.trim() === '' || openingFence(next) || heading(next) || listItem(next)) break;
      paragraph.push(next);
      cursor++;
    }
    blocks.push(<p key={key}>{inline(paragraph.join('\n'))}</p>);
  }

  return <div className="message-content">{blocks}</div>;
}
