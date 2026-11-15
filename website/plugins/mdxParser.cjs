// Docusaurus loads TS config through Jiti 1, which rewrites dynamic imports to
// require. Keep the ESM-only MDX parser behind Node's native CJS import boundary.
module.exports = async function mdxParser() {
  const [{ createProcessor }, { default: remarkGfm }] = await Promise.all([
    import("@mdx-js/mdx"),
    import("remark-gfm"),
  ]);
  return createProcessor({ remarkPlugins: [remarkGfm] });
};
