process.loadEnvFile?.('.env');
async function main() {
  const { signedFilePath, verifyFileSignature } = await import('../src/lib/file-urls');
  const id = 'doc_test_123';

  const path = signedFilePath(id, 60);
  const q = new URLSearchParams(path.split('?')[1]);
  const e = q.get('e'), s = q.get('s');

  const cases: Array<[string, ReturnType<typeof verifyFileSignature>]> = [
    ['valid signature',        verifyFileSignature(id, e, s)],
    ['tampered signature',     verifyFileSignature(id, e, (s || '').slice(0, -2) + 'xx')],
    ['different document id',  verifyFileSignature('doc_other_456', e, s)],
    ['extended expiry',        verifyFileSignature(id, String(Number(e) + 86400), s)],
    ['already expired',        (() => { const p = signedFilePath(id, -10); const qq = new URLSearchParams(p.split('?')[1]); return verifyFileSignature(id, qq.get('e'), qq.get('s')); })()],
    ['no signature at all',    verifyFileSignature(id, e, null)],
    ['short signature',        verifyFileSignature(id, e, 'x')],
  ];

  for (const [label, r] of cases) {
    console.log(`${r.ok ? 'ALLOW' : 'DENY '}  ${label}${r.ok ? '' : `  (${r.reason})`}`);
  }
}
main();
