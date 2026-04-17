import { readFileSync } from 'fs';
const v = JSON.parse(readFileSync('./package.json')).version;
console.log(v);
