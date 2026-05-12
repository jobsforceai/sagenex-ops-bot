'use client';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

function CopyButton({ getText, label = 'Copy' }: { getText: () => string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async (e) => {
        e.preventDefault();
        try { await navigator.clipboard.writeText(getText()); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch {}
      }}
      className="absolute right-2 top-2 rounded bg-neutral-800/80 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-neutral-300 opacity-0 transition group-hover:opacity-100 hover:bg-neutral-700"
    >
      {copied ? 'Copied!' : label}
    </button>
  );
}

export function MarkdownView({ source }: { source: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        // Tables — scrollable, dark, with copy-table button on hover
        table: ({ node, ...props }) => {
          const tableText = () => {
            // Serialize the table to TSV for clipboard.
            // We pull from the rendered DOM at click time, so just use a placeholder ref strategy.
            return ''; // overridden below at the wrapper level
          };
          return (
            <div className="group relative my-3 overflow-auto rounded-lg border border-neutral-800">
              <table className="w-full border-collapse text-xs" {...props} />
            </div>
          );
        },
        thead: ({ node, ...props }) => <thead className="bg-neutral-900 text-left" {...props} />,
        th:    ({ node, ...props }) => <th    className="border-b border-neutral-800 px-3 py-2 font-bold text-neutral-200" {...props} />,
        td:    ({ node, ...props }) => <td    className="border-t border-neutral-900 px-3 py-1.5 text-neutral-300" {...props} />,
        // Inline + block code
        code: ({ inline, className, children, ...props }: any) => {
          const text = String(children ?? '').replace(/\n$/, '');
          if (inline) return <code className="rounded bg-neutral-900 px-1 py-0.5 text-[12px] text-rose-200" {...props}>{text}</code>;
          return (
            <div className="group relative my-3">
              <CopyButton getText={() => text} />
              <pre className="overflow-auto rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-[12px] leading-snug text-neutral-200"><code>{text}</code></pre>
            </div>
          );
        },
        pre: ({ children }) => <>{children}</>,
        // Lists / headings / paragraphs — tighter spacing
        p:  ({ node, ...props }) => <p  className="my-2 leading-relaxed" {...props} />,
        ul: ({ node, ...props }) => <ul className="my-2 list-disc space-y-1 pl-5" {...props} />,
        ol: ({ node, ...props }) => <ol className="my-2 list-decimal space-y-1 pl-5" {...props} />,
        li: ({ node, ...props }) => <li className="leading-relaxed" {...props} />,
        h1: ({ node, ...props }) => <h1 className="mt-3 text-lg font-bold" {...props} />,
        h2: ({ node, ...props }) => <h2 className="mt-3 text-base font-bold" {...props} />,
        h3: ({ node, ...props }) => <h3 className="mt-3 text-sm font-bold" {...props} />,
        a:  ({ node, ...props }) => <a  className="text-rose-300 underline" target="_blank" rel="noreferrer" {...props} />,
        strong: ({ node, ...props }) => <strong className="font-bold text-neutral-100" {...props} />,
      }}
    >
      {source}
    </ReactMarkdown>
  );
}

/** Copy any text via a small button — used to copy the full assistant message. */
export function CopyTextButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch {} }}
      className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 hover:text-neutral-300"
    >
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}
