import { registerPlugin } from '@capacitor/core';

// This plugin enables Node.js backend on Android
const NodeJSMobile = registerPlugin('NodeJSMobile', {
  web: () => import('./web').then(m => new m.NodeJSMobileWeb()),
});

export * from './definitions';
export { NodeJSMobile };
