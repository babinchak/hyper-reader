"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type MarkdownProps = {
  content: string;
  className?: string;
};

export function Markdown({ content, className }: MarkdownProps) {
  return (
    <div
      className={[
        "select-text cursor-text",
        "text-sm leading-relaxed text-foreground",
        "space-y-3",
        className ?? "",
      ].join(" ")}
      onDragStart={(e) => {
        // If something upstream disables selection, browsers can start a drag gesture instead.
        // Prevent that so users can reliably highlight/copy AI output.
        e.preventDefault();
      }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, ...props }) => (
            <a
              {...props}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2 text-blue-700 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 break-words"
            >
              {children}
            </a>
          ),
          p: ({ children }) => (
            <p className="whitespace-pre-wrap break-words">{children}</p>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-foreground">{children}</strong>
          ),
          ul: ({ children }) => (
            <ul className="list-disc pl-6 space-y-1 marker:text-muted-foreground">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal pl-6 space-y-1 marker:text-muted-foreground">
              {children}
            </ol>
          ),
          li: ({ children }) => <li className="break-words">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-2 border-border pl-3 text-muted-foreground italic">
              {children}
            </blockquote>
          ),
          pre: ({ children, ...props }) => (
            <pre
              {...props}
              className="my-2 overflow-x-auto rounded-md bg-zinc-950 p-3 text-xs text-zinc-100"
            >
              {children}
            </pre>
          ),
          code: ({ className, children, ...props }) => {
            const text = Array.isArray(children)
              ? children.join("")
              : String(children ?? "");

            const isProbablyBlock =
              Boolean(className && className.includes("language-")) ||
              text.includes("\n");

            if (!isProbablyBlock) {
              return (
                <code
                  {...props}
                  className="rounded bg-zinc-200 px-1 py-0.5 font-mono text-[0.85em] text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                >
                  {children}
                </code>
              );
            }

            return (
              <code
                {...props}
                className={[
                  "block whitespace-pre",
                  className ?? "",
                ].join(" ")}
              >
                {text.replace(/\n$/, "")}
              </code>
            );
          },
          hr: () => <hr className="my-4 border-border" />,
          h1: ({ children }) => (
            <h1 className="mt-3 text-xl font-semibold leading-snug">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="mt-3 text-lg font-semibold leading-snug">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="mt-3 text-base font-semibold leading-snug">{children}</h3>
          ),
          h4: ({ children }) => (
            <h4 className="mt-3 text-sm font-semibold leading-snug">{children}</h4>
          ),
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto rounded-md border border-border">
              <table className="w-full border-collapse text-left text-xs">
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-b border-border bg-muted px-2 py-1 font-semibold">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b border-border px-2 py-1 align-top">
              {children}
            </td>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

