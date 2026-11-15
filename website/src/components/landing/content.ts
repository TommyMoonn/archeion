import { BookOpen, Bookmark, Folder, Layers, Search, type LucideIcon } from "lucide-react";

export const landingLinks = {
  installer:
    "https://github.com/TommyMoonn/archeion/releases/latest/download/Archeion-Setup-x64.exe",
  source: "https://github.com/TommyMoonn/archeion",
  releases: "https://github.com/TommyMoonn/archeion/releases",
  documentation: "/archeion/docs/",
};

export const landingMetadata = {
  title: "Archeion - Local-first EPUB Library and Reader",
  description:
    "Archeion is a local-first Windows desktop app for organizing and reading EPUB libraries. Keep your books as normal files, with no account, cloud service, or telemetry.",
  url: "https://tommymoonn.github.io/archeion/",
  image: "https://tommymoonn.github.io/archeion/assets/archeion-preview.png",
};

export const landingSections = [
  { id: "library", label: "Library" },
  { id: "reading", label: "Reading" },
  { id: "files", label: "Your files" },
] as const;
export type LandingSectionId = (typeof landingSections)[number]["id"];

export interface LandingFeature {
  title: string;
  description: string;
  icon: LucideIcon;
}

export const libraryFeatures: readonly LandingFeature[] = [
  {
    title: "Folders and series",
    description: "Browse your existing folders or group books by their EPUB series.",
    icon: Folder,
  },
  {
    title: "Search and filters",
    description:
      "Search your books, sort results, and filter by series, subject, language, publisher, or reading status.",
    icon: Search,
  },
  {
    title: "Batch actions",
    description:
      "Move selected books, update book details, regenerate covers, and export annotations.",
    icon: Layers,
  },
];

export const readingFeatures: readonly LandingFeature[] = [
  {
    title: "Reader settings",
    description:
      "Choose paged or continuous reading, typeface, line spacing, page width, and colors.",
    icon: BookOpen,
  },
  {
    title: "Bookmarks and highlights",
    description: "Save reading positions, highlight passages in four colors, and add notes.",
    icon: Bookmark,
  },
  {
    title: "Offline dictionaries",
    description: "Install compatible dictionaries to look up selected words offline.",
    icon: Search,
  },
];

export const archiveTree = `Your Archive/
├── Meditations.epub
├── Series/
│   └── Crime and Punishment.epub
└── .archeion/
    ├── annotations.json
    ├── library.json
    ├── progress.json
    ├── scanner-cache.json
    ├── covers/
    └── backups/
        ├── annotations/
        ├── epub-writeback/
        ├── library/
        ├── progress/
        └── scanner-cache/`;
