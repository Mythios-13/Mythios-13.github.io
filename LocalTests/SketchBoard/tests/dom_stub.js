// Minimal DOM stub — just enough surface for app.boot() to run headless.
class ClassList {
  constructor(node){ this.node = node; }
  toggle(c, on){ const s = new Set((this.node.className||'').split(/\s+/).filter(Boolean)); on ? s.add(c) : s.delete(c); this.node.className = [...s].join(' '); }
  contains(c){ return (this.node.className||'').split(/\s+/).includes(c); }
}
class Node {
  constructor(tag){ this.tagName = String(tag).toUpperCase(); this.children = []; this.listeners = {}; this.style = {}; this.dataset = {}; this.attrs = {}; this._className=''; this.hidden=false; }
  get className(){ return this._className; } set className(v){ this._className = v; }
  get classList(){ return new ClassList(this); }
  appendChild(c){ this.children.push(c); c.parent = this; return c; }
  append(...cs){ cs.forEach((c)=>this.appendChild(c)); }
  remove(){ if(this.parent){ this.parent.children = this.parent.children.filter(x=>x!==this); this.parent=null; } }
  setAttribute(k,v){ this.attrs[k]=String(v); }
  // TESTER T5: real SVG elements are readable as well as writable.
  getAttribute(k){ return Object.prototype.hasOwnProperty.call(this.attrs,k) ? this.attrs[k] : null; }
  addEventListener(t,fn){ (this.listeners[t] ||= []).push(fn); }
  dispatch(t, ev={}){ for(const fn of this.listeners[t]||[]) fn({ preventDefault(){}, stopPropagation(){}, target:this, ...ev }); }
  querySelector(sel){ const r = this.querySelectorAll(sel); return r.length ? r : null; } // TESTER FIX: returns array-like; callers use [0]
  querySelectorAll(sel){ // supports '.cls' only
    const cls = sel.replace(/^\./,''); const out=[];
    (function walk(n){ for(const c of n.children){ if(c.classList && c.classList.contains(cls)) out.push(c); walk(c);} })(this);
    return out;
  }
  contains(n){ let p=n; while(p){ if(p===this) return true; p=p.parent; } return false; }
  getBoundingClientRect(){ return { left:0, top:0 }; }
  get clientWidth(){ return 1280; } get clientHeight(){ return 800; }
  focus(){} select(){}
}
export function makeDom(){
  const doc = {
    createElement: (t)=> new Node(t),
    createElementNS: (ns,t)=> new Node(t),
    getElementById: ()=> null,
    activeElement: { tagName:'BODY' },
  };
  const win = { listeners:{}, addEventListener(t,fn){ (this.listeners[t] ||= []).push(fn); },
                dispatch(t,ev={}){ for(const fn of this.listeners[t]||[]) fn({ preventDefault(){}, stopPropagation(){}, ...ev }); },
                innerWidth: 1280, innerHeight: 800 };
  return { doc, win, Node };
}
