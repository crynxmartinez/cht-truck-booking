import { messageCatalog, type CatalogEntry } from '@/lib/message-catalog';

export const dynamic = 'force-dynamic';

const BODY: React.CSSProperties = {
  whiteSpace: 'pre-wrap',
  margin: '4px 0 12px',
  padding: '10px 12px',
  background: 'var(--bg, #f6f6f7)',
  borderRadius: 8,
  fontSize: 13,
  lineHeight: 1.5,
};

function Entry({ e }: { e: CatalogEntry }) {
  return (
    <details style={{ borderTop: '1px solid var(--line, #e4e5e7)', padding: '10px 0' }}>
      <summary style={{ cursor: 'pointer' }}>
        <b>{e.title}</b>
        <div className="tiny" style={{ marginTop: 2 }}>
          {e.when}
        </div>
      </summary>
      <div style={{ marginTop: 8 }}>
        <div className="tiny">Email subject</div>
        <div style={BODY}>{e.subject}</div>
        <div className="tiny">Text message</div>
        <div style={BODY}>{e.sms}</div>
        <div className="tiny">Email</div>
        <div style={BODY}>{e.email}</div>
      </div>
    </details>
  );
}

/**
 * Every message the system sends, in one place, so the office can read the
 * wording without having to trigger a real send. Built from the same
 * functions the live sender uses, filled in with a fake renter.
 */
export default function MessagesPage() {
  const all = messageCatalog();
  const renter = all.filter((e) => e.audience === 'renter');
  const office = all.filter((e) => e.audience === 'office');

  return (
    <>
      <div className="topbar">
        <h1>Messages</h1>
      </div>
      <div className="content">
        <div className="panel">
          <h2>How to read this page</h2>
          <div className="hint" style={{ marginBottom: 0 }}>
            These are all the messages the system sends by itself. Click one to read its exact wording. The
            renter is called <b>Sample Renter</b> and the links are samples, so nothing here goes to a real
            person. To see what a real renter was sent, open their booking on the Board and click a message
            under <b>Messages</b>.
          </div>
        </div>

        <div className="panel">
          <h2>Sent to renters ({renter.length})</h2>
          <div className="hint">In roughly the order a rental runs.</div>
          {renter.map((e) => (
            <Entry key={`r-${e.key}`} e={e} />
          ))}
        </div>

        <div className="panel">
          <h2>Sent to the office ({office.length})</h2>
          <div className="hint">Every person on the Notifications list gets these.</div>
          {office.map((e) => (
            <Entry key={`o-${e.key}`} e={e} />
          ))}
        </div>
      </div>
    </>
  );
}
