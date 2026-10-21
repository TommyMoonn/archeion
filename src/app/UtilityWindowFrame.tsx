import { Component, Suspense, type ReactNode } from "react";
import {
  UtilityWindowLoading,
  UtilityWindowLoadStatus,
} from "../components/UtilityWindowLoadStatus";
import { AboutLayout } from "../features/about/AboutLayout";
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

function AboutLoading({ failed = false }: { failed?: boolean }) {
  return (
    <>
      {failed ? (
        <UtilityWindowLoadStatus title="About Archeion" state="error" />
      ) : (
        <UtilityWindowLoading title="About Archeion" />
      )}
      <div aria-hidden="true" className="about-window__links">
        {Array.from({ length: 4 }, (_, index) => (
          <span className="about-window__link utility-placeholder" key={index}>
            <span className="about-window__link-copy">
              <strong>&nbsp;</strong>
              <small>&nbsp;</small>
            </span>
          </span>
        ))}
      </div>
    </>
  );
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
      <WindowTitlebar canMaximize={mode !== "about"} />
      <div className="window-app__content">
        <main className={`${mode}-window-shell`} id={mainId} tabIndex={-1}>
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
