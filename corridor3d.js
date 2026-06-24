/* ============================================================
   INFRARED TECHNOLOGIES — project corridor (true 3D, three.js)

   Renders the placeholder project cards as real meshes in a
   WebGL scene viewed through a perspective camera, so the depth,
   convergence and parallax are genuinely 3D. Progressive
   enhancement: if WebGL is unavailable or motion is reduced this
   module does nothing and script.js falls back to flat 2D cards.

   It exposes window.IR3D = { setProgress(q), resize() } which
   script.js drives from the scroll position.
   ============================================================ */
import * as THREE from "three";

var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
var canvas = document.getElementById("gl");
var stage = document.querySelector(".stage");

var clamp = function (v, a, b) { a = a === undefined ? 0 : a; b = b === undefined ? 1 : b; return Math.min(b, Math.max(a, v)); };
var lerp = function (a, b, t) { return a + (b - a) * t; };
var smooth = function (t) { return t * t * (3 - 2 * t); };

function webglOK() {
    try {
        var c = document.createElement("canvas");
        return !!(window.WebGLRenderingContext && (c.getContext("webgl") || c.getContext("experimental-webgl")));
    } catch (e) { return false; }
}

if (canvas && stage && !reduce && webglOK()) {
    fetch('projects.json')
        .then(function (r) { return r.json(); })
        .then(function (data) { init(data); });
}

