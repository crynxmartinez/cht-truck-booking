import { messageCatalog, type CatalogEntry } from '@/lib/message-catalog';
import type { TemplateKey } from '@/lib/messages';
import { formatStamp } from '@/lib/dates';
import { loadSettings } from '@/lib/settings';
import { EDITABLE, LOCKED, defaultWording } from '@/lib/wording';
import { wordingHistory } from '@/lib/wording-db';
import { editedKeys, wordingFor } from '@/lib/wording-store';
import { WordingEditor, type VersionRow } from './WordingEditor';

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

type EditorData = { current: ReturnType<typeof defaultWording>; builtIn: ReturnType<typeof defaultWording>; edited: boolean; history: VersionRow[] };

function Entry({ e, editor }: { e: CatalogEntry; editor?: EditorData | 'locked' }) {
  return (
    <details style={{ borderTop: '1px solid var(--line, #e4e5e7)', padding: '10px 0' }}>
      <summary style={{ cursor: 'pointer' }}>
        <b>{e.title}</b>
        {editor && editor !== 'locked' && editor.edited ? <span className="tag amber" style={{ marginLeft: 8 }}>Edited</span> : null}
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

        {editor === 'locked' ? (
          <p className="tiny">
            The wording of this message changes depending on the situation (for example whether the pickup is today),
            so it cannot be edited here. Ask your developer if it needs changing.
          </p>
        ) : editor ? (
          <WordingEditor
            messageKey={e.key}
            current={editor.current}
            builtIn={editor.builtIn}
            edited={editor.edited}
            history={editor.history}
          />
        ) : null}
      </div>
    </details>
  );
}

/**
 * Every message the system sends, in one place, so the office can read the
 * wording without having to trigger a real send, and change what is sent to
 * renters. Built from the same functions the live sender uses, filled in with
 * a fake renter.
 */
export default async function MessagesPage() {
  await loadSettings({ force: true });

  const all = messageCatalog();
  const renter = all.filter((e) => e.audience === 'renter');
  const office = all.filter((e) => e.audience === 'office');
  const edited = new Set(editedKeys());

  const editorFor = async (key: string): Promise<EditorData | 'locked' | undefined> => {
    if (LOCKED.includes(key as TemplateKey)) return 'locked';
    if (!EDITABLE.includes(key as TemplateKey)) return undefined;
    const builtIn = defaultWording(key as TemplateKey);
    // Always, not only while it is edited: after a put-back the earlier versions
    // are still there, and this is how they are brought back.
    const history = (await wordingHistory(key as TemplateKey, 10)).map((h) => ({
      at: formatStamp(h.at),
      by: h.by,
      action: h.action,
      wording: h.wording,
    }));
    return { current: wordingFor(key) ?? builtIn, builtIn, edited: edited.has(key), history };
  };

  const editors = new Map<string, EditorData | 'locked' | undefined>();
  for (const e of renter) editors.set(e.key, await editorFor(e.key));

  return (
    <>
      <div className="topbar">
        <h1>Messages</h1>
      </div>
      <div className="content">
        <div className="panel">
          <h2>How to read this page</h2>
          <div className="hint" style={{ marginBottom: 0 }}>
            These are all the messages the system sends by itself. Click one to read its exact wording. The renter is
            called <b>Sample Renter</b> and the links are samples, so nothing here goes to a real person. To see what a
            real renter was sent, open their booking on the Board and look in its <b>Conversation</b> section.
            <br />
            <br />
            <b>You can change what renters are sent.</b> Open a message, change the words, preview it, and save. The
            parts that differ for each renter are written as {'{placeholders}'}, and a message cannot be saved without
            the ones it needs, such as the sign link or the lockbox code. You can always put the original back, and
            earlier versions are kept. Messages to the office are not editable here.
          </div>
        </div>

        <div className="panel">
          <h2>Sent to renters ({renter.length})</h2>
          <div className="hint">In roughly the order a rental runs.</div>
          {renter.map((e) => (
            <Entry key={`r-${e.key}`} e={e} editor={editors.get(e.key)} />
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
