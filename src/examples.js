// Example maps, opened with ?example=<id> and listed on examples.html.
import { pinAt } from './doc.js';

export const examples = [
  {
    id: 'loop',
    title: 'The Loop',
    description: 'The default view over the Pedway core, with nothing added.',
    tags: ['start'],
    document: { src: 'The Loop', map: {} },
  },
  {
    id: 'stations',
    title: 'Pedway train connections',
    description: 'Metra and CTA stations with a Pedway connection, pinned.',
    tags: ['transit'],
    document: { src: 'Pedway train connections', map: {
      view: { c: [41.8835, -87.6305], z: 15 },
      pins: [
        pinAt(41.8826, -87.6402, { id: 'ogilvie', label: 'Ogilvie Transportation Center', icon: 'train', md: 'Metra **Union Pacific** lines.' }),
        pinAt(41.8846, -87.6245, { id: 'millennium', label: 'Millennium Station', icon: 'train', md: 'Metra Electric and South Shore Line.' }),
        pinAt(41.8857, -87.6308, { id: 'clark-lake', label: 'Clark/Lake', icon: 'train', md: 'CTA Blue, Brown, Green, Orange, Pink and Purple lines.' }),
        pinAt(41.8836, -87.6278, { id: 'washington', label: 'Washington (Red)', icon: 'train', md: 'CTA Red Line, under State Street.' }),
      ],
    } },
  },
  {
    id: 'meet',
    title: 'Meet at Macy’s',
    description: 'A single pin with a markdown note and a link — the kind of map you’d send a friend.',
    tags: ['pins'],
    document: { src: 'Meet at Macy’s', map: {
      view: { c: [41.8838, -87.6275], z: 18 },
      pins: [pinAt(41.88385, -87.62755, { id: 'meet', label: 'Meet here', icon: 'star', color: '#8e44ad',
        md: 'Pedway level, by the **Macy’s** entrance.\n\n[See it on OpenStreetMap](https://www.openstreetmap.org/?mlat=41.88385&mlon=-87.62755#map=19/41.88385/-87.62755)' })],
    } },
  },
];
