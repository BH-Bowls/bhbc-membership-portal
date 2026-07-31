// src/components/RichText.tsx
// Renders committee-entered rules text. Only <b>, <i> and <u> are allowed inline;
// everything else is HTML-escaped. Lines that start with a list marker the editor
// typed themselves — "1." / "2." (numbers) or "a)" / "b)" (letters) — are laid out as
// a proper list with a hanging indent (wrapped lines align under the text, letters
// indent under numbers). Blank lines become vertical gaps. No Markdown library.

import React from 'react';

/** Escape all HTML, then re-allow only <b>/<i>/<u> (and their closing tags). */
export function toSafeRulesHtml(raw: string): string {
  const escaped = (raw || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped.replace(/&lt;(\/?)(b|i|u)&gt;/gi, '<$1$2>');
}

// A number marker like "1." or "2)" starts a top-level item; a single letter like
// "a)" or "b." starts an indented sub-item.
const NUMBER_ITEM = /^\s*(\d+[.)])\s+(.*)$/;
const LETTER_ITEM = /^\s*([a-z][.)])\s+(.*)$/i;

function Html({ text, className }: { text: string; className?: string }) {
  return <span className={className} dangerouslySetInnerHTML={{ __html: toSafeRulesHtml(text) }} />;
}

/** One list item: marker in a fixed column, content flowing (and wrapping) beside it. */
function Item({ marker, content, indent }: { marker: string; content: string; indent: boolean }) {
  return (
    <div className="flex gap-2 mb-1" style={indent ? { marginLeft: '1.5rem' } : undefined}>
      <span className="flex-shrink-0" style={{ minWidth: '1.5em' }}>{marker}</span>
      <Html text={content} className="flex-1" />
    </div>
  );
}

export function RichText({ text, className }: { text: string | null | undefined; className?: string }) {
  if (!text || !text.trim()) return null;

  const lines = text.replace(/\r\n/g, '\n').split('\n');

  return (
    <div className={className}>
      {lines.map((line, i) => {
        if (!line.trim()) return <div key={i} className="h-2" />;

        const num = line.match(NUMBER_ITEM);
        if (num) return <Item key={i} marker={num[1]} content={num[2]} indent={false} />;

        const letter = line.match(LETTER_ITEM);
        if (letter) return <Item key={i} marker={letter[1]} content={letter[2]} indent={true} />;

        return <Html key={i} text={line} className="block mb-1" />;
      })}
    </div>
  );
}
