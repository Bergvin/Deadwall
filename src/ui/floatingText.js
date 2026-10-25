// Floating combat text (damage numbers, gold) as pooled DOM labels projected from world space.
import * as THREE from 'three';

const LIFE = 0.9;

export class FloatingText {
  constructor(container, max = 80) {
    this.root = document.createElement('div');
    this.root.className = 'floaters';
    container.appendChild(this.root);
    this.pool = [];
    this.active = [];
    this.max = max;
    this._v = new THREE.Vector3();
  }

  /** @param {{x:number,y:number,z:number}} at  @param {string} cls  css modifier: dmg | crit | gold | wall */
  spawn(at, text, cls = 'dmg') {
    let item = this.active.length >= this.max ? this.active.shift() : this.pool.pop();
    if (!item) {
      const el = document.createElement('div');
      this.root.appendChild(el);
      item = { el };
    }
    item.el.className = `floater ${cls}`;
    item.el.textContent = text;
    item.el.style.display = '';
    item.x = at.x + (Math.random() - 0.5) * 0.3;
    item.y = at.y;
    item.z = at.z;
    item.age = 0;
    this.active.push(item);
  }

  update(dt, camera, canvas) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    let write = 0;
    for (const it of this.active) {
      it.age += dt;
      if (it.age >= LIFE) {
        it.el.style.display = 'none';
        this.pool.push(it);
        continue;
      }
      this.active[write++] = it;
      this._v.set(it.x, it.y + it.age * 0.9, it.z).project(camera);
      const sx = (this._v.x + 1) / 2 * w, sy = (1 - this._v.y) / 2 * h;
      it.el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -50%)`;
      it.el.style.opacity = String(1 - (it.age / LIFE) ** 2);
    }
    this.active.length = write;
  }

  clear() {
    for (const it of this.active) { it.el.style.display = 'none'; this.pool.push(it); }
    this.active.length = 0;
  }
}
