import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { detectWipe, finishedSince, parseSinceDate, type GameLogEvent } from '../src/lib/gameLogs';
import { requireCjs } from './helpers';

const { parseFile, sessionStart } = requireCjs('../electron/gameLogs.cjs');

const QUEST = '5936d90786f7742b1420ba5b';
const OTHER = '59674cd986f7744ab26e32f2';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tqr-logs-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

function logFile(text: string): string {
  const file = path.join(dir, `${Math.random().toString(36).slice(2)}.log`);
  fs.writeFileSync(file, text);
  return file;
}

function notification(type: number, templateId: string, dt?: number): string {
  return JSON.stringify({ type: 'new_message', message: { type, templateId, ...(dt ? { dt } : {}) } }, null, 2);
}

describe('parseFile', () => {
  it('reads started, failed and finished quest notifications', () => {
    const file = logFile([
      '2026-11-19 20:15:01.123|1.0|Info|push-notifications|Got notification | ChatMessageReceived',
      notification(10, `${QUEST} description`, 1_700_000_000),
      '2026-11-19 20:30:00.000|1.0|Info|push-notifications|Got notification | ChatMessageReceived',
      notification(12, `${QUEST} successMessageText 1234`),
      '2026-11-19 20:31:00.000|1.0|Info|push-notifications|Got notification | ChatMessageReceived',
      notification(11, `${OTHER} failMessageText`, 1_700_000_100),
    ].join('\r\n'));

    const events = parseFile(file, 42);
    expect(events).toEqual([
      { id: QUEST, status: 'started', at: 1_700_000_000_000, session: 42 },
      { id: QUEST, status: 'finished', at: new Date(2026, 10, 19, 20, 30, 0).getTime(), session: 42 },
      { id: OTHER, status: 'failed', at: 1_700_000_100_000, session: 42 },
    ]);
  });

  it('skips other messages, other log lines and a broken block', () => {
    const file = logFile([
      '2026-11-19 20:15:01|1.0|Info|push-notifications|Got notification | ChatMessageReceived',
      notification(4, `${QUEST} description`),
      '2026-11-19 20:15:02|1.0|Info|push-notifications|Something else entirely',
      notification(12, `${QUEST} description`),
      '2026-11-19 20:15:03|1.0|Info|push-notifications|Got notification | ChatMessageReceived',
      '{ "message": { "type": 12, ',
      '2026-11-19 20:15:04|1.0|Info|push-notifications|Got notification | ChatMessageReceived',
      notification(12, 'not-an-id description'),
      '2026-11-19 20:15:05|1.0|Info|push-notifications|Got notification | ChatMessageReceived',
      notification(12, `${OTHER} successMessageText`, 5),
    ].join('\n'));

    expect(parseFile(file, 1).map((e: GameLogEvent) => e.id)).toEqual([OTHER]);
  });

  it('returns nothing for a file it cannot read', () => {
    expect(parseFile(path.join(dir, 'missing.log'), 0)).toEqual([]);
  });
});

describe('sessionStart', () => {
  it('reads the local start time from the folder name', () => {
    expect(sessionStart('log_2026.11.19_20-10-49_1.3.0.2.48779')).toBe(new Date(2026, 10, 19, 20, 10, 49).getTime());
    expect(sessionStart('something else')).toBe(0);
  });
});

describe('wipe detection', () => {
  const known = new Set([QUEST, OTHER]);
  const ev = (id: string, status: GameLogEvent['status'], at: number, session: number): GameLogEvent => ({ id, status, at, session });

  it('finds no wipe when nothing was started twice', () => {
    expect(detectWipe([ev(QUEST, 'started', 1, 0), ev(QUEST, 'finished', 2, 0)], known)).toBeNull();
  });

  it('cuts at the session where a finished quest was started again', () => {
    const events = [
      ev(QUEST, 'started', 10, 0), ev(QUEST, 'finished', 20, 0),
      ev(OTHER, 'finished', 150, 100),
      ev(QUEST, 'started', 200, 100),
    ];
    const cutoff = detectWipe(events, known);
    expect(cutoff).toBe(100);
    // Finished earlier in that same first post-wipe session still counts.
    expect(finishedSince(events, known, cutoff)).toEqual([OTHER]);
  });

  it('ignores repeatables that are not in the quest data', () => {
    const daily = 'aaaaaaaaaaaaaaaaaaaaaaaa';
    expect(detectWipe([ev(daily, 'finished', 1, 0), ev(daily, 'started', 2, 5)], known)).toBeNull();
  });

  it('reads a date input as local midnight', () => {
    expect(parseSinceDate('2026-08-01')).toBe(new Date(2026, 7, 1).getTime());
    expect(parseSinceDate('08/01/2026')).toBeNull();
    expect(parseSinceDate(null)).toBeNull();
  });
});