function init(projectData) {
    var CARDS = projectData.map(function (p) {
        return { no: p.id, title: p.title, tag: p.tag, desc: p.description, img: p.img || "" };
    });
    if (!CARDS.length) return;

    var STEP = 0.80 / CARDS.length;
    var SPAN = Math.max(1 - (CARDS.length - 1) * STEP, 0.25);
    var Z_NEAR = -7.5, Z_FAR = -90;
    var WALL = 6.9;
    var ANGLE = 90 * Math.PI / 180;
    var H = 2.0, W = 3.4;

    /* Hover focus: the card under the cursor turns to face the camera and
       comes to a fixed depth + slight scale, so it presents at a fixed size. */
    var FOCUS_Z = -7.0;
    var FOCUS_SCALE = 1.0;
    var FOCUS_PULL = 0.55;            // how far the card slides in off its wall on hover
    var SIZE = 2.1;

    var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    var scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x000000, 30, 85);

    var camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);

    var geo = new THREE.PlaneGeometry(W, H);
    var meshes = CARDS.map(function (c, i) {
        var mat = new THREE.MeshBasicMaterial({
            map: makeTexture(c, draw), transparent: true, side: THREE.DoubleSide, depthWrite: false
        });
        mat.map.colorSpace = THREE.SRGBColorSpace;
        mat.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
        var m = new THREE.Mesh(geo, mat);
        m.userData = { side: i % 2 === 0 ? -1 : 1, lane: 0, data: c, hf: 0, bscale: SIZE };
        scene.add(m);
        return m;
    });

    var curQ = 0;
    var raycaster = new THREE.Raycaster();
    var pointer = new THREE.Vector2();
    var hovered = -1;
    var running = false;

    /* Cards recede down the hallway. As each card enters, it temporarily
       zooms to centre-stage to present itself, then returns to the wall. */
    function computeBase(q) {
        for (var i = 0; i < meshes.length; i++) {
            var d = meshes[i].userData;
            var u = clamp((q - i * STEP) / SPAN);

            var wallX = d.side * WALL;
            var wallZ = lerp(Z_NEAR, Z_FAR, u);
            var wallRot = -d.side * ANGLE;

            var zf = smooth(clamp((u - 0.05) / 0.08)) * (1 - smooth(clamp((u - 0.22) / 0.08)));

            d.bx = lerp(wallX, 0, zf);
            d.by = 0;
            d.bz = lerp(wallZ, FOCUS_Z, zf);
            d.brot = lerp(wallRot, 0, zf);
            var fadeU = (i === meshes.length - 1) ? 0.45 : 0.88;
            d.bop = smooth(clamp(u / 0.12)) * (1 - smooth(clamp((u - fadeU) / 0.10)));
            d.bscale = lerp(SIZE, 1.2, zf);
        }
    }

    /* Blend each card between its resting pose and the hover-focus pose. */
    function apply() {
        for (var i = 0; i < meshes.length; i++) {
            var m = meshes[i], d = m.userData;
            var goal = (i === hovered) ? 1 : 0;
            d.hf += (goal - d.hf) * 0.18;
            if (Math.abs(d.hf - goal) < 0.001) d.hf = goal;
            var hf = d.hf;

            m.position.set(
                lerp(d.bx, d.bx * FOCUS_PULL, hf),
                d.by,
                lerp(d.bz, FOCUS_Z, hf)
            );
            m.rotation.y = d.brot * (1 - hf);          // turn to face the camera
            m.scale.setScalar(lerp(d.bscale, FOCUS_SCALE, hf));
            m.material.opacity = lerp(d.bop, 1, hf);
            m.renderOrder = (i === hovered) ? 10 : 0;
            m.visible = m.material.opacity > 0.002;
        }
    }

    function settling() {
        for (var i = 0; i < meshes.length; i++) {
            var goal = (i === hovered) ? 1 : 0;
            if (Math.abs(meshes[i].userData.hf - goal) > 0.0011) return true;
        }
        return false;
    }

    function draw() { renderer.render(scene, camera); }

    function loop() {
        apply();
        draw();
        if (settling()) requestAnimationFrame(loop);
        else running = false;
    }
    function kick() { if (!running) { running = true; requestAnimationFrame(loop); } }

    function resize() {
        var w = stage.clientWidth, h = stage.clientHeight;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
    }

    /* Pointer picking — which card (if any) is under the cursor. */
    function onMove(e) {
        var rect = canvas.getBoundingClientRect();
        pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);
        var hits = raycaster.intersectObjects(meshes, false);
        var h = -1;
        for (var k = 0; k < hits.length; k++) {
            var o = hits[k].object;
            if (o.visible && o.material.opacity > 0.25) { h = meshes.indexOf(o); break; }
        }
        if (h !== hovered) {
            hovered = h;
            canvas.style.cursor = h >= 0 ? "pointer" : "";
            kick();
        }
    }

    window.IR3D = {
        setProgress: function (q) { curQ = q; computeBase(q); kick(); },
        resize: function () { resize(); computeBase(curQ); apply(); draw(); }
    };

    document.body.classList.add("gl-on");
    resize();
    computeBase(0);
    apply();
    draw();

    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", function () {
        if (hovered !== -1) { hovered = -1; canvas.style.cursor = ""; kick(); }
    });

    canvas.addEventListener("click", function () {
        if (hovered >= 0 && hovered < CARDS.length && window.IR_OPEN_CASE) {
            var proj = window.IR_PROJECTS && window.IR_PROJECTS[hovered];
            if (proj) window.IR_OPEN_CASE(proj);
        }
    });

    /* Rebuild the card textures once the webfonts load, for crisp type. */
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(function () {
            meshes.forEach(function (m) {
                m.material.map.dispose();
                var t = makeTexture(m.userData.data, draw);
                t.colorSpace = THREE.SRGBColorSpace;
                t.anisotropy = renderer.capabilities.getMaxAnisotropy();
                m.material.map = t;
                m.material.needsUpdate = true;
            });
            draw();
        });
    }

    window.addEventListener("resize", function () { resize(); computeBase(curQ); apply(); draw(); });
}

function roundRectPath(x, X, Y, w, h, r) {
    x.beginPath();
    x.moveTo(X + r, Y);
    x.arcTo(X + w, Y, X + w, Y + h, r);
    x.arcTo(X + w, Y + h, X, Y + h, r);
    x.arcTo(X, Y + h, X, Y, r);
    x.arcTo(X, Y, X + w, Y, r);
    x.closePath();
}

