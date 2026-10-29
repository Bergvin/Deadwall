// Draws a whole horde of one skinned model with one instanced draw call per model part.
// At load time every clip is sampled at BAKE_FPS and the skinned vertex positions and
// normals are stored in float textures; the vertex shader then reads the right frame
// per instance. CPU cost per zombie is one matrix write and one float per frame.
import * as THREE from 'three';

const BAKE_FPS = 30;
const TEX_W = 4096;

/**
 * Bakes every skinned part of a model (body, face, weapon ...) into its own instanced mesh;
 * all parts share one per-instance frame attribute, so they always animate in step.
 * @param {THREE.Object3D} root   prototype scene (already scaled; position/rotation are reset)
 * @param {THREE.AnimationClip[]} clips  clips to bake
 * @param {number} maxCount  instance capacity
 * @param {{castShadow?: boolean}} opts
 */
export function createBakedHorde(root, clips, maxCount, opts = {}) {
  root.position.set(0, 0, 0);
  root.rotation.set(0, 0, 0);
  root.updateMatrixWorld(true);

  const parts = [];
  root.traverse((o) => { if (o.isSkinnedMesh && o.visible) parts.push(o); });

  const clipInfo = {};
  let totalFrames = 0;
  for (const clip of clips) {
    const frames = Math.max(1, Math.round(clip.duration * BAKE_FPS));
    clipInfo[clip.name] = { start: totalFrames, frames, duration: clip.duration };
    totalFrames += frames;
  }

  const frameAttr = new THREE.InstancedBufferAttribute(new Float32Array(maxCount), 1);
  frameAttr.setUsage(THREE.DynamicDrawUsage);
  const group = new THREE.Group();
  const meshes = parts.map((part) => bakePart(root, part, clips, clipInfo, totalFrames, frameAttr, maxCount, opts));
  for (const m of meshes) group.add(m);

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const sc = new THREE.Vector3();
  const p = new THREE.Vector3();
  const white = new THREE.Color(1, 1, 1);

  return {
    mesh: group,
    meshes,
    capacity: maxCount,
    clipInfo,
    bakedFrames: totalFrames,
    hasClip: (name) => !!clipInfo[name],
    /** Write instance i: position, facing (radians), clip, time (s), loop, tint, scale. */
    set(i, x, y, z, rotY, clipName, time, loop = true, color = white, scale = 1) {
      const c = clipInfo[clipName];
      let f = Math.floor((time / c.duration) * c.frames);
      f = loop ? ((f % c.frames) + c.frames) % c.frames : Math.min(f, c.frames - 1);
      frameAttr.array[i] = c.start + f;
      m4.compose(p.set(x, y, z), q.setFromAxisAngle(up, rotY), sc.setScalar(scale));
      for (const m of meshes) { m.setMatrixAt(i, m4); m.setColorAt(i, color); }
    },
    /** Call once per frame after all set() calls. */
    commit(count) {
      frameAttr.needsUpdate = true;
      for (const m of meshes) {
        m.count = count;
        m.instanceMatrix.needsUpdate = true;
        m.instanceColor.needsUpdate = true;
      }
    },
  };
}

