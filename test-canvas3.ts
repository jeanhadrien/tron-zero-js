import { JSDOM } from 'jsdom';
const dom = new JSDOM();
console.log(dom.window.HTMLCanvasElement === dom.window.document.createElement('canvas').constructor);
