// Loads models from the registry once and hands out clones.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

export class AssetLibrary {
  #protos = new Map();
  #clips = new Map();

  /**
   * @param {Record<string, {url:string, fit?:{axis:string,size:number}, clipsFrom?:string[]}>} registry
   *   clipsFrom: animation-only files whose clips play on this model (same bone names).
   */
  async load(registry, names = Object.keys(registry)) {
    const loader = new GLTFLoader();
    const shared = new Map();
    const clipFile = (url) => {
      if (!shared.has(url)) shared.set(url, loader.loadAsync(url));
      return shared.get(url);
    };
    await Promise.all(names.map(async (name) => {
      const def = registry[name];
      const gltf = await loader.loadAsync(def.url);
      for (const url of def.clipsFrom ?? []) gltf.animations.push(...(await clipFile(url)).animations);
      const root = gltf.scene;
      if (def.fit) {
        const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
        root.scale.multiplyScalar(def.fit.size / size[def.fit.axis]);
      }
      root.traverse((o) => {
        if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
      });
      this.#protos.set(name, root);
      this.#clips.set(name, gltf.animations);
    }));
  }

  /** Adds a prototype built in code (e.g. generated pieces) under `name`. */
  register(name, root) {
    this.#protos.set(name, root);
    this.#clips.set(name, []);
  }

  /** Prototype (do not add to the scene directly). */
  proto(name) {
    const p = this.#protos.get(name);
    if (!p) throw new Error(`Model not loaded: ${name}`);
    return p;
  }

  clips(name) {
    return this.#clips.get(name) ?? [];
  }

  /** A new instance; skinned models get their own skeleton. Geometry/materials are shared. */
  instance(name) {
    const p = this.proto(name);
    let skinned = false;
    p.traverse((o) => { if (o.isSkinnedMesh) skinned = true; });
    return skinned ? SkeletonUtils.clone(p) : p.clone();
  }
}
