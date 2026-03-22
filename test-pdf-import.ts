import pdf1 from 'pdf-parse';
import * as pdf2 from 'pdf-parse';
const pdf3 = require('pdf-parse');

console.log('pdf1 type:', typeof pdf1, 'keys:', Object.keys(pdf1 || {}));
console.log('pdf2 type:', typeof pdf2, 'keys:', Object.keys(pdf2 || {}));
console.log('pdf3 type:', typeof pdf3, 'keys:', Object.keys(pdf3 || {}));
