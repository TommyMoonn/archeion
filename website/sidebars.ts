import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  documentation: [
    { type: "category", label: "Overview", items: ["overview"] },
    {
      type: "category",
      label: "Getting started",
      items: ["installing", "archives", "adding-books"],
    },
    {
      type: "category",
      label: "Using Archeion",
      items: [
        "library",
        "archive-health",
        "quick-actions",
        "metadata-covers",
        "series",
        "reading",
        "reader-navigation",
        "reader-media",
        "file-management",
        "settings",
        "dictionaries",
        "keyboard-shortcuts",
      ],
    },
    {
      type: "category",
      label: "Customization",
      items: ["appearance", "custom-themes", "theme-manager"],
    },
    {
      type: "category",
      label: "Reference",
      items: ["archive-storage", "troubleshooting", "annotation-export", "about-resources"],
    },
    { type: "category", label: "Changelog", items: ["changelog"] },
  ],
};

export default sidebars;
