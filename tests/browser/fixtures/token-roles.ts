// Compile the real utility classes through the desktop source scan. The browser
// contract compares their computed styles with the existing scoped properties.
export const tokenRoleMarkup = `
  <div id="app-probe" class="h-control-standard border-solid border-standard border-line rounded-control bg-surface-main text-text text-control-label font-interface shadow-app-popover">Control</div>
  <div id="preview-scope">
    <div id="preview-probe" class="bg-surface-main text-text shadow-app-popover">Preview</div>
    <div class="reader-page" data-reader-theme="sepia">
      <div id="reader-probe" class="bg-reader-bg text-reader-text border-solid border-standard border-reader-line font-app-display text-body">Reader</div>
      <div id="app-in-reader" class="bg-surface-main text-text text-control-label">Application control in Reader</div>
    </div>
  </div>
  <div id="density-probe" class="h-collection-content"></div>
  <div id="motion-probe" class="transition-colors duration-fast ease-standard app-motion:motion-safe:animate-view-enter"></div>
`;
