/* glb-character.js  -  realistic rigged-model skin for the PLAYER (ME) in Cheyyar 3D Town
 *
 * How it works
 *  - Loads a Mixamo-style rigged GLB (models/male.glb, models/female.glb).
 *  - Does NOT use animation clips. It drives the GLB skeleton from the SAME proxy rig that
 *    person() already animates (ME.la / ra / ll / rl / torso / head), so every existing pose
 *    (walk, run, sit, drive, bike, emotes) keeps working with no changes to game code.
 *  - If the model is missing / bones are not found, nothing changes: the procedural character stays.
 *
 * Tuning knobs (set before this script loads, or edit CY_GLB.cfg at runtime):
 *   window.CY_GLB_CFG = { male:'models/male.glb', female:'models/female.glb', height:1.85,
 *                         armDown:1.22, hipY:.82, yFix:0 };
 * Disable: add ?glb=0 to the URL, or localStorage.setItem('cyr3d_glb','0')
 */
(function () {
  'use strict';

  var CFG = Object.assign({
    male: 'male.glb',
    female: 'female.glb',
    height: 1.85,   // in-game height of the male model
    heightF: 1.72,  // in-game height of the female model
    armDown: 1.45,  // T-pose -> arms hanging (radians). Raise if arms stick out, lower if they cross the body
    hipY: .82,      // pelvis height of the procedural rig (used to lower the model when sitting)
    yFix: 0,        // fine-tune: + moves model up, - moves it down (feet sinking / floating)
    scaleMul: 1.2,  // overall size multiplier (1 = real size, 1.2 = 20% bigger). Live: CY_GLB.setScale(1.3)
    splitCloth: true,   // single-mesh outfits: colour the lower part with the game's bottom colour
    splitAt: .04,       // where the top/bottom colour band starts (fraction of body height above the hips)
    ovW: .75,           // width of veshti/saree/skirt overlay (1 = game's own proportions). Live: CY_GLB.fitOutfit(w, h)
    ovH: .92,           // height of the overlay
    outfitTypes: false, // false = only colours change (hoodie + pants stay). true = also swap in veshti / saree / skirt overlays
    enabled: true,
    npc: true,          /* NPCs / other players get the GLB model too (own dress colours) */
    npcMax: window.MOB ? (window.GFX0 == 'high' ? 14 : 10) : 18,   /* smaller detailed crowd pool on phones */
    npcRadius: window.MOB ? (window.GFX0 == 'high' ? 105 : 85) : 125, /* shorter GLB detail radius on phones */
    hide: /helmet|vest/i,   // mesh names to hide (Mixamo soldier gear)
    dracoLoader: 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/DRACOLoader.js',
    dracoPath: 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/libs/draco/gltf/',
    loader: 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js'
  }, window.CY_GLB_CFG || {});

  try {
    if (/[?&]glb=0/.test(location.search) || localStorage.getItem('cyr3d_glb') === '0') CFG.enabled = false;
  } catch (e) {}

  /* bone name matching (Mixamo "mixamorigLeftArm", plain "LeftArm", etc.) */
  var RX = {
    hips: /Hips$/i, sp: /Spine$/i, sp1: /Spine1$/i, sp2: /Spine2$/i,
    head: /Head$/i, top: /HeadTop_End$/i,
    lUp: /LeftUpLeg$/i, lLeg: /LeftLeg$/i, lFoot: /LeftFoot$/i,
    rUp: /RightUpLeg$/i, rLeg: /RightLeg$/i, rFoot: /RightFoot$/i,
    lArm: /LeftArm$/i, lFore: /LeftForeArm$/i,
    rArm: /RightArm$/i, rFore: /RightForeArm$/i
  };
  var NEED = ['hips', 'sp', 'head', 'lUp', 'lLeg', 'rUp', 'rLeg', 'lArm', 'lFore', 'rArm', 'rFore'];
  var DRIVEN = ['sp', 'sp1', 'sp2', 'head', 'lUp', 'lLeg', 'lFoot', 'rUp', 'rLeg', 'rFoot', 'lArm', 'lFore', 'rArm', 'rFore'];

  var cache = {}, ACT = [], warned = false;
  var Wq, Qd, Qn, Qp, Qa, Qb, Id, AXx, AZ;

  function ensureMath() {
    if (Wq) return;
    var Q = THREE.Quaternion, V = THREE.Vector3;
    Wq = new Q(); Qd = new Q(); Qn = new Q(); Qp = new Q(); Qa = new Q(); Qb = new Q(); Id = new Q();
    AXx = new V(1, 0, 0); AZ = new V(0, 0, 1);
  }

  /* clone a skinned model (own skeleton per clone) - same idea as THREE.SkeletonUtils.clone, so no extra script is needed */
  function cloneSkinned(source) {
    var from = new Map(), to = new Map(), clone = source.clone();
    (function walk(a, b) { from.set(b, a); to.set(a, b); for (var i = 0; i < a.children.length; i++) walk(a.children[i], b.children[i]); })(source, clone);
    clone.traverse(function (n) {
      if (!n.isSkinnedMesh) return;
      var sm = from.get(n);
      n.skeleton = sm.skeleton.clone();
      n.bindMatrix.copy(sm.bindMatrix);
      n.skeleton.bones = sm.skeleton.bones.map(function (b) { return to.get(b); });
      n.bind(n.skeleton, n.bindMatrix);
    });
    return clone;
  }

  /* ---------- loading ---------- */
  var loaderP = null, dracoL = null;
  function addScript(src) {
    return new Promise(function (ok, no) {
      var el = document.createElement('script');
      el.src = src; el.onload = ok;
      el.onerror = function () { no(new Error('script load failed: ' + src)); };
      document.head.appendChild(el);
    });
  }
  function needLoader() {
    if (loaderP) return loaderP;
    var p = Promise.resolve();
    if (!(window.THREE && THREE.GLTFLoader)) p = p.then(function () { return addScript(CFG.loader); });
    if (!(window.THREE && THREE.DRACOLoader)) p = p.then(function () { return addScript(CFG.dracoLoader); });
    return (loaderP = p.catch(function (e) { loaderP = null; throw e; }));
  }
  function mkLoader() {
    var l = new THREE.GLTFLoader();
    if (THREE.DRACOLoader) {                  /* models are Draco-compressed */
      if (!dracoL) { dracoL = new THREE.DRACOLoader(); dracoL.setDecoderPath(CFG.dracoPath); }
      l.setDRACOLoader(dracoL);
    }
    return l;
  }
  function load(url) {
    return cache[url] || (cache[url] = needLoader().then(function () {
      /* try the given path first, then the other layout (models/x.glb <-> x.glb) so it works in dist/ or root */
      var alt = /(^|\/)models\//.test(url) ? url.replace(/(^|\/)models\//, '$1') : 'models/' + url;
      var ld = function (u) { return new Promise(function (ok, no) { mkLoader().load(u, ok, undefined, no); }); };
      return ld(url).catch(function () { return ld(alt); }).then(function (g) {
        /* untouched copy of the skeleton, taken before anything poses it - NPC characters are cloned from this */
        try { if (!g.__pristine) g.__pristine = cloneSkinned(g.scene); } catch (e) { console.warn('[glb] could not keep a clean copy of ' + url, e); }
        return g;
      });
    }));
  }

  /* ---------- model preparation (once per file) ---------- */
  function fixMat(m) {
    if (!m) return;
    /* the game renders in linear output (no sRGB), so textures must not be sRGB-decoded or the model looks dark */
    ['map', 'emissiveMap'].forEach(function (k) { if (m[k] && m[k].encoding !== THREE.LinearEncoding) { m[k].encoding = THREE.LinearEncoding; m[k].needsUpdate = true; } });
    if (m.color && m.color.convertLinearToSRGB && !m.__cyc) { m.color.convertLinearToSRGB(); m.__cyc = 1; }  /* colour factors: same reason */
    if (m.transparent) { m.transparent = false; m.alphaTest = .45; m.depthWrite = true; }   /* hair / eyelash cards */
    if (m.metalness > .1) m.metalness = .1;      /* no env-map in this scene: metal renders black */
    m.needsUpdate = true;
  }

  function boneSet(bones) {
    var B = {};
    bones.forEach(function (o) { for (var k in RX) if (!B[k] && RX[k].test(o.name)) B[k] = o; });
    return B;
  }

  function splitCloth(mesh, U, root) {
    var T = THREE, V = T.Vector3;
    if (!U.hips || !U.head) return;
    root.updateMatrixWorld(true);
    var hp = new V(), hd = new V(), ft = new V();
    U.hips.getWorldPosition(hp); U.head.getWorldPosition(hd); (U.lFoot || U.lLeg).getWorldPosition(ft);
    var up = hd.clone().sub(ft), H = up.length(); up.normalize();
    var inv = new T.Matrix4().copy(mesh.matrixWorld).invert();
    var p0 = hp.clone().applyMatrix4(inv);
    var p1 = hp.clone().add(up).applyMatrix4(inv);
    var upL = p1.clone().sub(p0);                                   /* world 'up' expressed in the mesh's own space */
    var split = hp.clone().add(up.clone().multiplyScalar(H * CFG.splitAt)).applyMatrix4(inv).dot(upL);
    var m = mesh.material, bot = { value: new T.Color(0x2c3e50) };
    var cut = { value: 0 };
    m.userData.cyBot = bot; m.userData.cyCut = cut;
    m.onBeforeCompile = function (sh) {
      sh.uniforms.uUp = { value: upL }; sh.uniforms.uSplit = { value: split }; sh.uniforms.uBot = bot; sh.uniforms.uCut = cut;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uUp; varying float vSp;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSp = dot(position, uUp);');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uSplit; uniform float uCut; uniform vec3 uBot; varying float vSp;')
        .replace('#include <color_fragment>', '#include <color_fragment>\nif (vSp < uSplit) { if (uCut > .5) discard; diffuseColor.rgb = uBot; }');
    };
    m.needsUpdate = true;
  }

  function prep(gltf, url) {
    if (gltf.__cy) return gltf.__cy;
    var skels = [], topMeshes = [], botMeshes = [];
    var mats = {};
    gltf.scene.traverse(function (o) {
      if (o.isMesh && CFG.hide && CFG.hide.test(o.name || '')) { o.visible = false; return; }
      if (o.isMesh && o.material) {
        /* Classify from BOTH the GLB node and material names. Some exporters put
           names only on the material, and some meshes use material arrays. */
        var nm = (o.name || '') + ' ' + [].concat(o.material).map(function(mm){return mm && mm.name || '';}).join(' ');
        var key = /sneaker|shoe|footwear/i.test(nm) ? 'shoe' :
          /beard|moustache/i.test(nm) ? 'beard' :
          /hair/i.test(nm) ? 'hair' :
          /pant|trouser|jean|short|skirt|bottom|legging/i.test(nm) ? 'bottom' :
          /hoodie|shirt|top|jacket|blouse|dress|cloth|kurta/i.test(nm) ? 'top' :
          /body|skin/i.test(nm) ? 'skin' : null;
        if (key) {
          var originals = [].concat(o.material), replacements = originals.map(function(original) {
            var cm = original.clone();
            /* These GLBs use untextured colour materials; remove any inherited map
               so the selected swatch is visible instead of being multiplied by a texture. */
            cm.map = null; cm.color.setHex(0xffffff); cm.needsUpdate = true;
            (mats[key] || (mats[key] = [])).push(cm);
            return cm;
          });
          o.material = Array.isArray(o.material) ? replacements : replacements[0];
          if (key === 'top') topMeshes.push(o); else if (key === 'bottom') botMeshes.push(o);
        }
      }
      if (o.isMesh) {
        o.castShadow = !window.MOB || window.GFX0 == 'high'; o.receiveShadow = false; o.frustumCulled = false;
        [].concat(o.material).forEach(function (m) {
          fixMat(m);
          if (m && m.name) { var a = mats[m.name] || (mats[m.name] = []); if (a.indexOf(m) < 0) a.push(m); }
        });
      }
      if (o.isSkinnedMesh && o.skeleton && skels.indexOf(o.skeleton) < 0) skels.push(o.skeleton);
    });
    /* Blender-style exports give every mesh its own partial bone set, so merge them: each skeleton is posed with the bones it has,
       and the union of all of them must cover the bones the game drives. */
    var rigs = [], U = {};
    skels.forEach(function (sk) {
      var B = boneSet(sk.bones);
      if (!Object.keys(B).length) return;
      rigs.push({ B: B, rest: null });
      for (var k in B) if (!U[k]) U[k] = B[k];
    });
    var miss = NEED.filter(function (k) { return !U[k]; });
    if (!rigs.length || miss.length) {
      console.warn('[glb] ' + url + ': ' + (skels.length ? 'bones not found (' + miss.join(', ') + ')' : 'no skinned mesh') + ' - keeping procedural character');
      return (gltf.__cy = { bad: 1 });
    }
    /* one-piece outfit (top + bottom in a single mesh): colour it in two bands so the game's top colour and bottom colour both show */
    if (!(mats.bottom && mats.bottom.length) && CFG.splitCloth) {
      try { topMeshes.forEach(function (m) { splitCloth(m, U, gltf.scene); }); } catch (e) { console.warn('[glb] split failed', e); }
    }
    var holder = new THREE.Group();
    holder.rotation.y = Math.PI;          /* glTF faces +z, the game faces -z */
    holder.add(gltf.scene);
    return (gltf.__cy = { rigs: rigs, U: U, topMeshes: topMeshes, botMeshes: botMeshes, holder: holder, mats: mats, fc: -1, ME: null, ready: false });
  }

  /* size, ground level and rest orientation - measured once, on first attach */
  function measure(st, ME) {
    var T = THREE, h = st.holder;
    h.scale.set(1, 1, 1); h.position.set(0, 0, 0);
    ME.add(h); ME.updateMatrixWorld(true);
    var wq = new T.Quaternion(); ME.getWorldQuaternion(wq);
    var iw = wq.clone().invert(), v = new T.Vector3();
    var yL = function (b) { b.getWorldPosition(v); return ME.worldToLocal(v).y; };
    var B = st.U, topB = B.top;
    var yHead = yL(B.head), yHips = yL(B.hips);
    var yFoot = Math.min(yL(B.lFoot || B.lLeg), yL(B.rFoot || B.rLeg));
    var top = topB ? yL(topB) : yHead + (yHead - yFoot) * .17;
    var sole = yFoot - (top - yFoot) * .05;
    var s0 = (st.targetH || CFG.height) / (top - sole), s = s0 * CFG.scaleMul;
    st.s0 = s0; st.sole = sole; st.yHips = yHips;
    h.scale.setScalar(s);
    st.base = -sole * s + CFG.yFix;
    h.position.y = st.base;
    st.sitDrop = Math.max(0, (yHips - sole) * s - CFG.hipY);
    ME.updateMatrixWorld(true);
    var q = new T.Quaternion();
    st.rigs.forEach(function (r) {
      r.rest = {};
      DRIVEN.forEach(function (k) {
        var b = r.B[k]; if (!b) return;
        b.getWorldQuaternion(q);
        r.rest[k] = iw.clone().multiply(q);      /* orientation relative to the character */
      });
    });
    st.ready = true;
  }

  function attach(st, ME) {
    ensureMath();
    if (!st.ready) measure(st, ME); else ME.add(st.holder);
    ME.children.forEach(function (c) {           /* hide procedural body, keep name tag + shadow blob */
      if (c === st.holder || c.isSprite || (c.geometry && c.geometry.type === 'CircleGeometry')) return;
      c.visible = false;
    });
    st.ME = ME; st.fc = -1;
    if (ACT.indexOf(st) < 0) ACT.push(st);
    patchRender();
  }

  /* ---------- per-frame pose: proxy rig -> bones ---------- */
  /* worldQuat = characterQuat * D * extra * restRelativeToCharacter ; stored as a local quaternion */
  function drive(b, D, rest, extra) {
    Qn.copy(Wq).multiply(D);
    if (extra) Qn.multiply(extra);
    Qn.multiply(rest);
    b.parent.getWorldQuaternion(Qp);
    b.quaternion.copy(Qp.invert()).multiply(Qn);
  }

  function leg(rig, L, up, lo, ft) {
    var B = rig.B, R = rig.rest;
    if (!L || !B[up]) return;
    var rx = L.rotation.x;
    var kx = rx > 1.1 ? -1.42 : rx > .05 ? -Math.sin(rx) * .5 : rx < -.05 ? Math.max(rx * .7, -.6) : 0;
    Qd.copy(L.quaternion); drive(B[up], Qd, R[up]);
    if (B[lo]) { Qb.setFromAxisAngle(AXx, kx); Qd.copy(L.quaternion).multiply(Qb); drive(B[lo], Qd, R[lo]); }
    if (B[ft]) { Qa.setFromAxisAngle(AXx, Math.abs(rx) < 1 ? rx * .3 : 0); drive(B[ft], Qa, R[ft]); }
  }

  function arm(rig, A, up, lo, sign) {
    var B = rig.B, R = rig.rest;
    if (!A || !B[up]) return;
    var rx = A.rotation.x;
    var ea = (rx > .8 ? .55 : Math.min(Math.abs(Math.sin(rx)) * .5, .5)) + .08;   /* elbow flex (forward) */
    Qb.setFromAxisAngle(AZ, sign * CFG.armDown);                                    /* T-pose -> hanging */
    Qd.copy(A.quaternion); drive(B[up], Qd, R[up], Qb);
    if (B[lo]) { Qa.setFromAxisAngle(AXx, ea); Qd.copy(A.quaternion).multiply(Qa); drive(B[lo], Qd, R[lo], Qb); }
  }

  function poseRig(rig, ME) {
    var B = rig.B, R = rig.rest, T = ME.torso, H = ME.head;
    if (T) {
      if (B.sp) { Qa.copy(Id).slerp(T.quaternion, .34); drive(B.sp, Qa, R.sp); }
      if (B.sp1) { Qa.copy(Id).slerp(T.quaternion, .67); drive(B.sp1, Qa, R.sp1); }
      if (B.sp2) { Qa.copy(T.quaternion); drive(B.sp2, Qa, R.sp2); }
    }
    if (H && B.head) drive(B.head, H.quaternion, R.head);
    leg(rig, ME.ll, 'lUp', 'lLeg', 'lFoot');
    leg(rig, ME.rl, 'rUp', 'rLeg', 'rFoot');
    arm(rig, ME.la, 'lArm', 'lFore', 1);
    arm(rig, ME.ra, 'rArm', 'rFore', -1);
  }

  function update(st) {
    var ME = st.ME;
    if (!ME || !ME.parent || !st.ready) return;
    var fc = window.__fc | 0;
    if (fc && fc === st.fc && !st.noFc) return;   /* once per game frame (previews have their own renderer: always pose) */
    st.fc = fc;
    ME.updateWorldMatrix(true, false);
    ME.getWorldQuaternion(Wq);
    st.rigs.forEach(function (r) { poseRig(r, ME); });
    var sit = ME.ll && ME.rl && ME.ll.rotation.x > 1.1 && ME.rl.rotation.x > 1.1;
    st.holder.position.y = st.base - (sit ? st.sitDrop : 0);
    if (st.ov && ME.torso) {                       /* long garment follows the torso and the sitting drop */
      st.ov.position.copy(ME.torso.position); st.ov.quaternion.copy(ME.torso.quaternion);
      st.ov.position.y += st.holder.position.y - st.base;
    }
  }

  /* run before every render so the skeleton is posed before three.js updates skin matrices */
  function patchRender() {
    var r = window.R;
    if (!r || r.__cyGlb) return;
    r.__cyGlb = 1;
    var orig = r.render;
    r.render = function () {
      try { mgr(performance.now()); for (var i = 0; i < ACT.length; i++) update(ACT[i]); }
      catch (e) { if (!r.__cyGlbErr) { r.__cyGlbErr = 1; console.warn('[glb] pose update failed', e); } }
      return orig.apply(this, arguments);
    };
  }


  /* ---------- NPCs / other players ----------
   * Every NPC made by person() is registered here. The procedural body is hidden at once (the old low-poly character is never shown).
   * The nearest `npcMax` NPCs within `npcRadius` borrow a cloned GLB character from a small pool, coloured with that NPC's own
   * shirt / pant / skin / hair colours; everybody else is simply not drawn until they come close. */
  var NREG = [], POOL = { m: [], f: [] }, meRef = null, lastMgr = 0, building = false, vME = null, vN = null, GFAIL = { m: false, f: false }, warmed = { m: false, f: false };

  function isTag(c) { return c.isSprite || (c.geometry && c.geometry.type === 'CircleGeometry'); }   /* name tag + shadow blob */
  function rootOf(o) { while (o.parent) o = o.parent; return o; }
  function visChain(o) { while (o) { if (!o.visible) return false; o = o.parent; } return true; }

  function npcHide(r) {            /* hide whatever is visible on an NPC that has no GLB right now (also late-added props / tags) */
    var ch = r.g.children;
    for (var i = 0; i < ch.length; i++) {
      var c = ch[i];
      if (c.visible && !(r.inst && c === r.inst.st.holder)) { c.visible = false; if (r.off.indexOf(c) < 0) r.off.push(c); }
    }
  }
  function npcShowTags(r) { r.off = r.off.filter(function (c) { if (isTag(c)) { c.visible = true; return false; } return true; }); }
  function npcRestore(r) { r.off.forEach(function (c) { c.visible = true; }); r.off = []; }

  function npcRelease(r) {
    var inst = r.inst; if (!inst) return;
    r.inst = null; inst.owner = null;
    var st = inst.st;
    if (st.holder.parent) st.holder.parent.remove(st.holder);
    var k = ACT.indexOf(st); if (k >= 0) ACT.splice(k, 1);
    st.ME = null;
  }
  function npcDrop(r, i) { npcRelease(r); NREG.splice(i, 1); }

  function disposeInst(inst) {
    var st = inst.st;
    if (st.holder.parent) st.holder.parent.remove(st.holder);
    var k = ACT.indexOf(st); if (k >= 0) ACT.splice(k, 1);
    st.holder.traverse(function (o) { if (o.isMesh) [].concat(o.material).forEach(function (m) { if (m && m.dispose) m.dispose(); }); });
  }

  function makeInst(fem) {
    var url = fem ? CFG.female : CFG.male;
    return load(url).then(function (g) {
      if (!g.__pristine) throw new Error('no clean copy of the model');
      var sc = cloneSkinned(g.__pristine);
      sc.traverse(function (o) {                    /* own materials per character so every NPC can have its own colours */
        if (!o.isMesh || !o.material) return;
        var one = function (m) { var c = m.clone(); if (m.__cyc) c.__cyc = m.__cyc; return c; };
        o.material = Array.isArray(o.material) ? o.material.map(one) : one(o.material);
      });
      var st = prep({ scene: sc }, url);
      if (!st || st.bad) throw new Error('bad model');
      st.targetH = fem ? CFG.heightF : CFG.height;
      return { st: st, fem: fem, owner: null };
    });
  }

  function npcBind(r, inst) {
    var st = inst.st;
    inst.owner = r; r.inst = inst;
    try {
      if (st.ready) {                               /* pooled character: follow live size changes */
        var s = st.s0 * CFG.scaleMul;
        st.holder.scale.setScalar(s); st.base = -st.sole * s + CFG.yFix;
        st.sitDrop = Math.max(0, (st.yHips - st.sole) * s - CFG.hipY); st.holder.position.y = st.base;
      }
      attach(st, r.g);
      tint(st, r.look);
      npcShowTags(r);
    } catch (e) { console.warn('[glb] npc bind failed', e); npcRelease(r); }
  }

  function npcFail(fem) {                           /* model could not be loaded: give those NPCs their old body back */
    var key = fem ? 'f' : 'm'; if (GFAIL[key]) return; GFAIL[key] = true;
    for (var i = NREG.length - 1; i >= 0; i--) if (NREG[i].fem === fem) { npcRelease(NREG[i]); npcRestore(NREG[i]); NREG.splice(i, 1); }
    console.warn('[glb] NPC model could not be used - NPCs keep the old character.');
  }

  function npcAssign(r) {
    var pool = r.fem ? POOL.f : POOL.m, i, inst = null;
    for (i = 0; i < pool.length; i++) if (!pool[i].owner) { inst = pool[i]; break; }
    if (inst) { npcBind(r, inst); return; }
    if (building) return;                           /* one new character per step keeps the game smooth */
    if (POOL.m.length + POOL.f.length >= CFG.npcMax + 2) {
      var op = r.fem ? POOL.m : POOL.f;
      for (i = 0; i < op.length; i++) if (!op[i].owner) { disposeInst(op[i]); op.splice(i, 1); break; }
      if (POOL.m.length + POOL.f.length >= CFG.npcMax + 2) return;
    }
    building = true;
    makeInst(r.fem).then(function (inst) {
      building = false; pool.push(inst);
      if (NREG.indexOf(r) >= 0 && !r.inst) npcBind(r, inst);
    }).catch(function (e) { building = false; npcFail(r.fem); });
  }

  var lastScan = 0;
  function scanWorldNPCs(now) {
    /* Catch NPCs created before CY_GLB finished loading, or NPCs spawned later by
       scripts that did not pass through the normal person()->CY_GLB.npc hook. */
    if (!meRef || !meRef.parent || now - lastScan < 900) return;
    lastScan = now;
    var worldRoot = rootOf(meRef);
    function walk(parent) {
      if (!parent || !parent.children) return;
      parent.children.slice().forEach(function (child) {
        if (!child || child === meRef) return;
        /* Never classify the player's top-level scene container as an NPC. */
        if (child.ll && child.rl && child.la && child.ra && child.torso &&
            child !== meRef && child.parent && rootOf(child) === worldRoot) {
          if (!child.userData) child.userData = {};
          if (!child.userData.__cyNpcScanned) {
            child.userData.__cyNpcScanned = true;
            var fem = child.userData.fem != null ? !!child.userData.fem : Math.random() < .48;
            child.userData.fem = fem;
            var tops = [0x2563eb,0xdc2626,0x059669,0x9333ea,0xea580c,0x0891b2,0xbe123c,0x4f46e5,0x65a30d,0x7c2d12,0x0f766e,0xa21caf,0x334155,0xf59e0b,0x1d4ed8,0x15803d];
            var bots = [0x172554,0x292524,0x374151,0x1e3a8a,0x3f3f46,0x365314,0x4c1d95,0x713f12,0x164e63,0x111827];
            npc(child, fem, {sk:0x8a5a3a, top:tops[Math.random()*tops.length|0], bot:bots[Math.random()*bots.length|0], hair:0x14100c});
          }
          return; /* don't recurse into the character's limbs */
        }
        walk(child);
      });
    }
    walk(worldRoot);
  }

  function mgr(now) {
    scanWorldNPCs(now);
    if (!NREG.length || now - lastMgr < 100) return;
    lastMgr = now;
    var T = THREE; vME = vME || new T.Vector3(); vN = vN || new T.Vector3();
    var haveMe = meRef && meRef.parent, root = null, cand = [], i, r;
    if (haveMe) { meRef.getWorldPosition(vME); root = rootOf(meRef); }
    for (i = NREG.length - 1; i >= 0; i--) {
      r = NREG[i];
      if (!r.g.parent) { npcDrop(r, i); continue; }                 /* removed from the world */
      if (!haveMe) { if (!r.inst) npcHide(r); continue; }
      var ok = visChain(r.g) && rootOf(r.g) === root;
      if (ok) { r.g.getWorldPosition(vN); r.d = vN.distanceTo(vME); ok = r.d < (r.inst ? CFG.npcRadius * 1.15 : CFG.npcRadius); }
      if (ok) cand.push(r); else { if (r.inst) npcRelease(r); npcHide(r); }
    }
    cand.sort(function (a, b) { return a.d - b.d; });
    for (i = CFG.npcMax; i < cand.length; i++) { if (cand[i].inst) npcRelease(cand[i]); npcHide(cand[i]); }
    for (i = 0; i < cand.length && i < CFG.npcMax; i++) { r = cand[i]; if (!r.inst) { npcHide(r); npcAssign(r); } }
  }

  function npc(g, fem, look) {
    if (!CFG.enabled || !CFG.npc || !g || !window.THREE) return;
    if (!g.ll || !g.rl || !g.la || !g.ra || !g.torso) return;
    var key = fem ? 'f' : 'm';
    if (GFAIL[key]) return;
    for (var q = 0; q < NREG.length; q++) if (NREG[q].g === g) { NREG[q].look = look; return; }   /* already registered */
    var r = { g: g, fem: !!fem, look: look, inst: null, off: [], d: 0 };
    NREG.push(r); npcHide(r); patchRender();
    if (!warmed[key]) {                              /* start downloading the model as soon as the first NPC exists */
      warmed[key] = true;
      load(fem ? CFG.female : CFG.male).catch(function () { npcFail(!!fem); });
    }
  }


  /* ---------- previews (character creator) ----------
   * The creator draws its own scene with its own renderer. preview() swaps the procedural model for a GLB (one cached per gender),
   * hook(renderer) makes that renderer pose the skeleton before every frame. */
  var PVP = { m: null, f: null }, PFAIL = { m: false, f: false }, PREV = [];
  function hook(r) {
    if (!r || r.__cyGlbP) return;
    r.__cyGlbP = 1;
    var orig = r.render;
    r.render = function () {
      try { for (var i = 0; i < PREV.length; i++) update(PREV[i]); }
      catch (e) { if (!r.__cyGlbErr) { r.__cyGlbErr = 1; console.warn('[glb] preview pose failed', e); } }
      return orig.apply(this, arguments);
    };
  }
  function preview(mdl, fem, look) {
    if (!window.THREE || !mdl) return;
    var key = fem ? 'f' : 'm';
    if (PFAIL[key]) return;
    var hid = [];                                    /* old low-poly body is hidden straight away */
    mdl.children.forEach(function (c) { if (!isTag(c) && c.visible) { c.visible = false; hid.push(c); } });
    var p = PVP[key] || (PVP[key] = makeInst(!!fem));
    p.then(function (inst) {
      if (!mdl.parent) return;                       /* creator already rebuilt the model */
      var st = inst.st;
      st.noFc = true;
      if (st.ready) {
        var s = st.s0 * CFG.scaleMul;
        st.holder.scale.setScalar(s); st.base = -st.sole * s + CFG.yFix;
        st.sitDrop = Math.max(0, (st.yHips - st.sole) * s - CFG.hipY); st.holder.position.y = st.base;
      }
      attach(st, mdl);
      var k = ACT.indexOf(st); if (k >= 0) ACT.splice(k, 1);          /* posed by the creator's renderer, not the game's */
      if (PREV.indexOf(st) < 0) PREV.push(st);
      tint(st, { sk: look.sk, top: look.c, bot: look.l, hair: look.hr, beard: look.br, shoe: look.sh });
    }).catch(function (e) {
      PFAIL[key] = true; PVP[key] = null;
      /* Keep the procedural low-poly body hidden: the creator must never silently fall back to it. */
      console.error('[glb] creator preview failed for ' + (fem ? 'female' : 'male') + '; low-poly fallback remains hidden. Check that the GLB file is deployed beside index.html (or in /models/).', e && e.message || e);
    });
  }

  /* ---------- public API ---------- */
  /* colour the generated model from the game's look: {sk: skin, top: shirt, bot: pants, hair}  (hex ints) */
  function tint(st, look) {
    if (!look) return;
    var map = { skin: look.sk, top: look.top, bottom: look.bot, hair: look.hair, beard: look.beard, shoe: look.shoe };
    for (var k in map) if (map[k] != null && st.mats[k]) st.mats[k].forEach(function (m) { m.color.setHex(map[k]); });
    if (look.bot != null && st.mats.top) st.mats.top.forEach(function (m) { if (m.userData && m.userData.cyBot) m.userData.cyBot.value.setHex(look.bot); });
  }

  /* Outfit type: the GLB has fixed clothes, so long garments (veshti, saree, skirt ...) are the game's own procedural pieces,
     re-used on top of the GLB body; the GLB's own trousers / lower cloth are hidden under them. */
  var LONG = { veshti: 1, saree: 1, lehenga: 1, gown: 1, skirt: 1, frock: 1, anarkali: 1 };
  function applyOutfit(st, ME, ty) {
    var long = !!LONG[ty], kurta = ty === 'kurta';
    (st.botMeshes || []).forEach(function (m) { m.visible = !long; });
    (st.topMeshes || []).forEach(function (m) { if (m.material.userData && m.material.userData.cyCut) m.material.userData.cyCut.value = long ? 1 : 0; });
    st.ov = null;
    if (!(long || kurta) || !ME.torso) return;
    var ov = new THREE.Group(), n = 0;
    ME.torso.children.slice().forEach(function (c) {
      if (c.isMesh && c.position.y < 1.0) { ov.add(c); n++; }       /* everything from the waist down */
    });
    if (!n) return;
    var kx = CFG.scaleMul * (st.targetH || CFG.height) / 1.85;      /* width: model size vs the game's own body */
    var ky = ((st.yHips - st.sole) * st.s0 * CFG.scaleMul) / .82;   /* height: model hip height vs the game's hip height */
    st.kx0 = kx; st.ky0 = ky;
    ov.scale.set(kx * CFG.ovW, ky * CFG.ovH, kx * CFG.ovW);
    ME.add(ov); st.ov = ov;
  }

  function skin(ME, fem, look) {
    if (!CFG.enabled || !ME || !window.THREE) return;
    meRef = ME;
    for (var ni = NREG.length - 1; ni >= 0; ni--) if (NREG[ni].g === ME) { npcRelease(NREG[ni]); npcRestore(NREG[ni]); NREG.splice(ni, 1); }
    var url = fem ? CFG.female : CFG.male;
    /* hide the procedural body right away so the old character is never visible while the GLB loads */
    var hidden = [];
    ME.children.forEach(function (c) {
      if (c.isSprite || (c.geometry && c.geometry.type === 'CircleGeometry')) return;   /* keep name tag + shadow blob */
      if (c.visible) { c.visible = false; hidden.push(c); }
    });
    var restore = function () { hidden.forEach(function (c) { c.visible = true; }); };   /* only if the GLB cannot load */
    load(url).then(function (g) {
      var st = prep(g, url);
      if (!st || st.bad) { restore(); return; }
      if (!ME.parent) return;                      /* makeMe() already replaced this character */
      if (!st.ready) st.targetH = fem ? CFG.heightF : CFG.height;
      attach(st, ME);
      tint(st, look);
      try { applyOutfit(st, ME, CFG.outfitTypes ? ((look && look.ty) || (window.myLook && window.myLook.t)) : null); } catch (e) { console.warn('[glb] outfit', e); }
    }).catch(function (e) {
      restore();
      if (!warned) { warned = true; console.info('[glb] model not loaded (' + url + ') - using procedural character.', e && e.message || e); }
    });
  }

  /* live resize: CY_GLB.setScale(1.3) - no reload needed */
  function setScale(k) {
    CFG.scaleMul = k;
    ACT.forEach(function (st) {
      if (!st.ready) return;
      var s = st.s0 * k;
      st.holder.scale.setScalar(s);
      st.base = -st.sole * s + CFG.yFix;
      st.sitDrop = Math.max(0, (st.yHips - st.sole) * s - CFG.hipY);
      st.holder.position.y = st.base;
    });
  }

  function fitOutfit(w, h) {
    if (w != null) CFG.ovW = w; if (h != null) CFG.ovH = h;
    ACT.forEach(function (st) { if (st.ov) st.ov.scale.set(st.kx0 * CFG.ovW, st.ky0 * CFG.ovH, st.kx0 * CFG.ovW); });
  }

  console.info('[glb] glb-character.js v4 loaded (player + NPC + creator preview), enabled=' + CFG.enabled + ', male=' + CFG.male + ', female=' + CFG.female);
  window.CY_GLB = {
    cfg: CFG,
    fitOutfit: fitOutfit,
    version: 'colour-only-v4-npc-preview',
    setScale: setScale,
    skin: skin,
    npc: npc,
    preview: preview,
    hook: hook,
    off: function () { CFG.enabled = false; try { localStorage.setItem('cyr3d_glb', '0'); } catch (e) {} },
    on: function () { CFG.enabled = true; try { localStorage.removeItem('cyr3d_glb'); } catch (e) {} }
  };
})();
