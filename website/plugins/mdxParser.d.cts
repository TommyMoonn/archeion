declare function mdxParser(): Promise<ReturnType<typeof import("@mdx-js/mdx").createProcessor>>;
export = mdxParser;
