export function DocsArticleFooter({ editUrl }: { editUrl?: string | null }) {
  return (
    <footer className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-caption text-content-muted">
      {editUrl && (
        <a
          href={editUrl}
          className="text-content-muted underline underline-offset-4 hover:text-content-strong"
        >
          Edit this page
        </a>
      )}
      <a
        href="https://github.com/TommyMoonn/archeion/issues"
        className="text-content-muted underline underline-offset-4 hover:text-content-strong"
      >
        Report a documentation issue
      </a>
    </footer>
  );
}
