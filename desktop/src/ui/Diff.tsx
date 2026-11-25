// A unified diff, rendered line by line. Shared by the Feature library, Ask & build,
// Next build and the Add favorite tile; kept out of any one view so a dashboard tile
// doesn't pull a whole view into the first chunk.
export function Diff({ text }: { text: string }) {
  const lines = text.split('\n').filter((l) => !/^(index |Submodule |new file mode)/.test(l));
  return (
    <pre className="diff" aria-label="The full change" tabIndex={0}>
      {lines.map((l, i) => {
        const k = l.startsWith('diff --git') ? 'file' : l.startsWith('@@') ? 'hunk' : l.startsWith('+') && !l.startsWith('+++') ? 'add' : l.startsWith('-') && !l.startsWith('---') ? 'del' : 'ctx';
        return <span key={i} className={`dl ${k}`}>{k === 'file' ? l.replace(/^diff --git a\/(\S+) b\/\S+$/, '$1') : l}{'\n'}</span>;
      })}
    </pre>
  );
}
