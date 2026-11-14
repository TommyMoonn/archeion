import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  documentation: [
    { type: "category", label: "Overview", items: ["shell-overview"] },
    { type: "category", label: "Getting started", items: ["foundation", "shell-guide"] },
    { type: "category", label: "Reference", items: ["shell-reference"] },
  ],
};

export default sidebars;
