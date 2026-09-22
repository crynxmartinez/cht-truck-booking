'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * The CRM's navigation, in two shapes.
 *
 * On a desktop it is the same fixed sidebar it always was. On a phone the
 * sidebar becomes a compact header and a drawer, because eight links wrapped
 * across three rows was eating half the screen before any content appeared —
 * and a phone is now the main way the office reaches this at all, since
 * GoHighLevel's mobile app will not show a custom menu link.
 */

export type NavCounts = { active: number; needsAttention: number; pendingSigs: number };

type Item = { href: string; label: string; count?: number };
type Group = { title: string; items: Item[] };

function groups(c: NavCounts): Group[] {
  return [
    {
      title: 'Operations',
      items: [
        { href: '/app', label: 'Board', count: c.active },
        { href: '/app/attention', label: 'Needs attention', count: c.needsAttention || undefined },
        { href: '/app/calendar', label: 'Calendar' },
      ],
    },
    {
      title: 'Fleet',
      items: [
        { href: '/app/trucks', label: 'Trucks & lockboxes' },
        { href: '/app/blackouts', label: 'Blackout dates' },
      ],
    },
    {
      title: 'System',
      items: [
        { href: '/app/notifications', label: 'Notifications', count: c.pendingSigs || undefined },
        { href: '/app/storage', label: 'Storage' },
        { href: '/app/settings', label: 'Settings' },
      ],
    },
  ];
}

/** Longest matching href wins, so /app does not claim /app/calendar. */
function activeHref(pathname: string, all: Item[]): string {
  let best = '';
  for (const i of all) {
    if ((pathname === i.href || pathname.startsWith(i.href + '/')) && i.href.length > best.length) {
      best = i.href;
    }
  }
  return best;
}

export function Nav({ counts }: { counts: NavCounts }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const gs = groups(counts);
  const all = gs.flatMap((g) => g.items);
  const current = activeHref(pathname, all);
  const title = all.find((i) => i.href === current)?.label ?? 'Truck Operations';

  // A tap on a link navigates without unmounting this component, so the drawer
  // has to be closed by the route change rather than by the click.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', esc);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', esc);
      document.body.style.overflow = '';
    };
  }, [open]);

  const alerts = (counts.needsAttention || 0) + (counts.pendingSigs || 0);

  const links = (
    <>
      {gs.map((g) => (
        <div key={g.title}>
          <div className="nav-group">{g.title}</div>
          {g.items.map((i) => (
            <Link key={i.href} href={i.href} className={i.href === current ? 'on' : undefined}>
              {i.label}
              {i.count ? <span className="count">{i.count}</span> : null}
            </Link>
          ))}
        </div>
      ))}
    </>
  );

  return (
    <>
      {/* phone header — hidden on desktop */}
      <header className="nav-top">
        <button
          className="nav-burger"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          aria-expanded={open}
        >
          <span />
          <span />
          <span />
          {alerts ? <i className="nav-burger-dot" /> : null}
        </button>
        <div className="nav-top-title">{title}</div>
        <div className="nav-top-brand">
          C<span style={{ color: 'var(--red)' }}>&#8962;</span>T
        </div>
      </header>

      {open ? <div className="nav-scrim" onClick={() => setOpen(false)} /> : null}

      <nav className={open ? 'nav open' : 'nav'} aria-label="Sections">
        <div className="nav-brand">
          <div className="logo">
            C<span style={{ color: 'var(--red)' }}>&#8962;</span>RY HOME TEAM
          </div>
          <div className="sub">Truck Operations</div>
          <button className="nav-close" onClick={() => setOpen(false)} aria-label="Close menu">
            &times;
          </button>
        </div>

        {links}

        <div className="nav-foot">Cory Home Team</div>
      </nav>
    </>
  );
}
