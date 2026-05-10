import { JSDOM } from 'jsdom';
import { Logger } from '../shared/Logger';

const logger = new Logger('Setup');

logger.log('Running setup...');
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

// Mock getContext to prevent JSDOM/Phaser errors when canvas package is missing
const originalGetContext = g.HTMLCanvasElement.prototype.getContext;
g.HTMLCanvasElement.prototype.getContext = function (type: string, attributes?: any) {
    if (type === '2d') {
        return {
            fillRect: () => {},
            clearRect: () => {},
            getImageData: () => ({ data: new Uint8ClampedArray(0) }),
            putImageData: () => {},
            createImageData: () => ({ data: new Uint8ClampedArray(0) }),
            setTransform: () => {},
            drawImage: () => {},
            save: () => {},
            restore: () => {},
            beginPath: () => {},
            moveTo: () => {},
            lineTo: () => {},
            closePath: () => {},
            stroke: () => {},
            fill: () => {},
            measureText: () => ({ width: 0 }),
            transform: () => {},
            rect: () => {},
            clip: () => {},
            fillStyle: '',
            strokeStyle: '',
            globalAlpha: 1,
            canvas: this
        };
    }
    return originalGetContext.apply(this, [type, attributes]);
};

import 'jsdom-worker';
logger.log('Setup complete.');