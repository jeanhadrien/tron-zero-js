import { JSDOM } from 'jsdom';
const dom = new JSDOM();
try {
  dom.window.document.createElement('canvas').getContext('2d');
} catch (e) {
  console.error("caught:", e);
}
