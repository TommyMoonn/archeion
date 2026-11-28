import { Component, Suspense, type ReactNode } from "react";
import {
  UtilityWindowLoading,
  UtilityWindowLoadStatus,
} from "../components/UtilityWindowLoadStatus";
import {
  AboutLayout,
  AboutLoading,
  aboutWindowShellClassName,
} from "../features/about/AboutLayout";
import { SettingsWindowLayout } from "../features/settings/SettingsWindowLayout";
import { ThemeManagerLayout } from "../features/themes/ThemeManagerLayout";
import {
  ABOUT_MAIN_CONTENT_ID,
  SETTINGS_MAIN_CONTENT_ID,
  THEME_MANAGER_MAIN_CONTENT_ID,
  SkipLink,
} from "../components/SkipLink";
import { WindowTitlebar } from "../components/WindowTitlebar";

const windows = {
  about: { title: "About Archeion", mainId: ABOUT_MAIN_CONTENT_ID, Layout: AboutLayout },
  settings: { title: "Settings", mainId: SETTINGS_MAIN_CONTENT_ID, Layout: SettingsWindowLayout },
  "theme-manager": {
    title: "Theme Manager",
    mainId: THEME_MANAGER_MAIN_CONTENT_ID,
    Layout: ThemeManagerLayout,
  },
} as const;

type UtilityWindowMode = keyof typeof windows;

// Content can fail without replacing the themed frame or native controls.
export class UtilityWindowContentBoundary extends Component<
  {
    children: ReactNode;
    fallback: ReactNode;
  },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function UtilityWindowFrame({
  mode,
  children,
}: {
  mode: UtilityWindowMode;
  children: ReactNode;
}) {
  const { title, mainId, Layout } = windows[mode];
  return (
    <div className={`window-app window-app--${mode}`}>
      <SkipLink targetId={windows[mode].mainId} />
      <WindowTitlebar canMaximize={mode !== "about"} utility />
      <div className="window-app__content">
        <main
          className={
            mode === "about"
              ? aboutWindowShellClassName
              : `${mode}-window-shell size-full min-w-0 min-h-0${mode === "theme-manager" ? " flex" : ""}`
          }
          id={mainId}
          tabIndex={-1}
        >
          <Layout>
            <UtilityWindowContentBoundary
              fallback={
                mode === "about" ? (
                  <AboutLoading failed />
                ) : (
                  <UtilityWindowLoadStatus title={title} state="error" />
                )
              }
            >
              <Suspense
                fallback={
                  mode === "about" ? <AboutLoading /> : <UtilityWindowLoading title={title} />
                }
              >
                {children}
              </Suspense>
            </UtilityWindowContentBoundary>
          </Layout>
        </main>
      </div>
    </div>
  );
}
