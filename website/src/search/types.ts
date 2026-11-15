export type SearchPage = {
  id: string;
  title: string;
  heading: string;
  description: string;
  overviewTitle: string;
  overviewDescription: string;
  group: string;
  href: string;
};

export type SearchEntry = SearchPage & {
  sectionId: string;
  sectionHeading: string;
  aliases: string[];
  text: string;
  excerpt: string;
};

export type DocsSearchData = { pages: SearchPage[]; entries: SearchEntry[] };
