import { JSDOM } from 'jsdom';
const dom = new JSDOM();
const g = global as any;
g.window = dom.window;
g.document = dom.window.document;
const canvas = dom.window.document.createElement('canvas');
g.HTMLCanvasElement = canvas.constructor;
g.HTMLCanvasElement.prototype.getContext = function(type: string) {
  if (type === '2d') return { fillStyle: 'mocked' };
  return null;
}
import 'jsdom-worker';
const ctx = g.document.createElement('canvas').getContext('2d');
console.log("ctx is:", ctx);
