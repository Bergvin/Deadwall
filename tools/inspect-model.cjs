// Prints mesh/animation/buffer summary of glTF/GLB files without dumping binary data
const fs=require('fs');
for (const f of process.argv.slice(2)) {
  let j;
  const b=fs.readFileSync(f);
  if (b.readUInt32LE(0)===0x46546c67) { const len=b.readUInt32LE(12); j=JSON.parse(b.slice(20,20+len).toString()); }
  else j=JSON.parse(b.toString());
  console.log('##', f.split('/').pop(), (b.length/1024|0)+'KB',
    '| meshes', (j.meshes||[]).length, '| skins', (j.skins||[]).length,
    '| images', (j.images||[]).map(i=>i.uri? (i.uri.startsWith('data:')?'embedded':i.uri):'bufferView').join(','),
    '| buffers', (j.buffers||[]).map(x=>x.uri? (x.uri.startsWith('data:')?'embedded':x.uri):'glb').join(','));
  console.log('   anims:', (j.animations||[]).map(a=>a.name).join(', '));
}