function bakePart(root, skinned, clips, clipInfo, totalFrames, frameAttr, maxCount, opts) {
  const geom = skinned.geometry;
  const vCount = geom.attributes.position.count;
  const texH = Math.ceil((totalFrames * vCount) / TEX_W);
  const posData = new Float32Array(TEX_W * texH * 4);
  const nrmData = new Float32Array(TEX_W * texH * 4);

  const mixer = new THREE.AnimationMixer(root);
  const skeleton = skinned.skeleton;
  const boneCount = skeleton.bones.length;
  const boneMats = Array.from({ length: boneCount }, () => new THREE.Matrix4());
  const pos = geom.attributes.position;
  const nrm = geom.attributes.normal;
  const sIdx = geom.attributes.skinIndex;
  const sWgt = geom.attributes.skinWeight;
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const accP = new THREE.Vector3();
  const accN = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const nMat = new THREE.Matrix3();

  for (const clip of clips) {
    const info = clipInfo[clip.name];
    const action = mixer.clipAction(clip);
    action.play();
    for (let f = 0; f < info.frames; f++) {
      mixer.setTime((f / info.frames) * clip.duration);
      root.updateMatrixWorld(true);
      skeleton.update();
      // Per-bone matrix that maps a bind-pose vertex straight into world space. The root sits
      // at the origin unrotated, so this bakes in the root's scale and nothing else:
      // meshWorld * bindInv * boneMatrix * bind
      for (let b = 0; b < boneCount; b++) {
        boneMats[b].fromArray(skeleton.boneMatrices, b * 16)
          .premultiply(skinned.bindMatrixInverse)
          .premultiply(skinned.matrixWorld)
          .multiply(skinned.bindMatrix);
      }
      const base = (info.start + f) * vCount;
      for (let i = 0; i < vCount; i++) {
        v.fromBufferAttribute(pos, i);
        n.fromBufferAttribute(nrm, i);
        accP.set(0, 0, 0);
        accN.set(0, 0, 0);
        for (let k = 0; k < 4; k++) {
          const w = sWgt.getComponent(i, k);
          if (w === 0) continue;
          const m = boneMats[sIdx.getComponent(i, k)];
          accP.addScaledVector(tmp.copy(v).applyMatrix4(m), w);
          accN.addScaledVector(tmp.copy(n).applyMatrix3(nMat.setFromMatrix4(m)), w);
        }
        accN.normalize();
        const o = (base + i) * 4;
        posData[o] = accP.x; posData[o + 1] = accP.y; posData[o + 2] = accP.z;
        nrmData[o] = accN.x; nrmData[o + 1] = accN.y; nrmData[o + 2] = accN.z;
      }
    }
    action.stop();
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(root);

  const makeTex = (data) => {
    const t = new THREE.DataTexture(data, TEX_W, texH, THREE.RGBAFormat, THREE.FloatType);
    t.minFilter = t.magFilter = THREE.NearestFilter;
    t.needsUpdate = true;
    return t;
  };
  const uniforms = { uPosTex: { value: makeTex(posData) }, uNrmTex: { value: makeTex(nrmData) } };

  const header = /* glsl */ `
    uniform highp sampler2D uPosTex;
    uniform highp sampler2D uNrmTex;
    attribute float aFrame;
    ivec2 bakedUv() {
      int idx = int(aFrame) * ${vCount} + gl_VertexID;
      return ivec2(idx % ${TEX_W}, idx / ${TEX_W});
    }
  `;
  // Vertex count is baked into the shader source, so it must be part of the cache key.
  const key = `baked-${vCount}`;
  const patch = (mat, withNormals) => {
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = header + shader.vertexShader
        .replace('#include <begin_vertex>', 'vec3 transformed = texelFetch(uPosTex, bakedUv(), 0).xyz;');
      if (withNormals) {
        shader.vertexShader = shader.vertexShader.replace(
          '#include <beginnormal_vertex>',
          'vec3 objectNormal = texelFetch(uNrmTex, bakedUv(), 0).xyz;',
        );
      }
    };
    mat.customProgramCacheKey = () => key;
    return mat;
  };

  const src = Array.isArray(skinned.material) ? skinned.material[0] : skinned.material;
  const material = patch(new THREE.MeshLambertMaterial({ map: src.map, color: src.color }), true);
  const depthMaterial = patch(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), false);

  const g = new THREE.BufferGeometry();
  g.setIndex(geom.index);
  g.setAttribute('position', geom.attributes.position); // only used for vertex count / bounds
  g.setAttribute('normal', geom.attributes.normal);
  g.setAttribute('uv', geom.attributes.uv);
  g.setAttribute('aFrame', frameAttr);

  const mesh = new THREE.InstancedMesh(g, material, maxCount);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.customDepthMaterial = depthMaterial;
  mesh.castShadow = !!opts.castShadow;
  mesh.receiveShadow = !!opts.castShadow;
  mesh.frustumCulled = false; // instances cover the whole map anyway
  mesh.count = 0;
  mesh.setColorAt(0, new THREE.Color(1, 1, 1)); // allocates per-instance tint
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  return mesh;
}
