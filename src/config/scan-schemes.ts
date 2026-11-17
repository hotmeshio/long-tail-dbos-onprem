import type { LTScanSchemeConfig } from '@hotmeshio/long-tail';

import { ESCALATION_STATUS, ESCALATION_SUBTYPE, ROLE, SCAN_SCHEME, SHIP_VIA } from '../modules/constants';

const PENDING = ESCALATION_STATUS.PENDING;

/** A badge names who is acting; the next scan spends it. */
const badge: LTScanSchemeConfig = {
  version: SCAN_SCHEME.BADGE,
  name: 'Badge',
  kind: 'identity',
  target_facet: 'badge_id',
  encoding: 'delimited',
  grant_ttl_seconds: 120,
  grant_max_uses: 1,
  grant_scope: 'action',
  rules: [{ category: '0', name: 'Badge', steps: [], fallback: { markdown: 'Unknown badge. See a lead.' } }],
};

/** Scanning a boxed order holds it and names the bin it goes in. */
const packageScheme: LTScanSchemeConfig = {
  version: SCAN_SCHEME.PACKAGE,
  name: 'Package',
  target_facet: 'orderId',
  encoding: 'delimited',
  rules: [
    {
      category: '0',
      name: 'Hold the package',
      steps: [
        {
          query: { roles: [ROLE.PACKAGE], status: PENDING },
          verb: 'hold',
          params: {
            hold: {
              ttlSeconds: 300,
              label: '{scan.target}',
              headline: '{item.binKey}',
              expect: { schemes: [SCAN_SCHEME.BIN], prompt: 'Walk to this bin and scan it.' },
            },
          },
        },
      ],
    },
  ],
};

/** Scanning a bin places the held package in it, or shows the bin. */
const bin: LTScanSchemeConfig = {
  version: SCAN_SCHEME.BIN,
  name: 'Bin',
  target_facet: 'binKey',
  encoding: 'delimited',
  rules: [
    {
      category: '0',
      name: 'Place the package',
      steps: [
        {
          query: { roles: [ROLE.BIN], status: PENDING },
          verb: 'accumulate',
          requireActingIdentity: true,
          subject: { schemes: [SCAN_SCHEME.PACKAGE] },
          match: { target: ['{subject.binKey}'] },
          refuse: {
            markdown: "That's not this package's bin. It goes in **{subject.binKey}**.",
            conflict: 'That bin just closed. Scan the package again.',
            missing: 'That bin is closed. Scan the package again.',
          },
          done: { markdown: 'Drop it in **{container.binKey}**. All good.' },
          params: {
            itemKey: '{subject.orderId}',
            accumulate: { from: 'subject', container: { roles: [ROLE.BIN], subtypes: [ESCALATION_SUBTYPE.BIN] } },
          },
        },
        {
          query: { roles: [ROLE.BIN], status: PENDING },
          verb: 'present',
          facts: [
            { label: 'Bin', value: '{item.binKey}' },
            { label: 'Destination', value: '{item.destination}' },
            { label: 'Packages', value: '{item.accumulate_count} of {item.accumulate_max}' },
          ],
          choices: [
            {
              label: 'Ship now by courier',
              verb: 'resolve',
              roles: [ROLE.SHIFT_LEAD],
              requireActingIdentity: true,
              refuse: "A shift lead's badge is needed to ship a bin early.",
              confirm: { prompt: 'Ship this bin now by courier?' },
              params: { resolverPayload: { shipVia: SHIP_VIA.COURIER } },
            },
            { label: 'View details', verb: 'show-detail' },
          ],
        },
      ],
    },
  ],
};

/** Scanning a printer opens the frame waiting to come off it. */
const printer: LTScanSchemeConfig = {
  version: SCAN_SCHEME.PRINTER,
  name: 'Printer',
  target_facet: 'serialNumber',
  encoding: 'delimited',
  rules: [
    {
      category: '1',
      name: 'Unload this printer',
      steps: [{ query: { roles: [ROLE.PRINT_UNLOAD], status: PENDING }, verb: 'claim-show-detail' }],
      fallback: { markdown: 'Unload this printer once its print ends.' },
    },
  ],
};

export const scanSchemes: LTScanSchemeConfig[] = [badge, packageScheme, bin, printer];
