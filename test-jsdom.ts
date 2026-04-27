import { JSDOM } from 'jsdom';

// Like setup.ts
const dom = new JSDOM();
global.window = dom.window;
global.document = dom.window.document;
global.HTMLCanvasElement = dom.window.HTMLCanvasElement;
global.HTMLCanvasElement.prototype.getContext = function() { return { fillStyle: 'mock' }; };

// Like main.ts
import 'jsdom-global/register';
const ctx = global.document.createElement('canvas').getContext('2d');
console.log("ctx is:", ctx);