function wrapText(ctx, text, x, y, maxW, lh) {
    var words = text.split(" "), line = "", yy = y;
    for (var i = 0; i < words.length; i++) {
        var test = line ? line + " " + words[i] : words[i];
        if (ctx.measureText(test).width > maxW && line) {
            ctx.fillText(line, x, yy); line = words[i]; yy += lh;
        } else { line = test; }
    }
    if (line) ctx.fillText(line, x, yy);
}

/* Draw a landscape "painting": project image on the left, description on the
   right — a framed piece + placard, like a museum hallway.                    */
function drawCard(x, card, w, h, r, imgW) {
    /* Card base + frame. */
    roundRectPath(x, 0, 0, w, h, r);
    var g = x.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, "#1f0505");
    g.addColorStop(1, "#070202");
    x.fillStyle = g; x.fill();

    /* Image glow. */
    x.save();
    roundRectPath(x, 0, 0, w, h, r); x.clip();
    var rg = x.createRadialGradient(imgW * 0.5, h * 0.46, 8, imgW * 0.5, h * 0.5, imgW);
    rg.addColorStop(0, "rgba(255,40,40,0.26)");
    rg.addColorStop(0.72, "rgba(0,0,0,0)");
    x.fillStyle = rg; x.fillRect(0, 0, imgW, h);
    x.restore();

    /* Big project number in the image area (shown when no image). */
    x.fillStyle = "rgba(255,255,255,0.18)";
    x.textAlign = "center"; x.textBaseline = "middle";
    x.font = "500 150px 'Fira Code', monospace";
    x.fillText(card.no, imgW * 0.5, h * 0.5);

    /* Divider between image and placard. */
    x.strokeStyle = "rgba(255,70,70,0.25)"; x.lineWidth = 1.5;
    x.beginPath(); x.moveTo(imgW, h * 0.12); x.lineTo(imgW, h * 0.88); x.stroke();

    /* Placard: title, tag, description. */
    var tx = imgW + 42;
    x.textAlign = "left"; x.textBaseline = "alphabetic";

    x.fillStyle = "#ffffff";
    x.font = "400 48px 'Sora', system-ui, sans-serif";
    x.fillText(card.title, tx, h * 0.30);

    x.fillStyle = "#ff5f5f";
    x.font = "500 23px 'Fira Code', monospace";
    x.fillText(card.tag.toUpperCase(), tx, h * 0.30 + 40);

    x.fillStyle = "rgba(255,255,255,0.6)";
    x.font = "400 27px 'Sora', system-ui, sans-serif";
    wrapText(x, card.desc, tx, h * 0.30 + 100, w - tx - 44, 38);

    /* Outer frame line. */
    roundRectPath(x, 1.5, 1.5, w - 3, h - 3, r - 1);
    x.lineWidth = 2.5; x.strokeStyle = "rgba(255,70,70,0.42)"; x.stroke();
}

function makeTexture(card, onUpdate) {
    var w = 960, h = 564, r = 24;
    var imgW = w * 0.42;
    var cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    var x = cv.getContext("2d");

    drawCard(x, card, w, h, r, imgW);

    var tex = new THREE.CanvasTexture(cv);

    if (card.img) {
        var pic = new Image();
        pic.crossOrigin = "anonymous";
        pic.onload = function () {
            x.clearRect(0, 0, w, h);
            drawCard(x, card, w, h, r, imgW);
            x.save();
            roundRectPath(x, 0, 0, imgW, h, r); x.clip();
            var scale = Math.max(imgW / pic.width, h / pic.height);
            var dw = pic.width * scale, dh = pic.height * scale;
            x.drawImage(pic, (imgW - dw) / 2, (h - dh) / 2, dw, dh);
            x.restore();
            tex.needsUpdate = true;
            if (onUpdate) onUpdate();
        };
        pic.src = card.img;
    }

    return tex;
}
