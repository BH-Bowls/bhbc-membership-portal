const { PDFParse } = require('pdf-parse');
const fs = require('fs');
const buf = fs.readFileSync('specs/2025 Friendlies - Match Picker.pdf');
const parser = new PDFParse(buf);
parser.getRawTextContent().then(text => {
  console.log(text);
}).catch(err => {
  // Try other methods
  console.log('Methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(parser)));
});
