// Prints mesh/animation/buffer summary of glTF/GLB files without dumping binary data
const fs=require('fs');
for (const f of process.argv.slice(2).filter((a) => a !== "--bounds")) {
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

// With --bounds: print each node's mesh POSITION accessor min/max (local units) and node transform.
if (process.argv.includes('--bounds')) {
  for (const f of process.argv.slice(2).filter((a) => a !== '--bounds')) {
    const b = fs.readFileSync(f);
    const j = b.readUInt32LE(0) === 0x46546c67
      ? JSON.parse(b.slice(20, 20 + b.readUInt32LE(12)).toString()) : JSON.parse(b.toString());
    for (const n of j.nodes || []) {
      if (n.mesh === undefined) continue;
      const prims = j.meshes[n.mesh].primitives.map((p) => j.accessors[p.attributes.POSITION]);
      const r = (a) => a.map((v) => +v.toFixed(2));
      console.log('  ', f.split('/').pop(), n.name, 'T', n.translation ? r(n.translation) : '-', 'R', n.rotation ? r(n.rotation) : '-',
        'S', n.scale ? r(n.scale) : '-', 'min', r(prims[0].min), 'max', r(prims[0].max));
    }
  }
}
