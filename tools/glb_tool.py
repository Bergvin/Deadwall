"""Small GLB surgery for model packs (needs Python 3 + Pillow).

  python tools/glb_tool.py clips IN.glb OUT.glb Clip_A Clip_B ...
      Keeps only the named animations (and the nodes they target); drops meshes, skins,
      materials and images. For shared animation libraries (Quaternius UAL, KayKit rigs):
      the game loads the small result and plays its clips on any model with the same bones.
      Rename with Old=New (e.g. Zombie_Walk_Fwd_Loop=Walk).

  python tools/glb_tool.py slim IN.glb OUT.glb [maxSize=512]
      Drops normal / metallic-roughness / occlusion textures (the baked horde draws with
      Lambert: base colour + emissive only) and scales the remaining images down to maxSize.
"""
import io
import json
import struct
import sys

from PIL import Image

GLB_MAGIC, JSON_CHUNK, BIN_CHUNK = 0x46546C67, 0x4E4F534A, 0x004E4942


def read_glb(path):
    data = open(path, 'rb').read()
    assert struct.unpack_from('<I', data, 0)[0] == GLB_MAGIC, f'{path} is not a GLB'
    jlen, _ = struct.unpack_from('<II', data, 12)
    gltf = json.loads(data[20:20 + jlen])
    blen, _ = struct.unpack_from('<II', data, 20 + jlen)
    binary = data[28 + jlen:28 + jlen + blen]
    return gltf, binary


def write_glb(path, gltf, binary):
    js = json.dumps(gltf, separators=(',', ':')).encode()
    js += b' ' * (-len(js) % 4)
    binary += b'\0' * (-len(binary) % 4)
    total = 12 + 8 + len(js) + 8 + len(binary)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', GLB_MAGIC, 2, total))
        f.write(struct.pack('<II', len(js), JSON_CHUNK) + js)
        f.write(struct.pack('<II', len(binary), BIN_CHUNK) + binary)


def view_bytes(gltf, binary, i):
    bv = gltf['bufferViews'][i]
    o = bv.get('byteOffset', 0)
    return binary[o:o + bv['byteLength']]


def repack(gltf, binary, accessors, images, replaced=None):
    """Keeps only `accessors` and `images` (index lists) and the buffer views they use;
    `replaced` maps an image index to new encoded bytes. Returns (gltf, binary)."""
    replaced = replaced or {}
    new_views, chunks, view_map, offset = [], [], {}, 0

    def add(old_view, data=None):
        nonlocal offset
        if data is None:
            if old_view in view_map:
                return view_map[old_view]
            data = view_bytes(gltf, binary, old_view)
        pad = -offset % 4
        chunks.append(b'\0' * pad)
        offset += pad
        bv = {k: v for k, v in gltf['bufferViews'][old_view].items() if k not in ('byteOffset', 'byteLength')}
        bv.update(buffer=0, byteOffset=offset, byteLength=len(data))
        chunks.append(data)
        offset += len(data)
        new_views.append(bv)
        view_map[old_view] = len(new_views) - 1
        return view_map[old_view]

    acc_map = {}
    new_acc = []
    for a in accessors:
        acc = dict(gltf['accessors'][a])
        if 'bufferView' in acc:
            acc['bufferView'] = add(acc['bufferView'])
        acc_map[a] = len(new_acc)
        new_acc.append(acc)
    img_map = {}
    new_img = []
    for i in images:
        im = dict(gltf['images'][i])
        if i in replaced:
            im['bufferView'] = add(im['bufferView'], replaced[i])
            im['mimeType'] = 'image/png'
        else:
            im['bufferView'] = add(im['bufferView'])
        img_map[i] = len(new_img)
        new_img.append(im)
    gltf['accessors'] = new_acc
    gltf['images'] = new_img
    gltf['bufferViews'] = new_views
    gltf['buffers'] = [{'byteLength': offset}]
    return gltf, b''.join(chunks), acc_map, img_map


