// one-off patch helper: node tools/_patch.cjs <file> <json [[old,new],...]>
const fs = require('fs');
const [file, json] = [process.argv[2], fs.readFileSync(0, 'utf8')];
let s = fs.readFileSync(file, 'utf8');
for (const [a, b] of JSON.parse(json)) {
  if (!s.includes(a)) { console.error('MISSING in ' + file + ':\n' + a); process.exit(1); }
  s = s.replace(a, b);
}
fs.writeFileSync(file, s);
console.log('patched', file);
