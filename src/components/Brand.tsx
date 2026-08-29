import { config } from '@/lib/config';

export function CardHeader({ subtitle, dots }: { subtitle: string; dots?: { total: number; active: number } }) {
  return (
    <div className="card-hd">
      <div className="logo">
        C<em>&#8962;</em>RY HOME TEAM
      </div>
      <div className="card-sub">{subtitle}</div>
      {dots ? (
        <div className="dots">
          {Array.from({ length: dots.total }, (_, i) => (
            <i key={i} className={i <= dots.active ? 'on' : undefined} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function PageFooter() {
  return (
    <div className="pagefoot">
      Cory Home Team &middot; {config.pickupAddress}
    </div>
  );
}

/** Shown when a token is unknown, already used, or the booking was cancelled. */
export function DeadLink({ title, body }: { title: string; body: string }) {
  return (
    <div className="shell">
      <div className="card">
        <CardHeader subtitle="Truck Rental" />
        <div className="card-bd center" style={{ padding: '44px 24px 48px' }}>
          <h1>{title}</h1>
          <p className="lede" style={{ marginBottom: 0 }}>
            {body}
          </p>
        </div>
      </div>
      <PageFooter />
    </div>
  );
}