def remap_accessors(gltf, acc_map):
    for m in gltf.get('meshes', []):
        for p in m['primitives']:
            p['attributes'] = {k: acc_map[v] for k, v in p['attributes'].items()}
            if 'indices' in p:
                p['indices'] = acc_map[p['indices']]
            for t in p.get('targets', []):
                for k in t:
                    t[k] = acc_map[t[k]]
    for s in gltf.get('skins', []):
        if 'inverseBindMatrices' in s:
            s['inverseBindMatrices'] = acc_map[s['inverseBindMatrices']]
    for an in gltf.get('animations', []):
        for s in an['samplers']:
            s['input'] = acc_map[s['input']]
            s['output'] = acc_map[s['output']]


def clips(src, dst, names):
    gltf, binary = read_glb(src)
    rename = dict(n.split('=', 1) if '=' in n else (n, n) for n in names)
    anims = [a for a in gltf.get('animations', []) if a['name'] in rename]
    missing = set(rename) - {a['name'] for a in anims}
    assert not missing, f'missing clips: {sorted(missing)}'
    for a in anims:
        a['name'] = rename[a['name']]
    gltf['animations'] = anims
    for key in ('meshes', 'skins', 'materials', 'textures', 'images', 'samplers'):
        gltf.pop(key, None)
    for n in gltf['nodes']:
        n.pop('mesh', None)
        n.pop('skin', None)
    used = sorted({s[k] for a in anims for s in a['samplers'] for k in ('input', 'output')})
    gltf['images'] = []
    gltf, binary, acc_map, _ = repack(gltf, binary, used, [])
    gltf.pop('images')
    remap_accessors(gltf, acc_map)
    write_glb(dst, gltf, binary)
    print(f'{dst}: {len(anims)} clips, {len(binary) // 1024} KB')


def slim(src, dst, max_size):
    gltf, binary = read_glb(src)
    for m in gltf.get('materials', []):
        for k in ('normalTexture', 'occlusionTexture'):
            m.pop(k, None)
        m.get('pbrMetallicRoughness', {}).pop('metallicRoughnessTexture', None)
    used_tex = set()
    for m in gltf.get('materials', []):
        for k in ('emissiveTexture',):
            if k in m:
                used_tex.add(m[k]['index'])
        t = m.get('pbrMetallicRoughness', {}).get('baseColorTexture')
        if t:
            used_tex.add(t['index'])
    tex_map, new_tex = {}, []
    for i in sorted(used_tex):
        tex_map[i] = len(new_tex)
        new_tex.append(gltf['textures'][i])
    images = sorted({t['source'] for t in new_tex})
    replaced = {}
    for i in images:
        im = Image.open(io.BytesIO(view_bytes(gltf, binary, gltf['images'][i]['bufferView'])))
        if max(im.size) > max_size:
            im = im.resize((max_size, max_size * im.size[1] // im.size[0]), Image.LANCZOS)
        out = io.BytesIO()
        im.save(out, 'PNG', optimize=True)
        replaced[i] = out.getvalue()
    gltf, binary, acc_map, img_map = repack(gltf, binary, list(range(len(gltf['accessors']))), images, replaced)
    remap_accessors(gltf, acc_map)
    for t in new_tex:
        t['source'] = img_map[t['source']]
    gltf['textures'] = new_tex
    for m in gltf.get('materials', []):
        if 'emissiveTexture' in m:
            m['emissiveTexture']['index'] = tex_map[m['emissiveTexture']['index']]
        t = m.get('pbrMetallicRoughness', {}).get('baseColorTexture')
        if t:
            t['index'] = tex_map[t['index']]
    write_glb(dst, gltf, binary)
    print(f'{dst}: {len(images)} images, {len(binary) // 1024} KB')


if __name__ == '__main__':
    cmd, src, dst, *rest = sys.argv[1:]
    if cmd == 'clips':
        clips(src, dst, rest)
    elif cmd == 'slim':
        slim(src, dst, int(rest[0]) if rest else 512)
    else:
        sys.exit(__doc__)
