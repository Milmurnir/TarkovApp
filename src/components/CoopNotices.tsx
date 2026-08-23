import type { CoopRun } from '../lib/useCoopRun';

/**
 * What your friend just did, in the corner.
 *
 * Only their actions appear here — being told about your own clicks would be
 * noise — and each notice clears itself after a few seconds.
 */
export default function CoopNotices({ run }: { run: CoopRun }) {
  if (run.notices.length === 0) return null;

  return (
    <div className="coop-notices">
      {run.notices.map((notice) => (
        <button key={notice.id} className="coop-notice" onClick={() => run.dismissNotice(notice.id)}>
          {notice.text}
        </button>
      ))}
    </div>
  );
}
