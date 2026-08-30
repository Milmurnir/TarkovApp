import { useCallback, useEffect, useRef, useState } from 'react';
import { formatSize, updates, type UpdateCheck, type UpdateInfo } from '../lib/updates';

type Phase = 'idle' | 'checking' | 'offered' | 'downloading' | 'ready' | 'error';

/**
 * The updater's whole face: a version button in the header, and a popup when a
 * new release is out. Nothing renders in the browser, where there is no shell
 * to update.
 */
export default function UpdateNotice() {
  const bridge = updates();
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<UpdateCheck | null>(null);
  const [progress, setProgress] = useState({ received: 0, total: 0 });
  const [message, setMessage] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  /** Set once the bundle is unpacked: only a restart is left. */
  const installed = useRef(false);

  const check = useCallback(async (announce: boolean) => {
    if (!bridge) return;
    setPhase('checking');
    setMessage(null);
    const found = await bridge.check();
    setResult(found);

    if (found.error) {
      // A failed check on startup stays quiet: GitHub being unreachable is not
      // something to interrupt someone loading into a raid with.
      setPhase(announce ? 'error' : 'idle');
      if (announce) {
        setMessage(found.error);
        setOpen(true);
      }
      return;
    }
    if (found.available) {
      setPhase('offered');
      setOpen(true);
      return;
    }
    setPhase('idle');
    if (announce) {
      setMessage(
        !found.configured ? 'Updates are not configured for this build.'
          : found.noReleases ? 'No release has been published yet.'
          : 'You are on the latest version.',
      );
    }
  }, [bridge]);

  useEffect(() => {
    if (!bridge) return;
    bridge.info().then((loaded) => {
      setInfo(loaded);
      if (loaded.configured && loaded.checkOnStartup) check(false);
    });
  }, [bridge, check]);

  useEffect(() => {
    if (!bridge) return;
    return bridge.onProgress(setProgress);
  }, [bridge]);

  // Feedback on a click answers that click; it should not sit in the header
  // forever afterwards. Errors shown in the popup stay until it is closed.
  useEffect(() => {
    if (!message || open) return;
    const timer = setTimeout(() => setMessage(null), 6000);
    return () => clearTimeout(timer);
  }, [message, open]);

  if (!bridge) return null;

  async function install() {
    if (!bridge) return;
    setPhase('downloading');
    setProgress({ received: 0, total: result?.size ?? 0 });
    const outcome = await bridge.download();

    if (!outcome.installed) {
      setPhase('error');
      setMessage(outcome.error ?? 'The update could not be installed.');
      return;
    }
    installed.current = true;
    setPhase('ready');
  }

  const percent = progress.total > 0 ? Math.round((progress.received / progress.total) * 100) : 0;
  const version = info ? info.uiVersion : '';
  // Dismissing the popup should not hide the update until the next launch: the
  // button turns into the way back to it.
  const waiting = !open && (phase === 'offered' || phase === 'ready');

  return (
    <>
      <div className="update-slot">
        {version && <span className="muted small">v{version}</span>}
        {message && <span className="muted small">{message}</span>}
        <button
          className={waiting ? 'update-check waiting' : 'update-check'}
          onClick={() => (waiting ? setOpen(true) : check(true))}
          disabled={phase === 'checking'}
        >
          {phase === 'checking' ? 'Checking...'
            : phase === 'ready' ? 'Restart to finish update'
            : waiting ? `Update to v${result?.version}`
            : 'Check for updates'}
        </button>
      </div>

      {open && (
        <div className="modal-backdrop" onClick={() => phase !== 'downloading' && setOpen(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h2>
              {phase === 'ready' ? 'Update installed'
                : phase === 'error' ? 'Update failed'
                : result?.requiresReinstall ? 'New version needs a reinstall'
                : 'Update available'}
            </h2>

            {result?.version && phase !== 'error' && (
              <p className="small">
                <strong>v{result.version}</strong>
                <span className="muted"> · you have v{result.currentVersion}</span>
                {result.size ? <span className="muted"> · {formatSize(result.size)}</span> : null}
              </p>
            )}

            {phase === 'error' && <p className="small error">{message}</p>}

            {phase === 'ready' && (
              <p className="small">Restart the app to start using v{result?.version}.</p>
            )}

            {/* A shell change cannot ride along in a bundle; say so plainly
                rather than downloading something that would not take effect. */}
            {phase === 'offered' && result?.requiresReinstall && (
              <p className="small">
                This release changes the app itself, not just its interface, so the in-app update
                cannot deliver it. Download the new version and install it over this one — your
                settings and cached quest data are kept.
              </p>
            )}

            {result?.notes && phase !== 'error' && (
              <pre className="update-notes">{result.notes}</pre>
            )}

            {phase === 'downloading' && (
              <div className="update-progress">
                <div className="update-bar"><span style={{ width: `${percent}%` }} /></div>
                <span className="muted small">
                  {percent}% · {formatSize(progress.received)}
                  {progress.total ? ` of ${formatSize(progress.total)}` : ''}
                </span>
              </div>
            )}

            <div className="modal-actions">
              {phase === 'offered' && result?.requiresReinstall && (
                result.appAssetUrl ? (
                  <button onClick={() => bridge.openRelease(result.appAssetUrl!)}>
                    Download app{result.appAssetSize ? ` (${formatSize(result.appAssetSize)})` : ''}
                  </button>
                ) : (
                  // Falls back to the release page itself if it was published
                  // without the packaged app attached -- still points somewhere.
                  <button onClick={() => result.releaseUrl && bridge.openRelease(result.releaseUrl)}>
                    Open download page
                  </button>
                )
              )}
              {phase === 'offered' && !result?.requiresReinstall && (
                <button className="primary" onClick={install}>Update now</button>
              )}
              {phase === 'ready' && (
                <button className="primary" onClick={() => bridge.restart()}>Restart now</button>
              )}
              {phase === 'error' && <button onClick={() => check(true)}>Try again</button>}
              <button onClick={() => setOpen(false)} disabled={phase === 'downloading'}>
                {phase === 'ready' ? 'Later' : 'Close'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
