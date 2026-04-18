import { JSDOM } from 'jsdom';

console.log('Running setup...');
const dom = new JSDOM('', {
    url: 'http://localhost'
});

const g = global as any;
g.window = dom.window;
g.document = dom.window.document;
g.navigator = dom.window.navigator;
g.Image = dom.window.Image;
g.Element = dom.window.Element;
g.HTMLElement = dom.window.HTMLElement;
g.HTMLCanvasElement = dom.window.HTMLCanvasElement;
g.HTMLVideoElement = dom.window.HTMLVideoElement;
g.HTMLImageElement = dom.window.HTMLImageElement;
g.screen = dom.window.screen;

const canvas = dom.window.document.createElement('canvas');
g.HTMLCanvasElement = canvas.constructor;

import 'jsdom-worker';
console.log('Setup complete.');