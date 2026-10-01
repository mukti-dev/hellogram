import { Fragment, type ReactNode } from 'react';

/** Tiny Markdown renderer for our own static legal pages (headings, lists, bold, italics). */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|_[^_]+_)/g).map((part, i) =>
    part.startsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part.startsWith('_') && part.endsWith('_') ? <em key={i}>{part.slice(1, -1)}</em> : <Fragment key={i}>{part}</Fragment>,
  );
}

export function Markdown({ source }: { source: string }) {
  const blocks = source.trim().split(/\n{2,}/);
  return (
    <div className="flex flex-col gap-4 leading-relaxed">
      {blocks.map((block, i) => {
        if (block.startsWith('# ')) return <h1 key={i} className="text-3xl font-bold tracking-tight">{block.slice(2)}</h1>;
        if (block.startsWith('## ')) return <h2 key={i} className="mt-2 text-xl font-semibold">{block.slice(3)}</h2>;
        if (block.split('\n').every((l) => l.startsWith('- '))) {
          return (
            <ul key={i} className="list-disc pl-6">
              {block.split('\n').map((l, j) => <li key={j}>{inline(l.slice(2))}</li>)}
            </ul>
          );
        }
        return <p key={i} className="text-muted">{inline(block)}</p>;
      })}
    </div>
  );
}
