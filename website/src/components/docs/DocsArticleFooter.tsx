export function DocsArticleFooter({ editUrl }: { editUrl?: string | null }) {
  return (
    <footer className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-caption text-content-muted">
      {editUrl && (
        <a
          href={editUrl}
          className="inline-flex min-h-9 items-center text-content-muted underline underline-offset-4 hover:text-content-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring pointer-coarse:min-h-11"
        >
          Edit this page
        </a>
      )}
      <a
        href="https://github.com/TommyMoonn/archeion/issues"
        className="inline-flex min-h-9 items-center text-content-muted underline underline-offset-4 hover:text-content-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring pointer-coarse:min-h-11"
      >
        Report a documentation issue
      </a>
    </footer>
  );
}
