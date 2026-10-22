import type { ReactNode } from 'react';
import Header from './Header';
import Footer from './Footer';
import Sidebar from './Sidebar';
import type { NavSection } from './Sidebar';
import Topbar from './Topbar';
import ConsoleHeaderMobile from './ConsoleHeaderMobile';
import type { NavItem } from '@/hooks/useBottomNav';

type LayoutNav = {
  items: NavItem[];
  sections?: NavSection[];
  active: string;
  onSelect: (item: NavItem) => void;
};

type LayoutProps = {
  title?: string;
  header?: ReactNode;        // 'public' chrome: replaces the default teal Header.
  headerActions?: ReactNode; // Forwarded to the desktop Topbar.
  headerActionsMobile?: ReactNode; // Icon buttons for the mobile console header.
  children: ReactNode;
  // 'public' (default) = marketing/legal pages → footer shown.
  // 'app' = logged-in mobile shell → no footer, tab bar fixed at the bottom (thumb zone).
  // 'console' = adaptive shell: Sidebar + Topbar on desktop (lg+), ConsoleHeaderMobile +
  //             BottomNav below lg - a single content tree for both.
  chrome?: 'app' | 'public' | 'console';
  bottomNav?: ReactNode;     // Rendered fixed at the bottom when chrome='app'.
  // Console-only fields (ignored by 'app'/'public').
  nav?: LayoutNav;
  subtitle?: string;
  sidebarFooter?: ReactNode;
  // Dashboards (employee/manager/owner) use their DashboardHero as the mobile header;
  // set this to drop ConsoleHeaderMobile so the header is not doubled.
  hideConsoleMobileHeader?: boolean;
  // Hides the desktop (lg+) Topbar without touching mobile. Dashboards use their
  // DashboardHero as the header, so the Topbar band would be redundant.
  hideConsoleTopbar?: boolean;
};

export default function Layout({
  title,
  header,
  headerActions,
  headerActionsMobile,
  children,
  chrome = 'public',
  bottomNav,
  nav,
  subtitle,
  sidebarFooter,
  hideConsoleMobileHeader,
  hideConsoleTopbar,
}: LayoutProps) {
  if (chrome === 'console') {
    return (
      <div className="flex min-h-[100dvh] flex-col lg:h-[100dvh] lg:flex-row lg:overflow-hidden">
        {/* Desktop (lg+): vertical sidebar on the left. */}
        {nav && (
          <Sidebar
            items={nav.items}
            sections={nav.sections}
            active={nav.active}
            onSelect={nav.onSelect}
            footer={sidebarFooter}
            subtitle={subtitle}
          />
        )}
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Mobile (<lg): console header, counterpart of the desktop Topbar. */}
          {!hideConsoleMobileHeader && (
            <ConsoleHeaderMobile title={title} subtitle={subtitle} actions={headerActionsMobile} />
          )}
          {/* Desktop (lg+): topbar. */}
          {!hideConsoleTopbar && (
            <Topbar title={title} subtitle={subtitle} actions={headerActions} />
          )}
          <main className="w-full flex-1 pb-24 lg:overflow-y-auto lg:pb-0"><h1 className="sr-only">Prim'O</h1>{children}</main>
          {/* Mobile (<lg): BottomNav, driven by the same nav object as the Sidebar. */}
          {nav && bottomNav}
        </div>
      </div>
    );
  }
  if (chrome === 'app') {
    return (
      <div className="flex min-h-[100dvh] flex-col">
        <Header title={title}>{headerActions}</Header>
        {/* Bottom padding keeps content clear of the fixed tab bar. */}
        <main className="w-full flex-1 pb-24 lg:pb-0"><h1 className="sr-only">Prim'O</h1>{children}</main>
        {bottomNav}
      </div>
    );
  }
  // Public: footer for marketing/legal pages. If a bottomNav is provided (e.g. the
  // landing page), it shows on mobile only and the footer moves to desktop.
  return (
    <div className="flex min-h-[100dvh] flex-col">
      {header ?? <Header title={title}>{headerActions}</Header>}
      <main className={`w-full flex-1 ${bottomNav ? 'pb-24 lg:pb-0' : ''}`}><h1 className="sr-only">Prim'O</h1>{children}</main>
      {bottomNav ? (
        <>
          <div className="lg:hidden">{bottomNav}</div>
          <div className="hidden lg:block"><Footer /></div>
        </>
      ) : (
        <Footer />
      )}
    </div>
  );
}
