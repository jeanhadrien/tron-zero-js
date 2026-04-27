import { JSDOM } from 'jsdom';
const dom = new JSDOM();
const canvas = dom.window.document.createElement('canvas');
const orig = canvas.constructor.prototype.getContext;
canvas.constructor.prototype.getContext = function(type: string) {
  if (type === '2d') return { fillStyle: '' };
  return null;
}
const ctx = canvas.getContext('2d');
console.log("ctx is:", ctx);
