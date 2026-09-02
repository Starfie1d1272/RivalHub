import React from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

type MarkdownDocumentProps = {
  children: string;
  omitLeadingH1?: boolean;
};

// The page shell owns the canonical document title; preserve any later H1s.
const leadingH1Pattern = /^(?:\uFEFF)?[ \t]*#[ \t]+[^\r\n]*(?:\r?\n|$)/;

const markdownComponents: Components = {
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1 className="mt-10 text-2xl font-semibold tracking-tight text-[var(--color-fg)]">{children}</h1>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2 className="mt-10 border-b border-[var(--color-border)] pb-2 text-xl font-semibold tracking-tight text-[var(--color-fg)]">{children}</h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="mt-8 text-lg font-semibold text-[var(--color-fg)]">{children}</h3>
  ),
  h4: ({ children }: { children?: React.ReactNode }) => (
    <h4 className="mt-6 text-base font-semibold text-[var(--color-fg)]">{children}</h4>
  ),
  p: ({ children }: { children?: React.ReactNode }) => <p className="my-4">{children}</p>,
  strong: ({ children }: { children?: React.ReactNode }) => <strong className="font-semibold text-[var(--color-fg)]">{children}</strong>,
  em: ({ children }: { children?: React.ReactNode }) => <em className="italic">{children}</em>,
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="my-5 border-l-2 border-[var(--color-accent)] bg-[var(--color-panel-low)] px-4 py-3 text-[var(--color-fg-mid)]">{children}</blockquote>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => <ul className="my-4 list-disc space-y-1 pl-6">{children}</ul>,
  ol: ({ children }: { children?: React.ReactNode }) => <ol className="my-4 list-decimal space-y-1 pl-6">{children}</ol>,
  li: ({ children }: { children?: React.ReactNode }) => <li className="pl-1">{children}</li>,
  a: ({ children, href }: { children?: React.ReactNode; href?: string }) => (
    <a className="text-[var(--color-accent)] underline decoration-[var(--color-accent-edge)] underline-offset-4 hover:text-[var(--color-fg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]" href={href}>{children}</a>
  ),
  hr: () => <hr className="my-8 border-0 border-t border-[var(--color-border)]" />,
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="my-5 max-w-full overflow-x-auto rounded-sm border border-[var(--color-border)] bg-[var(--color-panel)]">
      <table className="w-full min-w-[34rem] border-collapse text-left text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }: { children?: React.ReactNode }) => <thead className="bg-[var(--color-panel-hi)]">{children}</thead>,
  th: ({ children }: { children?: React.ReactNode }) => <th className="border-b border-[var(--color-border-hi)] px-3 py-2 text-left font-semibold text-[var(--color-fg)]">{children}</th>,
  td: ({ children }: { children?: React.ReactNode }) => <td className="border-t border-[var(--color-border)] px-3 py-2 align-top">{children}</td>,
  code: ({ children }: { children?: React.ReactNode }) => <code className="rounded-sm bg-[var(--color-panel-hi)] px-1.5 py-0.5 font-mono text-[0.9em]">{children}</code>,
  pre: ({ children }: { children?: React.ReactNode }) => <pre className="my-5 max-w-full overflow-x-auto rounded-sm border border-[var(--color-border)] bg-[var(--color-panel-low)] p-4 font-mono text-sm leading-6">{children}</pre>,
  del: ({ children }: { children?: React.ReactNode }) => <del className="text-[var(--color-fg-mid)]">{children}</del>,
};

function normalizeMarkdown(markdown: string, omitLeadingH1: boolean) {
  return omitLeadingH1 ? markdown.replace(leadingH1Pattern, "") : markdown;
}

export function MarkdownDocument({ children, omitLeadingH1 = false }: MarkdownDocumentProps) {
  return (
    <article className="min-w-0 break-words text-sm leading-7 text-[var(--color-fg)]">
      <Markdown remarkPlugins={[remarkGfm]} skipHtml components={markdownComponents}>
        {normalizeMarkdown(children, omitLeadingH1)}
      </Markdown>
    </article>
  );
}
