import { Machines } from '@hotmeshio/long-tail';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LOG_EVENTS } from '../../../src/modules/constants';
import { stubFetch } from '../../helpers/fetch-stub';
import { spyOnLog } from '../../helpers/log-spy';
import { ARTIFACT_URL, dispatchArgs, makePrinterHarness, stubArtifact, type PrinterHarness } from '../../helpers/printer-harness';

const { CHANNEL, OP, REPLY_STATUS } = Machines;
const JOB_ID = 'A-1042-print';

let rig: PrinterHarness;
let logged: ReturnType<typeof spyOnLog>;

beforeEach(async () => {
  logged = spyOnLog();
  rig = makePrinterHarness();
  await rig.printer.start();
});

afterEach(async () => {
  await rig.settle();
  await rig.printer.stop();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('MockPrinter dispatch refusals', () => {
  it.each([
    ['no job id', { jobId: undefined }],
    ['no recipe', { recipe: undefined }],
    ['a recipe with no id', { recipe: { version: '1' } }],
    ['no units', { units: [] }],
    ['units that are not a list', { units: 'A-1042-1' }],
  ])('refuses a dispatch with %s', async (_name, overrides) => {
    const artifact = stubArtifact();
    const cmdId = rig.send(OP.DISPATCH, dispatchArgs(overrides));
    await rig.settle();
    expect(rig.replies()).toEqual([{ cmdId, status: REPLY_STATUS.REFUSED, reason: 'missing jobId, recipe or units' }]);
    expect(artifact.calls).toEqual([]);
    expect(rig.jobEvents()).toEqual([]);
  });

  it.each([
    ['no artifact', { artifact: undefined }],
    ['an artifact with no url', { artifact: { sha256: 'abc' } }],
    ['an artifact with no checksum', { artifact: { url: ARTIFACT_URL } }],
  ])('refuses a dispatch with %s', async (_name, overrides) => {
    const cmdId = rig.send(OP.DISPATCH, dispatchArgs(overrides));
    await rig.settle();
    expect(rig.replies()).toEqual([{ cmdId, status: REPLY_STATUS.REFUSED, reason: 'missing artifact' }]);
    expect(rig.jobEvents()).toEqual([]);
  });

  it('refuses an expired dispatch without fetching the file', async () => {
    const artifact = stubArtifact();
    const expiresAt = new Date(Date.now() - 1).toISOString();
    rig.send(OP.DISPATCH, dispatchArgs({ expiresAt }));
    await rig.settle();
    expect(rig.replies()[0]).toMatchObject({ status: REPLY_STATUS.REFUSED, reason: `expired at ${expiresAt}` });
    expect(artifact.calls).toEqual([]);
  });

  it.each([
    ['a file that does not match its checksum', () => stubArtifact('other bytes'), 'artifact checksum mismatch'],
    ['a file the server does not have', () => stubFetch({ 'GET /esc-1/round-48.gcode.3mf': { status: 404, text: 'not found', contentType: 'text/plain' } }), 'artifact fetch 404'],
    ['a server out of reach', () => stubFetch({ 'GET /esc-1/round-48.gcode.3mf': new TypeError('fetch failed') }), 'artifact fetch failed: fetch failed'],
  ])('fails a dispatch for %s', async (_name, stub, reason) => {
    stub();
    const cmdId = rig.send(OP.DISPATCH, dispatchArgs());
    await rig.settle();
    expect(rig.replies()).toEqual([{ cmdId, status: REPLY_STATUS.FAILED, reason }]);
    expect(rig.jobEvents()).toEqual([]);
    expect(rig.retained(CHANNEL.SNAPSHOT)!.jobs).toEqual([]);
    expect(logged.contexts(LOG_EVENTS.PRINTER_JOB_FAILED)).toEqual([{ jobId: JOB_ID, reason }]);
  });

  it('takes the same job again, under a new command id, once the file is right', async () => {
    stubArtifact('other bytes');
    rig.send(OP.DISPATCH, dispatchArgs());
    await rig.settle();
    stubArtifact();
    const cmdId = rig.send(OP.DISPATCH, dispatchArgs());
    await rig.settle();
    expect(rig.replies()[1]).toEqual({ cmdId, status: REPLY_STATUS.ACCEPTED, reason: `queued ${JOB_ID}` });
  });
});
