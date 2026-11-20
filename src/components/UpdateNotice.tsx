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

  // Takes the just-fetched result as a parameter rather than reading `result`
  // from state: `check` calls this in the same tick as `setResult(found)`,
  // before that state update has actually landed.
  const install = useCallback(async (target: UpdateCheck | null) => {
    if (!bridge || !target) return;
    // Already downloaded last session and waiting on a restart.
    if (target.selfUpdateStaged) {
      installed.current = true;
      setPhase('ready');
      return;
    }
    // A new shell, on a shell that can swap itself: the whole app (~140 MB)
    // downloads in the background like a bundle would, and goes in on restart.
    const wholeApp = Boolean(target.requiresReinstall && target.canSelfUpdate && bridge.downloadApp);
    setPhase('downloading');
    setProgress({ received: 0, total: (wholeApp ? target.appAssetSize : target.size) ?? 0 });
    const outcome = wholeApp && bridge.downloadApp ? await bridge.downloadApp() : await bridge.download();

    if (!outcome.installed) {
      setPhase('error');
      setMessage(outcome.error ?? 'The update could not be installed.');
      return;
    }
    installed.current = true;
    setPhase('ready');
  }, [bridge]);

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
      if (found.requiresReinstall && !found.canSelfUpdate && !found.selfUpdateStaged) {
        // This build cannot swap itself (running from source, no app zip on
        // the release, or a swap that already failed): a human has to go get it.
        setOpen(true);
      } else {
        // Downloads quietly in the background -- no click needed, and no
        // popup stealing focus from someone mid-raid. It only takes effect
        // on the next restart regardless, whether that is "Restart now"
        // below or just closing and reopening the app later.
        install(found);
      }
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
  }, [bridge, install]);

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
          disabled={phase === 'checking' || phase === 'downloading'}
        >
          {phase === 'checking' ? 'Checking...'
            : phase === 'downloading' ? 'Updating...'
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
                {(() => {
                  const bytes = result.requiresReinstall ? result.appAssetSize : result.size;
                  return bytes ? <span className="muted"> · {formatSize(bytes)}</span> : null;
                })()}
              </p>
            )}

            {phase === 'error' && <p className="small error">{message}</p>}

            {phase === 'ready' && (
              <p className="small">
                {result?.requiresReinstall
                  ? `Restart to install v${result?.version}. The app closes, replaces itself and opens again on its own — give it a few seconds. Closing it any other way installs it on the next start.`
                  : `Restart the app to start using v${result?.version}.`}
              </p>
            )}

            {/* A shell change cannot ride along in a bundle; say so plainly
                rather than downloading something that would not take effect. */}
            {phase === 'offered' && result?.requiresReinstall && !result.canSelfUpdate && (
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
              {phase === 'offered' && result?.requiresReinstall && !result.canSelfUpdate && (
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
              {phase === 'ready' && (
                <button className="primary" onClick={() => bridge.restart()}>Restart now</button>
              )}
              {phase === 'error' && <button onClick={() => check(true)}>Try again</button>}
              {phase === 'error' && result?.requiresReinstall && result.appAssetUrl && (
                <button onClick={() => bridge.openRelease(result.appAssetUrl!)}>Download app instead</button>
              )}
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
